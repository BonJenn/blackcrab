import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AuthFilesystemWriteScope, type EnvironmentId, type ScopedThreadRef } from "@t3tools/contracts";
import { File, EditProvider, MultiFileDiff, Virtualizer } from "@pierre/diffs/react";
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import type { FileContents, SelectedLineRange } from "@pierre/diffs";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import FileBrowserPanel from "../files/FileBrowserPanel";
import { useEditableAfterHighlight } from "../files/FilePreviewPanel";
import { useTheme } from "~/hooks/useTheme";
import { useStableCallback } from "~/hooks/useStableCallback";
import { projectFileCacheKey } from "../files/fileContentRevision";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { useEnvironmentScope } from "~/state/session";
import { projectEnvironment } from "~/state/projects";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useAtomCommand } from "~/state/use-atom-command";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { nextFileCommentId } from "../files/fileCommentAnnotations";
import { buildFileReviewComment } from "~/reviewCommentContext";
import { agentFolder, changedRegion, enqueueFlash, flashDuration, ideChanges, receiveFile, selectionContext, type IdeDraft, type IdeFileEvent, type IdeFlash } from "./ideState";
import { DIFF_VIEW_UNSAFE_CSS } from "../diffs/StyledDiffCodeView";
import "./ide-mode.css";

const createEditor: EditorFactory<undefined, undefined> = (type, options, key) => new Editor(type, options, key);
// Retain drafts across chat/IDE toggles and navigation. Never autosave on unmount or reconnect.
const drafts = new Map<string, IdeDraft>();
const fileReadEpochs = new Map<string, number>();
// The last contents read from disk for each file. A later read that differs is a change to show.
const lastSeen = new Map<string, string>();
const savingFiles = new Set<string>();
const draftStoragePrefix = "blackcrab.ide.draft.v1:";
let draftStorageWarning = "";
if (typeof window !== "undefined") {
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const storageKey = sessionStorage.key(index);
      if (!storageKey?.startsWith(draftStoragePrefix)) continue;
      const key = storageKey.slice(draftStoragePrefix.length);
      const identity: unknown = JSON.parse(key);
      const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (!Array.isArray(identity) || identity.length !== 3 || !identity.every(p => typeof p === "string")) continue;
      if (!value || typeof value !== "object" || !("base" in value) || !("text" in value) || typeof value.base !== "string" || typeof value.text !== "string") continue;
      drafts.set(key, { base: value.base, text: value.text, incoming: null, safe: false, truncated: false });
    }
  } catch { draftStorageWarning = "Draft recovery storage is unavailable. Export unsaved drafts before closing."; }
}
let draftRevision = 0;
const draftListeners = new Set<() => void>();
const subscribeDrafts = (listener: () => void) => { draftListeners.add(listener); return () => { draftListeners.delete(listener); }; };
const getDraftRevision = () => draftRevision;
function setDraft(key: string, draft: IdeDraft) {
  const previous = drafts.get(key);
  if (previous && Object.keys(draft).every(field => previous[field as keyof IdeDraft] === draft[field as keyof IdeDraft])) return;
  drafts.set(key, draft);
  try {
    if (draft.text !== draft.base) sessionStorage.setItem(draftStoragePrefix + key, JSON.stringify({ base: draft.base, text: draft.text }));
    else sessionStorage.removeItem(draftStoragePrefix + key);
  } catch { draftStorageWarning = "Draft retained in this window only: recovery storage is full or unavailable. Export it before closing."; }
  draftRevision += 1;
  for (const listener of draftListeners) listener();
}
// Keep the guard installed after closing IDE mode: hidden drafts still belong to the user.
if (typeof window !== "undefined") window.addEventListener("beforeunload", event => {
  if ([...drafts.values()].some(d => d.text !== d.base)) { event.preventDefault(); event.returnValue = ""; }
});
const keyFor = (environmentId: string, cwd: string, path: string) => JSON.stringify([environmentId, cwd, path]);

export function IdeCodeEditor(props: { path: string; contents: string; writable: boolean; onChange: (text: string) => void; onSelection: (range: SelectedLineRange | null) => void }) {
  const { resolvedTheme } = useTheme();
  const [file, setFile] = useState<FileContents>(() => ({ name: props.path, contents: props.contents, cacheKey: `ide:${projectFileCacheKey("", props.path, props.contents)}` }));
  const edited = useRef<string | null>(null);
  if (props.contents !== (edited.current ?? file.contents)) {
    setFile({ name: props.path, contents: props.contents, cacheKey: `ide:${projectFileCacheKey("", props.path, props.contents)}` });
    edited.current = null;
  }
  const highlight = useEditableAfterHighlight(file);
  return <EditProvider createEditor={createEditor}>
    <Virtualizer className="min-h-0 flex-1 overflow-auto">
      <File file={file} edit={props.writable && highlight.ready}
        onEditChange={({ file: next }) => { edited.current = next.contents; props.onChange(next.contents); }}
        options={{ disableFileHeader: true, enableLineSelection: true, enableGutterUtility: true,
          onLineSelectionEnd: props.onSelection, onGutterUtilityClick: props.onSelection,
          overflow: "scroll", preferredHighlighter: PREFERRED_HIGHLIGHTER, theme: resolveDiffThemeName(resolvedTheme), themeType: resolvedTheme,
          onPostRender: (_container, instance, phase) => highlight.onPostRender(instance.file, phase) }} />
    </Virtualizer>
  </EditProvider>;
}

// Shows what a change did, in the library's own colours: added lines green, removed lines red, with
// word-level marks inside changed lines. It is read-only and replaces the editor for a moment.
export function IdeChangeFlash(props: { path: string; before: string; after: string }) {
  const { resolvedTheme } = useTheme();
  const region = changedRegion(props.before, props.after);
  const file = (contents: string) => ({ name: props.path, contents, cacheKey: `ide-change:${projectFileCacheKey("", props.path, contents)}` });
  return <div className="blackcrab-ide-change flex min-h-0 flex-1 flex-col" role="status" aria-label={`Agent change to ${props.path}`}>
    <p className="flex flex-wrap gap-2 border-b px-2 py-1 text-xs">
      <span className="min-w-0 flex-1 truncate">Agent changed {props.path}</span>
      <span className="text-emerald-600 dark:text-emerald-400">+{region?.added ?? 0}</span>
      <span className="text-red-600 dark:text-red-400">−{region?.removed ?? 0}</span>
    </p>
    <Virtualizer className="min-h-0 flex-1 overflow-auto">
      <MultiFileDiff oldFile={file(props.before)} newFile={file(props.after)}
        options={{ diffStyle: "unified", lineDiffType: "word", overflow: "scroll", disableFileHeader: true,
          theme: resolveDiffThemeName(resolvedTheme), themeType: resolvedTheme, preferredHighlighter: PREFERRED_HIGHLIGHTER,
          unsafeCSS: DIFF_VIEW_UNSAFE_CSS }} />
    </Virtualizer>
  </div>;
}

type IdePanelProps = {
  environmentId: EnvironmentId; cwd: string; projectName: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  items: readonly { readonly item: IdeFileEvent }[];
  workspaceMutationId: string | null;
};
const folderName = (folder: string) => folder.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? folder;

// The agent is not always working in the thread's own folder. When its latest edits are elsewhere,
// the panel moves to that folder, and "Back" returns to the thread's folder until the agent moves again.
export default function IdePanel(props: IdePanelProps) {
  const { folder, outside } = agentFolder(props.cwd, props.items);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const desired = outside && dismissed !== folder ? folder : props.cwd;
  const shownRef = useRef(desired);
  const revision = useSyncExternalStore(subscribeDrafts, getDraftRevision);
  // Unsaved edits stay where they are: the panel does not move away from a file being edited.
  const editing = useMemo(() => [...drafts].some(([key, value]) => {
    const [env, root] = JSON.parse(key) as string[];
    return env === props.environmentId && root === shownRef.current && value.text !== value.base;
  }), [props.environmentId, revision, desired]);
  const shown = editing ? shownRef.current : desired;
  shownRef.current = shown;
  const elsewhere = shown !== props.cwd;
  return <IdePanelAt key={shown} {...props} cwd={shown}
    folderNote={elsewhere
      ? { text: `The agent is working in ${shown}, outside this thread's folder.`, action: `Show ${props.projectName}`, onAction: () => setDismissed(folder) }
      : outside ? { text: `The agent is working in ${folder}.`, action: `Show ${folderName(folder)}`, onAction: () => setDismissed(null) } : null} />;
}

function IdePanelAt(props: IdePanelProps & { folderNote: { text: string; action: string; onAction: () => void } | null }) {
  const { environmentId, cwd } = props;
  const changes = ideChanges(cwd, props.items);
  const latest = changes.at(-1);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  // Changes the agent makes are shown briefly, one file at a time and in the order they landed.
  const [showChanges, setShowChanges] = useState(true);
  const [flash, setFlash] = useState<IdeFlash | null>(null);
  const flashQueue = useRef<IdeFlash[]>([]);
  const [queueVersion, setQueueVersion] = useState(0);
  const revision = useSyncExternalStore(subscribeDrafts, getDraftRevision);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const readEpoch = useRef(0);
  const [range, setRange] = useState<SelectedLineRange | null>(null);
  const [question, setQuestion] = useState("");
  const writable = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const read = useAtomQueryRunner(projectEnvironment.readFile, { refresh: true, reportFailure: false });
  const readOthers = useAtomQueryRunner(projectEnvironment.readFile, { refresh: true, reportFailure: false });
  const write = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const addReviewComment = useComposerDraftStore(store => store.addReviewComment);
  const selectedKey = selected ? keyFor(environmentId, cwd, selected) : "";
  const fileSaving = saving || savingFiles.has(selectedKey);
  const draft = selected ? drafts.get(keyFor(environmentId, cwd, selected)) : undefined;
  const dirty = draft !== undefined && draft.text !== draft.base;
  const readRef = useStableCallback(read);
  const readOthersRef = useStableCallback(readOthers);
  // Record what is on disk. A difference from the last read, outside this window's own saves, is queued to show.
  const noteDisk = useStableCallback((path: string, contents: string) => {
    const key = keyFor(environmentId, cwd, path);
    const before = lastSeen.get(key);
    lastSeen.set(key, contents);
    if (before === undefined || before === contents || !showChanges) return;
    flashQueue.current = enqueueFlash(flashQueue.current, { key, path, before, after: contents });
    setQueueVersion(version => version + 1);
  });
  const select = (path: string) => { setFollow(false); setSelected(path); setRange(null); setNotice(""); };

  // Changes made while IDE mode was closed are not replayed: start from what is on disk now.
  useEffect(() => {
    for (const key of [...lastSeen.keys()]) {
      const [env, root] = JSON.parse(key) as string[];
      if (env === environmentId && root === cwd) lastSeen.delete(key);
    }
  }, [environmentId, cwd]);

  // The host event selects a path, never speculative newStr/diff bytes. Disk reads provide content.
  useEffect(() => {
    if (follow && latest && !dirty && !saving && !flash) { setSelected(latest.path); setRange(null); }
  }, [follow, latest?.token, latest?.path, dirty, saving, flash]);

  // Refresh snapshots after host events and while viewing. One request at a time, fenced on switch.
  useEffect(() => {
    if (!selected) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
      if (!savingRef.current && !savingFiles.has(keyFor(environmentId, cwd, selected)) && document.visibilityState !== "hidden") {
        const epoch = readEpoch.current;
        const fileKey = keyFor(environmentId, cwd, selected);
        const fileEpoch = fileReadEpochs.get(fileKey);
        const result = await readRef({ environmentId, input: { cwd, relativePath: selected, ideGuardedRead: true } });
        if (stopped) return;
        if (epoch !== readEpoch.current || fileEpoch !== fileReadEpochs.get(fileKey)) { timer = setTimeout(refresh, 1000); return; }
        if (result._tag === "Success") {
          const file = result.value;
          const key = keyFor(environmentId, cwd, selected);
          if (drafts.get(key)?.text !== file.contents && drafts.get(key)?.text === drafts.get(key)?.base) setRange(null);
          if (!file.truncated) noteDisk(selected, file.contents);
          setDraft(key, receiveFile(drafts.get(key), file.contents, file.ideSafeWrite === true, file.truncated));
          setError(null);
        } else { setError("Unable to read the host file. Your draft is retained; retry after reconnecting."); }
      }
      } catch { if (!stopped) setError("Host read failed. Draft retained; reconnect to refresh."); }
      if (!stopped) timer = setTimeout(refresh, follow ? 500 : 1000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [environmentId, cwd, selected, props.workspaceMutationId, latest?.token, readRef, noteDisk, follow]);

  // Other files the agent has changed are read too, so edits to several files are seen in turn
  // and the first one is not missed while another is on screen.
  const changedPaths = changes.slice(-8).map(change => change.path).filter(path => path !== selected).join("\n");
  useEffect(() => {
    if (!showChanges || !changedPaths) return;
    const paths = changedPaths.split("\n");
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const sweep = async () => {
      for (const path of paths) {
        if (stopped || document.visibilityState === "hidden") break;
        try {
          const result = await readOthersRef({ environmentId, input: { cwd, relativePath: path, ideGuardedRead: true } });
          if (!stopped && result._tag === "Success" && !result.value.truncated) noteDisk(path, result.value.contents);
        } catch { /* The next sweep tries again. */ }
      }
      if (!stopped) timer = setTimeout(sweep, 600);
    };
    void sweep();
    return () => { stopped = true; clearTimeout(timer); };
  }, [showChanges, changedPaths, environmentId, cwd, readOthersRef, noteDisk]);

  // Show queued changes one at a time. Following moves to each file; otherwise only the open file is shown.
  // A file with unsaved edits is never covered.
  useEffect(() => {
    if (!showChanges) { flashQueue.current = []; setFlash(null); return; }
    if (flash) {
      const timer = setTimeout(() => setFlash(null), flashDuration(flashQueue.current.length));
      return () => clearTimeout(timer);
    }
    const next = flashQueue.current.find(item => follow || item.path === selected);
    if (!next) return;
    flashQueue.current = flashQueue.current.filter(item => item !== next);
    const nextDraft = drafts.get(next.key);
    if (nextDraft && nextDraft.text !== nextDraft.base) { setQueueVersion(version => version + 1); return; }
    if (follow) { setSelected(next.path); setRange(null); }
    setFlash(next);
  }, [showChanges, flash, follow, selected, queueVersion, revision]);

  const change = (text: string) => {
    if (!selected || !draft || savingRef.current) return;
    setDraft(keyFor(environmentId, cwd, selected), { ...draft, text });
    setFollow(false);
  };
  const save = async () => {
    if (!selected || !draft || !writable || !draft.safe || draft.truncated || draft.incoming !== null || savingRef.current || savingFiles.has(selectedKey) || error) return;
    const path = selected, snapshot = draft, key = keyFor(environmentId, cwd, path);
    fileReadEpochs.set(key, (fileReadEpochs.get(key) ?? 0) + 1);
    savingFiles.add(key);
    readEpoch.current += 1;
    savingRef.current = true; setSaving(true); setNotice("");
    try {
      const result = await write({ environmentId, input: { cwd, relativePath: path, contents: snapshot.text, ideExpectedContents: snapshot.base } });
      if (result._tag !== "Success") { setError("Save was not confirmed. Draft retained; refresh before retrying."); return; }
      if (result.value.ideConflict) { setNotice("The host file changed. Your draft was kept. Review the incoming version before saving."); return; }
      if (!result.value.ideRecoveryPath) { setError("Host did not confirm a guarded save. Draft retained."); return; }
      lastSeen.set(key, snapshot.text);
      setDraft(key, { ...snapshot, text: drafts.get(key)?.text ?? snapshot.text, base: snapshot.text, incoming: null });

      setNotice(`Saved. Previous file retained at ${result.value.ideRecoveryPath}`);
    } catch { setError("Save outcome unknown. Draft retained; refresh before retrying."); } finally { fileReadEpochs.set(key, (fileReadEpochs.get(key) ?? 0) + 1); savingFiles.delete(key); draftRevision += 1; for (const listener of draftListeners) listener(); readEpoch.current += 1; savingRef.current = false; setSaving(false); }
  };
  const exportDraft = () => {
    if (!draft || !selected) return;
    const url = URL.createObjectURL(new Blob([draft.text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${selected.split("/").at(-1)}.draft`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const ask = () => {
    if (!range || !draft || !selected || !question.trim()) return;
    addReviewComment(props.composerDraftTarget, buildFileReviewComment({
      id: `ide:${nextFileCommentId()}`, ...selectionContext(selected, draft.text, range.start, range.end), text: question,
    }));
    setRange(null); setQuestion(""); setNotice("Selection and question added to this chat's draft. Send it when ready.");
  };
  // Include retained unsaved files even when the provider has never mentioned them.
  const pending = useMemo(() => [...drafts].flatMap(([key, value]) => {
    const [env, root, path] = JSON.parse(key) as string[];
    return env === environmentId && root === cwd && value.text !== value.base ? [path!] : [];
  }), [environmentId, cwd, revision]);
  return <section className="blackcrab-ide" aria-label="IDE mode">
    <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
      <strong>IDE</strong><span className="min-w-0 flex-1 truncate">{selected ?? "Select a file"}{dirty ? " • Unsaved" : ""}</span>
      <button type="button" aria-pressed={follow} onClick={() => setFollow(!follow)}>{follow ? "Following agent" : "Follow agent"}</button>
      <button type="button" aria-pressed={showChanges} onClick={() => setShowChanges(!showChanges)}>{showChanges ? "Highlighting changes" : "Highlight changes"}</button>
      <button type="button" disabled={!dirty || !writable || !draft?.safe || draft.truncated || draft.incoming !== null || fileSaving || !!error} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
      <button type="button" disabled={!draft} onClick={exportDraft}>Export draft</button>
    </div>
    {props.folderNote ? <p role="status" className="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-xs">
      <span className="min-w-0 flex-1 break-all">{props.folderNote.text}</span>
      <button type="button" onClick={props.folderNote.onAction}>{props.folderNote.action}</button>
    </p> : null}
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-44 shrink-0 flex-col overflow-auto border-r" aria-label="Workspace files and changes">
        <FileBrowserPanel environmentId={environmentId} cwd={cwd} projectName={props.projectName}
          selectedPath={selected} selectedPathRevealId={0} onOpenFile={select} workspaceMutationId={props.workspaceMutationId} />
        <details open className="border-t p-2 text-xs"><summary>Agent changes ({changes.length})</summary>
          {changes.map(file => <button className="block max-w-full truncate py-1 text-left" type="button" key={file.path} onClick={() => select(file.path)} title={file.status}>{file.path} · {file.status}</button>)}
        </details>
        {pending.length > 0 ? <details open className="border-t p-2 text-xs"><summary>Unsaved drafts</summary>{pending.map(path => <button className="block" type="button" key={path} onClick={() => select(path)}>{path}</button>)}</details> : null}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <p className="border-b px-2 py-1 text-xs text-muted-foreground">Live host snapshots · updates appear when written to disk. {dirty ? "Follow paused while editing." : ""}</p>
        {draftStorageWarning ? <p role="alert" className="p-2 text-xs">{draftStorageWarning}</p> : null}
        {error ? <p role="alert" className="p-2 text-xs">{error}</p> : null}
        {notice ? <p role="status" className="p-2 text-xs break-all">{notice}</p> : null}
        {draft && (!draft.safe || !writable || draft.truncated) ? <p className="p-2 text-xs">Read only: {draft.truncated ? "file exceeds the preview limit" : !writable ? "filesystem write permission unavailable" : "this host does not support guarded IDE saves"}.</p> : null}
        {draft?.incoming !== null && draft?.incoming !== undefined ? <details open className="max-h-60 overflow-auto border-b p-2 text-xs"><summary>External change — your draft is preserved</summary>
          <pre className="overflow-auto">{draft.incoming}</pre>
          <button type="button" disabled={saving} onClick={() => { if (!selected || !draft || draft.incoming === null) return; setDraft(keyFor(environmentId, cwd, selected), { ...draft, base: draft.incoming, incoming: null });  setNotice("Incoming version acknowledged. Edit your draft to merge it, then Save."); }}>Use incoming as save baseline; keep my draft</button>
        </details> : null}
        {flash && selected && flash.key === selectedKey && !dirty ? <DiffWorkerPoolProvider><IdeChangeFlash key={`${flash.key}:${flash.after.length}`} path={flash.path} before={flash.before} after={flash.after} /></DiffWorkerPoolProvider>
          : draft && selected ? <DiffWorkerPoolProvider><IdeCodeEditor key={selected} path={selected} contents={draft.text}
          writable={writable && draft.safe && !draft.truncated && !fileSaving && !error} onChange={change} onSelection={setRange} /></DiffWorkerPoolProvider> : <p className="p-4 text-sm">Open a file from the tree or wait for an agent file-change event.</p>}
        {range ? <form className="flex gap-2 border-t p-2" onSubmit={event => { event.preventDefault(); ask(); }}>
          <label className="flex-1 text-xs">Ask about {selected}:{range.start}–{range.end}<input aria-label="Question about selected code" className="block w-full border p-1" value={question} onChange={event => setQuestion(event.target.value)} /></label>
          <button type="submit" disabled={!question.trim()}>Add to chat</button>
        </form> : null}
      </div>
    </div>
  </section>;
}
