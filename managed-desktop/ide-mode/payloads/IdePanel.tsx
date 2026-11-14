import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AuthFilesystemWriteScope, type EnvironmentId, type ScopedThreadRef } from "@t3tools/contracts";
import { File, EditProvider, Virtualizer } from "@pierre/diffs/react";
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
import { ideChanges, receiveFile, selectionContext, type IdeDraft, type IdeFileEvent } from "./ideState";
import "./ide-mode.css";

const createEditor: EditorFactory<undefined, undefined> = (type, options, key) => new Editor(type, options, key);
// Retain drafts across chat/IDE toggles and navigation. Never autosave on unmount or reconnect.
const drafts = new Map<string, IdeDraft>();
const fileReadEpochs = new Map<string, number>();
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

export default function IdePanel(props: {
  environmentId: EnvironmentId; cwd: string; projectName: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  items: readonly { readonly item: IdeFileEvent }[];
  workspaceMutationId: string | null;
}) {
  const { environmentId, cwd } = props;
  const changes = ideChanges(cwd, props.items);
  const latest = changes.at(-1);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
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
  const write = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const addReviewComment = useComposerDraftStore(store => store.addReviewComment);
  const selectedKey = selected ? keyFor(environmentId, cwd, selected) : "";
  const fileSaving = saving || savingFiles.has(selectedKey);
  const draft = selected ? drafts.get(keyFor(environmentId, cwd, selected)) : undefined;
  const dirty = draft !== undefined && draft.text !== draft.base;
  const readRef = useStableCallback(read);
  const select = (path: string) => { setFollow(false); setSelected(path); setRange(null); setNotice(""); };

  // The host event selects a path, never speculative newStr/diff bytes. Disk reads provide content.
  useEffect(() => {
    if (follow && latest && !dirty && !saving) { setSelected(latest.path); setRange(null); }
  }, [follow, latest?.token, latest?.path, dirty, saving]);

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
          setDraft(key, receiveFile(drafts.get(key), file.contents, file.ideSafeWrite === true, file.truncated));
          setError(null);
        } else { setError("Unable to read the host file. Your draft is retained; retry after reconnecting."); }
      }
      } catch { if (!stopped) setError("Host read failed. Draft retained; reconnect to refresh."); }
      if (!stopped) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [environmentId, cwd, selected, props.workspaceMutationId, latest?.token, readRef]);

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
      <button type="button" disabled={!dirty || !writable || !draft?.safe || draft.truncated || draft.incoming !== null || fileSaving || !!error} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
      <button type="button" disabled={!draft} onClick={exportDraft}>Export draft</button>
    </div>
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
        {draft && selected ? <DiffWorkerPoolProvider><IdeCodeEditor key={selected} path={selected} contents={draft.text}
          writable={writable && draft.safe && !draft.truncated && !fileSaving && !error} onChange={change} onSelection={setRange} /></DiffWorkerPoolProvider> : <p className="p-4 text-sm">Open a file from the tree or wait for an agent file-change event.</p>}
        {range ? <form className="flex gap-2 border-t p-2" onSubmit={event => { event.preventDefault(); ask(); }}>
          <label className="flex-1 text-xs">Ask about {selected}:{range.start}–{range.end}<input aria-label="Question about selected code" className="block w-full border p-1" value={question} onChange={event => setQuestion(event.target.value)} /></label>
          <button type="submit" disabled={!question.trim()}>Add to chat</button>
        </form> : null}
      </div>
    </div>
  </section>;
}
