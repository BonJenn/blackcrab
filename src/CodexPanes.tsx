import { useEffect, useState, useSyncExternalStore } from "react";
import CodexConversation from "./CodexConversation";
import type { CodexActivity } from "./codexActivity";
import { useCodexPage } from "./useCodexPage";
import type { CodexModel, CodexThread } from "./codexClient";
import { CodexDesktop as Desktop, desktopCodexPanes, MAX_CODEX_PANES, MAX_SAVED_CODEX_PANES } from "./codexDesktop";

function Panes({ desktop, requestedThread, onActivity }: { desktop: Desktop; requestedThread?: CodexThread; onActivity?: (activity: CodexActivity) => void }) {
  const state = useSyncExternalStore(desktop.subscribe, desktop.state);
  const [request, setRequest] = useState<{ pane: string; thread: CodexThread }>();
  const [reviewed, setReviewed] = useState(false);
  const activity = desktop.activitySummary();
  const catalog = useCodexPage<CodexModel>({ type: "models", page: { limit: 50 } }, model => model.id);
  useEffect(() => { onActivity?.(activity); }, [onActivity, activity]);
  useEffect(() => {
    // Bind history selection once to its intended owner. Later tab changes must
    // never transfer the requested thread or an existing draft to another pane.
    if (requestedThread) setRequest({ pane: desktop.state().selected, thread: requestedThread });
  }, [requestedThread, desktop]);
  useEffect(() => { setRequest(current => current && !state.panes.includes(current.pane) ? undefined : current); }, [state.panes]);
  return <section className="codex-desktop" aria-label="Codex workspace">
    <p>Each conversation has its own session, draft, queue and approvals. Switching views keeps runs alive. Stop a session before removing its pane. Removed panes remain available in Retained conversations.</p>
    {state.error && <section role="alert"><p>{state.error}</p><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed the saved layout; replace its pane list with the visible panes. Saved drafts, recovery records and provider history are retained; unreadable conversation lists cannot be recovered by this reset.</label><button type="button" className="btn btn-secondary" disabled={!reviewed} onClick={() => { desktop.resetLayout(true); setReviewed(false); }}>Reset saved layout</button></section>}
    <nav aria-label="Codex conversations">{state.panes.map((id, index) => <button key={id} type="button" className="btn btn-secondary" disabled={desktop.layoutBlocked()} aria-pressed={state.selected === id} onClick={() => desktop.select(id)}>Conversation {index + 1}{desktop.activity(id) !== "idle" ? ` · ${desktop.activity(id)}` : ""}</button>)}</nav>
    <div className="codex-page-actions"><button type="button" className="btn btn-secondary" disabled={desktop.layoutBlocked() || state.panes.length >= MAX_CODEX_PANES || state.panes.length + state.retained.length >= MAX_SAVED_CODEX_PANES} onClick={() => desktop.add()}>Add conversation</button>
      <button type="button" className="btn btn-secondary" disabled={desktop.layoutBlocked()} aria-pressed={state.layout === "single"} onClick={() => desktop.layout("single")}>Single view</button>
      <button type="button" className="btn btn-secondary" disabled={desktop.layoutBlocked()} aria-pressed={state.layout === "grid"} onClick={() => desktop.layout("grid")}>Grid view</button>
    </div>
    {state.retained.length > 0 && <section aria-label="Retained conversations">
      <h3>Retained conversations</h3><p>Reopen a removed pane with its original saved settings and message recovery records. Reopening only inspects its session; it never starts or submits work. The workspace keeps up to {MAX_SAVED_CODEX_PANES} active and retained conversations; reopen a retained conversation when that limit is reached.</p>
      {state.retained.map((id, index) => <button key={id} type="button" className="btn btn-secondary" disabled={desktop.layoutBlocked() || state.panes.length >= MAX_CODEX_PANES} title={id} onClick={() => desktop.reopen(id)}>Reopen retained conversation {index + 1}</button>)}
      {state.panes.length >= MAX_CODEX_PANES && <p>Remove a stopped pane before reopening a retained conversation.</p>}
    </section>}
    <div className={`codex-panes codex-panes-${state.layout}`}>{state.panes.map((id, index) => {
      const problem = desktop.removalProblem(id);
      return <section key={id} className="codex-pane" aria-label={`Conversation ${index + 1}`} data-selected={state.selected === id} hidden={state.layout === "single" && state.selected !== id} onPointerDownCapture={() => desktop.select(id)} onFocusCapture={() => desktop.select(id)}>
        <header><h3>Conversation {index + 1}</h3>{id !== "primary" && <button type="button" className="btn btn-secondary" disabled={!!problem} title={problem ?? "Close this pane; stored history is retained"} onClick={() => desktop.remove(id)}>Remove pane</button>}</header>
        <CodexConversation defaultCwd="" workspace={desktop.workspace(id)} catalog={catalog} requestedThread={request?.pane === id ? request.thread : undefined} />
      </section>;
    })}</div>
  </section>;
}
export default function CodexDesktop({ defaultCwd, requestedThread, onActivity, desktop: injected }: { defaultCwd: string; requestedThread?: CodexThread; onActivity?: (activity: CodexActivity) => void; desktop?: Desktop }) {
  const [setup] = useState(() => { try { return { desktop: injected ?? desktopCodexPanes(defaultCwd), error: null }; } catch (error) { return { desktop: null, error: String(error) }; } });
  return setup.desktop ? <Panes desktop={setup.desktop} requestedThread={requestedThread} onActivity={onActivity} /> : <p role="alert">{setup.error}</p>;
}
