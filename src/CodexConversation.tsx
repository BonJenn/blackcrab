import { useEffect, useState, useSyncExternalStore } from "react";
import { codexQuery, type CodexModel, type CodexThread } from "./codexClient";
import { useCodexPage } from "./useCodexPage";
import { desktopCodexWorkspace, type CodexWorkspace } from "./codexWorkspace";
import type { CodexLiveClient, CodexLiveState } from "./codexLive";
import type { QueueChange } from "./queueClient";
export type CodexActivity = "idle" | "running" | "approval" | "detached" | "confirmation";
const APPROVAL_METHODS = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval"]);
function Queue({ client, state }: { client: CodexLiveClient; state: CodexLiveState }) {
  const [editing, setEditing] = useState<{ id: string; text: string; revision: number } | null>(null);
  const queue = state.queue;
  if (!queue) return null;
  const disabled = state.phase !== "live" || !!state.operation || state.sending;
  async function change(change: QueueChange, revision = queue!.revision) { if (await client.mutate(change, revision)) setEditing(null); }
  function move(id: string, direction: number) {
    const ids = queue!.items.map(item => item.commandId), from = ids.indexOf(id), to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]]; void change({ type: "reorder", commandIds: ids });
  }
  return <section aria-label="Codex queue"><h3>Queue ({queue.items.length})</h3>
    {queue.paused && queue.items.length > 0 && <p>Queue paused. Review the conversation before resuming.</p>}
    <div className="codex-page-actions">
      <button type="button" className="btn btn-secondary" disabled={disabled || (queue.paused && state.busy)} onClick={() => void change({ type: queue.paused ? "resume" : "pause" })}>{queue.paused ? "Resume queue" : "Pause queue"}</button>
      <button type="button" className="btn btn-secondary" disabled={!!state.operation} onClick={() => void client.refreshQueue()}>Refresh queue</button>
    </div>
    {state.phase !== "live" && queue.items.length > 0 && <p>Resume the session before changing its queue.</p>}
    <ol className="codex-queue">{queue.items.map((item, index) => <li key={item.commandId}>
      {editing?.id === item.commandId ? <form onSubmit={event => { event.preventDefault(); void change({ type: "edit", commandId: item.commandId, text: editing.text }, editing.revision); }}>
        <label>Edit queued message<textarea value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} /></label>
        {editing.revision !== queue.revision && <p role="status">Queue changed. Cancel this edit and reopen the latest message.</p>}
        <button className="btn btn-secondary" type="submit" disabled={disabled || !editing.text.trim() || editing.revision !== queue.revision}>Save queued message</button>
        <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)}>Cancel edit</button>
      </form> : <><pre>{item.text}</pre><div className="codex-page-actions">
        <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => setEditing({ id: item.commandId, text: item.text, revision: queue.revision })}>Edit</button>
        <button type="button" className="btn btn-secondary" aria-label={`Move message ${index + 1} up`} disabled={disabled || index === 0} onClick={() => move(item.commandId, -1)}>↑</button>
        <button type="button" className="btn btn-secondary" aria-label={`Move message ${index + 1} down`} disabled={disabled || index === queue.items.length - 1} onClick={() => move(item.commandId, 1)}>↓</button>
        <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => void change({ type: "cancel", commandId: item.commandId })}>Remove</button>
      </div></>}
    </li>)}</ol>
  </section>;
}
function Conversation({ workspace, requestedThread, onActivity }: { workspace: CodexWorkspace; requestedThread?: CodexThread; onActivity?: (activity: CodexActivity) => void }) {
  const client = workspace.client;
  const state = useSyncExternalStore(client.subscribe, client.state);
  const settings = useSyncExternalStore(workspace.subscribe, workspace.state);
  const models = useCodexPage<CodexModel>({ type: "models", page: { limit: 50 } }, model => model.id);
  const [localError, setLocalError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [resetReviewed, setResetReviewed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const active = ["live", "starting", "detached", "stopping"].includes(state.phase);
  const configure = !active && !state.operation && !state.sending;
  const pending = state.pending;
  const canCompose = state.phase === "live" && !state.sending && !pending && !state.operation && !state.recoveryBlocked && settings.draftTarget === state.context?.providerSessionId;
  const canSend = canCompose && !!settings.draft.trim() && !state.busy && state.queue !== null && !state.queue.items.length;
  const activity: CodexActivity = state.phase === "detached" ? "detached" : state.approvals.length ? "approval" : state.busy || state.phase === "starting" || state.phase === "stopping" ? "running" : state.pending || state.recoveryBlocked ? "confirmation" : "idle";
  useEffect(() => { onActivity?.(activity); }, [activity, onActivity]);
  useEffect(() => { setReviewed(false); }, [pending?.commandId, state.recoveryBlocked]);
  useEffect(() => {
    if (!requestedThread) return;
    let cancelled = false;
    void workspace.ready.then(() => {
      if (cancelled) return;
      const current = client.state();
      if (["live", "starting", "detached", "stopping"].includes(current.phase) || current.operation) { setLocalError("Stop the current Codex run before choosing another session."); return; }
      if (current.pending && current.pending.providerSessionId !== requestedThread.id) { setLocalError("Confirm or discard the original recovery record before choosing another session."); return; }
      if (!workspace.chooseTarget(requestedThread.cwd, requestedThread.id, requestedThread.model ?? "")) setLocalError("Clear or save the current draft before choosing another session.");
      else setLocalError(null);
    });
    return () => { cancelled = true; };
  }, [workspace, client, requestedThread]);
  async function start() {
    setLocalError(null);
    const saved = workspace.state();
    if (await client.start({ cwd: saved.cwd, model: saved.model || undefined, permissionMode: saved.permissionMode, resumeId: saved.resumeId || undefined })) {
      const context = client.state().context, info = client.state().info;
      if (context) workspace.chooseTarget(info?.cwd ?? saved.cwd, context.providerSessionId, saved.model);
    }
  }
  async function submit(queued: boolean) {
    const text = settings.draft, target = settings.draftTarget;
    if ((!queued && !canSend) || (queued && !canCompose)) return;
    if (await client.submit(text, queued)) workspace.clearAccepted(text, target);
  }
  async function retry() {
    if (!pending) return;
    const original = pending;
    if (await client.retry()) workspace.clearAccepted(original.text, original.providerSessionId);
  }
  async function prepareOriginal() {
    const id = pending?.providerSessionId ?? state.context?.providerSessionId;
    if (!id) return;
    const run = state.context?.runId, target = settings.resumeId;
    setPreparing(true); setLocalError(null);
    try {
      const thread = await codexQuery({ type: "thread", threadId: id });
      const current = client.state();
      if (!["idle", "stopped"].includes(current.phase) || current.operation || current.context?.runId !== run || workspace.state().resumeId !== target) { setLocalError("Session selection changed while loading history. Choose the session again."); return; }
      if (!workspace.chooseTarget(thread.cwd, thread.id, thread.model ?? "")) setLocalError("Clear or save the current draft before choosing the original session.");
    } catch (error) { setLocalError(String(error)); }
    finally { setPreparing(false); }
  }
  const receipts = new Map(state.receipts.map(receipt => [receipt.commandId, receipt]));
  const commands = [...new Set([...state.users.map(user => user.receipt.commandId), ...state.output.map(item => item.commandId), ...state.receipts.filter(receipt => !["queued", "held", "cancelled"].includes(receipt.status)).map(receipt => receipt.commandId)])];
  return <section className="codex-conversation" aria-label="Codex conversation">
    <h3>Conversation preview</h3><p>Text conversations using your configured Codex CLI account. Live output below covers this run; earlier messages are in History.</p>
    <p role="status">Session: {state.phase}{state.busy ? " · working" : ""}{state.operation ? ` · ${state.operation}` : ""}</p>
    {state.context && <p>Thread <code>{state.context.providerSessionId}</code>{state.info && <> · {state.info.cwd} · {state.info.model}</>}</p>}
    <p>Closing this panel keeps its run and draft alive. Use Stop to end the run.</p>
    {localError && <p role="alert">{localError}</p>}{state.error && <p role="alert">{state.error}</p>}
    {workspace.error() && <section role="alert"><p>{workspace.error()}</p><label><input type="checkbox" checked={resetReviewed} onChange={event => setResetReviewed(event.target.checked)} /> Replace unreadable saved preferences with the current values</label><button type="button" className="btn btn-secondary" disabled={!resetReviewed} onClick={() => { workspace.resetSaved(true); setResetReviewed(false); }}>Reset saved preferences</button></section>}
    <form className="codex-launch" onSubmit={event => { event.preventDefault(); void start(); }}>
      <label>Project directory<input required value={settings.cwd} disabled={!configure || !!settings.draft} onChange={event => workspace.update({ cwd: event.target.value })} /></label>
      <label>Thread to resume (blank for new)<input value={settings.resumeId} disabled={!configure || !!settings.draft || !!pending} onChange={event => workspace.update({ resumeId: event.target.value.trim(), draftTarget: event.target.value.trim() })} /></label>
      <label>Model<select value={settings.model} disabled={!configure} onChange={event => workspace.update({ model: event.target.value })}>
        <option value="">CLI default</option>
        {settings.model && !models.data.some(model => model.model === settings.model) && <option value={settings.model}>Saved selection: {settings.model}</option>}
        {models.data.map(model => <option key={model.id} value={model.model}>{model.displayName} ({model.model})</option>)}
      </select></label>
      <label>Permissions for next start<select value={settings.permissionMode} disabled={!configure} onChange={event => workspace.update({ permissionMode: event.target.value as "default" | "readOnly" })}><option value="readOnly">Read only</option><option value="default">Workspace write</option></select></label>
      <div className="codex-page-actions"><button type="submit" className="btn btn-primary" disabled={!configure || !settings.cwd.trim() || state.recoveryBlocked}>{settings.resumeId ? "Resume session" : "Start session"}</button>
        <button type="button" className="btn btn-secondary" disabled={!configure || !!settings.draft || !!pending || state.recoveryBlocked} onClick={() => workspace.update({ resumeId: "", draftTarget: "", permissionMode: "readOnly" })}>New conversation</button>
        <button type="button" className="btn btn-secondary" disabled={!state.context || !["live", "detached"].includes(state.phase) || state.operation === "stop"} onClick={() => void client.stop()}>Stop</button>
        <button type="button" className="btn btn-secondary" disabled={!state.context || !["live", "detached"].includes(state.phase) || !!state.operation || (state.phase === "live" && (!state.busy || !state.receipts.some(receipt => receipt.status === "running")))} onClick={() => void client.interrupt()}>Interrupt</button>
      </div>
    </form>
    {models.error && <p role="alert">Model catalog: {models.error}. CLI default remains available.</p>}
    <div className="codex-page-actions"><button type="button" className="btn btn-secondary" disabled={models.loading} onClick={models.refresh}>Refresh models</button>{models.nextCursor && <button type="button" className="btn btn-secondary" disabled={models.loading} onClick={models.more}>More models</button>}</div>
    {state.phase === "detached" && <p>Review stored history, then explicitly stop this run before resuming it. Live state was not replayed.</p>}
    {(pending || state.recoveryBlocked) && <section aria-label="Codex message recovery"><h3>Message needs confirmation</h3>{pending && <><pre>{pending.text}</pre><p>Original thread: {pending.providerSessionId}</p><button type="button" className="btn btn-secondary" disabled={state.sending || !!state.operation} onClick={() => void retry()}>Confirm or retry original message</button></>}
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed history and want to discard this recovery record. This does not cancel provider work.</label>
      <button type="button" className="btn btn-secondary" disabled={!reviewed || state.sending || !!state.operation} onClick={() => { client.discardRecovery(true); setReviewed(false); }}>Discard recovery record</button>
    </section>}
    {configure && (pending || state.context) && <button type="button" className="btn btn-secondary" disabled={preparing} onClick={() => void prepareOriginal()}>Prepare original session from history</button>}
    {state.approvals.map(approval => <section key={approval.id} className="codex-approval" aria-label="Codex approval"><h3>{approval.method.includes("fileChange") ? "File change approval" : "Command approval"}</h3><pre>{approval.preview}</pre>
      {approval.truncated && <p role="alert">Details were truncated. Approval is disabled; decline or cancel this request.</p>}
      <div className="codex-page-actions"><button type="button" className="btn btn-primary" disabled={!!state.operation || approval.truncated || !APPROVAL_METHODS.has(approval.method)} onClick={() => void client.answer(approval.id, "accept")}>Allow once</button><button type="button" className="btn btn-secondary" disabled={!!state.operation} onClick={() => void client.answer(approval.id, "decline")}>Decline</button><button type="button" className="btn btn-secondary" disabled={!!state.operation} onClick={() => void client.answer(approval.id, "cancel")}>Cancel request</button></div>
    </section>)}
    <section aria-label="Codex live transcript" aria-busy={state.busy}>{commands.map(command => {
      const user = state.users.find(value => value.receipt.commandId === command), receipt = receipts.get(command) ?? user?.receipt;
      return <article key={command}>{user && <><h4>You</h4><pre>{user.text}</pre></>}<p>{receipt?.status ?? "running"}{receipt?.detail ? ` · ${receipt.detail}` : ""}</p>
        {state.output.filter(item => item.commandId === command).map(item => <section key={item.itemId}><h4>{item.label}{!item.completed ? " · streaming" : ""}</h4><pre>{item.text}</pre></section>)}
        {state.usage.filter(item => item.commandId === command).map(item => <details key={command}><summary>Usage</summary><pre>{item.preview}</pre></details>)}
      </article>;
    })}{state.truncated && <p role="status">Some live output was trimmed. Complete stored history is available in History.</p>}</section>
    {state.notices.map((notice, index) => <details key={index}><summary>{notice.method}</summary><pre>{notice.preview}</pre></details>)}
    <form className="codex-composer" onSubmit={event => { event.preventDefault(); void submit(false); }}><label>Message<textarea value={settings.draft} maxLength={1048576} disabled={!canCompose} onChange={event => workspace.update({ draft: event.target.value })} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); if (canSend) void submit(false); } }} /></label>
      <div className="codex-page-actions"><button type="submit" className="btn btn-primary" disabled={!canSend}>Send now</button><button type="button" className="btn btn-secondary" disabled={!canCompose || !settings.draft.trim()} onClick={() => void submit(true)}>Queue message</button><button type="button" className="btn btn-secondary" disabled={!settings.draft || state.sending} onClick={() => workspace.update({ draft: "" })}>Clear draft</button></div>
    </form>
    {state.context && !state.queue && <div><p>Refresh queue state before sending immediately.</p><button type="button" className="btn btn-secondary" disabled={!!state.operation} onClick={() => void client.refreshQueue()}>Refresh queue</button></div>}
    <Queue client={client} state={state} />
  </section>;
}
export default function CodexConversation({ defaultCwd, requestedThread, onActivity, workspace: injected }: { defaultCwd: string; requestedThread?: CodexThread; onActivity?: (activity: CodexActivity) => void; workspace?: CodexWorkspace }) {
  const [setup] = useState(() => { try { return { workspace: injected ?? desktopCodexWorkspace(defaultCwd), error: null }; } catch (error) { return { workspace: null, error: String(error) }; } });
  return setup.workspace ? <Conversation workspace={setup.workspace} requestedThread={requestedThread} onActivity={onActivity} /> : <p role="alert">{setup.error}</p>;
}
