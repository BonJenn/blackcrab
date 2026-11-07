import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { codexQuery, historyItem, type CodexAccount, type CodexItem, type CodexModel, type CodexThread, type CodexTurn } from "./codexClient";
import { useCodexPage } from "./useCodexPage";
import "./CodexHistory.css";
import type { CodexActivity } from "./CodexConversation";
import { ProviderSwitcher } from "./ProviderSwitcher";
const CodexDesktop = lazy(() => import("./CodexPanes"));

type Tab = "history" | "models" | "account" | "conversation";
function date(seconds: number) { return new Date(seconds * 1000).toLocaleString(); }
function ItemView({ item }: { item: unknown }) {
  const value = historyItem(item);
  return <details className="codex-history-item"><summary>{value.type}</summary><pre>{value.text}</pre></details>;
}
function PageActions({ page }: { page: { loading: boolean; error: string | null; nextCursor: string | null; refresh: () => void; more: () => void } }) {
  return <div className="codex-page-actions">
    {page.loading && <p role="status">Loading…</p>}
    {page.error && <p role="alert">{page.error}</p>}
    <button type="button" className="btn btn-secondary" disabled={page.loading} onClick={page.refresh}>Refresh</button>
    {page.nextCursor && <button type="button" className="btn btn-secondary" disabled={page.loading} onClick={page.more}>{page.error ? "Retry next page" : "Load more"}</button>}
  </div>;
}
function ThreadHistory({ thread, onChoose }: { thread: CodexThread; onChoose: (thread: CodexThread) => void }) {
  const [fullTurns, setFullTurns] = useState(false);
  const [turn, setTurn] = useState<string>();
  const turns = useCodexPage<CodexTurn>({ type: "turns", threadId: thread.id, page: { limit: 20 }, itemsView: fullTurns ? "full" : "notLoaded" }, value => value.id);
  const items = useCodexPage<CodexItem>(turn ? { type: "items", threadId: thread.id, turnId: turn, page: { limit: 50 } } : null, value => `${value.turnId}:${historyItem(value.item).id ?? JSON.stringify(value.item)}`);
  return <section aria-label="Codex thread history">
    <h3>{thread.name || thread.preview || thread.id}</h3>
    <button type="button" className="btn btn-secondary" onClick={() => onChoose(thread)}>Continue in conversation</button>
    <p>{thread.cwd} · {thread.modelProvider}{thread.model ? ` · ${thread.model}` : ""}</p>
    <p>Updated {date(thread.updatedAt)}. Stored history; live output may be newer.</p>
    <label><input type="checkbox" checked={fullTurns} onChange={event => { setFullTurns(event.target.checked); setTurn(undefined); }} /> Include full items in each turn page (legacy history)</label>
    <PageActions page={turns} />
    {!turns.loading && !turns.error && !turns.data.length && <p>No stored turns.</p>}
    <ol className="codex-history-turns">{turns.data.map(value => <li key={value.id}>
      <h4>{value.status} · {value.id}</h4>
      {value.startedAt != null && <p>{date(value.startedAt)}</p>}
      {value.error != null && <pre>{JSON.stringify(value.error, null, 2)}</pre>}
      {value.itemsView !== "notLoaded" && value.items.map((item, index) => <ItemView key={historyItem(item).id ?? index} item={item} />)}
      {!fullTurns && <button type="button" className="btn btn-secondary" aria-pressed={turn === value.id} onClick={() => setTurn(value.id)}>View items</button>}
    </li>)}</ol>
    {turn && <section aria-label="Codex turn items"><h4>Items for {turn}</h4><PageActions page={items} />
      {items.data.map((value, index) => <ItemView key={historyItem(value.item).id ?? index} item={value.item} />)}
      {!items.loading && !items.error && !items.data.length && <p>No stored items.</p>}
      {items.error && <p>If this history does not support item pages, select full items in each turn page above.</p>}
    </section>}
  </section>;
}
function HistoryBrowser({ onChoose }: { onChoose: (thread: CodexThread) => void }) {
  const [cwd, setCwd] = useState("");
  const [filter, setFilter] = useState<string>();
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<CodexThread>();
  const threads = useCodexPage<CodexThread>({ type: "threads", page: { limit: 30 }, cwd: filter, archived }, value => value.id);
  return <>
    <form className="codex-history-filter" onSubmit={event => { event.preventDefault(); setFilter(cwd.trim() || undefined); setSelected(undefined); }}>
      <label>Project directory<input value={cwd} onChange={event => setCwd(event.target.value)} placeholder="All projects, or an absolute path" /></label>
      <button type="submit" className="btn btn-secondary">Apply filter</button>
      <label><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setSelected(undefined); }} /> Archived only</label>
    </form>
    <p>CLI, VS Code and app-server history. Older unindexed history may require repair in the Codex CLI.</p>
    <div className="codex-history-columns">
      <section aria-label="Codex threads"><PageActions page={threads} />
        {!threads.loading && !threads.error && !threads.data.length && <p>No stored threads match these filters.</p>}
        <ul className="codex-thread-list">{threads.data.map(thread => <li key={thread.id}><button type="button" aria-pressed={selected?.id === thread.id} onClick={() => setSelected(thread)}>
          <strong>{thread.name || thread.preview || thread.id}</strong><span>{thread.cwd}</span><span>{thread.modelProvider} · {date(thread.updatedAt)}</span>
        </button></li>)}</ul>
      </section>
      {selected ? <ThreadHistory key={selected.id} thread={selected} onChoose={onChoose} /> : <p>Select a thread to read its stored turns.</p>}
    </div>
  </>;
}
function Models() {
  const models = useCodexPage<CodexModel>({ type: "models", page: { limit: 50 } }, value => value.id);
  return <section aria-label="Codex models"><p>Models and options advertised by your configured CLI. Availability can change with your account and provider.</p><PageActions page={models} />
    {models.data.map(model => <article key={model.id}><h3>{model.displayName}{model.isDefault ? " (default)" : ""}</h3><code>{model.model}</code><p>{model.description}</p>
      <p>Input: {model.inputModalities.join(", ") || "Not specified"}</p>
      <h4>Reasoning effort</h4><ul>{model.supportedReasoningEfforts.map(effort => <li key={effort.reasoningEffort}><strong>{effort.reasoningEffort}{effort.reasoningEffort === model.defaultReasoningEffort ? " (default)" : ""}</strong>: {effort.description}</li>)}</ul>
      {model.serviceTiers.length > 0 && <><h4>Service tiers</h4><ul>{model.serviceTiers.map(tier => <li key={tier.id}>{tier.name}{tier.id === model.defaultServiceTier ? " (default)" : ""}: {tier.description}</li>)}</ul></>}
    </article>)}
    {!models.loading && !models.error && !models.data.length && <p>No models advertised.</p>}
  </section>;
}
function Account() {
  const [state, setState] = useState<{ data?: CodexAccount; loading: boolean; error?: string }>({ loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    void codexQuery({ type: "account" }).then(data => { if (!cancelled) setState({ data, loading: false }); }, error => { if (!cancelled) setState({ error: String(error), loading: false }); });
    return () => { cancelled = true; };
  }, [revision]);
  return <section aria-label="Codex account"><h3>CLI account</h3>
    {state.loading && <p role="status">Loading account…</p>}{state.error && <p role="alert">{state.error}</p>}
    {state.data && <>{state.data.account ? <dl><dt>Type</dt><dd>{state.data.account.type}</dd>{state.data.account.email && <><dt>Email</dt><dd>{state.data.account.email}</dd></>}{state.data.account.planType && <><dt>Plan</dt><dd>{state.data.account.planType}</dd></>}{state.data.account.workspaceName && <><dt>Workspace</dt><dd>{state.data.account.workspaceName}</dd></>}</dl> : <p>No account is configured.</p>}<p>{state.data.requiresOpenaiAuth ? "This provider requires OpenAI authentication." : "This provider does not require OpenAI authentication."}</p></>}
    <p>Configure login and account changes in the Codex CLI.</p><button type="button" className="btn btn-secondary" disabled={state.loading} onClick={() => setRevision(value => value + 1)}>Refresh account</button>
  </section>;
}
export default function CodexHistory({ onClose, open = true, defaultCwd = "", onActivity, presentation = "dialog", saveError }: { onClose: () => void; open?: boolean; defaultCwd?: string; onActivity?: (activity: CodexActivity) => void; presentation?: "dialog" | "workspace"; saveError?: string | null }) {
  const [tab, setTab] = useState<Tab>("history");
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [requestedThread, setRequestedThread] = useState<CodexThread>();
  const chooseThread = useCallback((thread: CodexThread) => { setRequestedThread({ ...thread }); setConversationLoaded(true); setTab("conversation"); }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const title = useId();
  useEffect(() => {
    if (!open) return;
    const node = presentation === "workspace" ? workspace.current : dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (presentation === "dialog" && dialog.current && !dialog.current.open) dialog.current.showModal();
    node?.querySelector<HTMLElement>("select, button")?.focus();
    return () => { if (dialog.current?.open) dialog.current.close(); if (previous?.isConnected) previous.focus(); };
  }, [open, presentation]);
  const content = <>
    <header><h2 id={title}>{presentation === "workspace" ? "Blackcrab · Codex" : "Codex"}</h2>{presentation === "workspace" ? <ProviderSwitcher provider="codex" onChange={value => { if (value === "claude") onClose(); }} error={saveError} /> : <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}</header>
    <p>Read your CLI history, models and account, or open a conversation preview.</p>
    <nav aria-label="Codex sections">{(["history", "models", "account", "conversation"] as const).map(value => <button key={value} type="button" className="btn btn-secondary" aria-pressed={tab === value} onClick={() => { if (value === "conversation") setConversationLoaded(true); setTab(value); }}>{value[0].toUpperCase() + value.slice(1)}</button>)}</nav>
    <div className="codex-history-body">{tab === "history" ? <HistoryBrowser onChoose={chooseThread} /> : tab === "models" ? <Models /> : tab === "account" ? <Account /> : null}
      {conversationLoaded && <div hidden={tab !== "conversation"}><Suspense fallback={<p role="status">Loading conversation…</p>}><CodexDesktop defaultCwd={defaultCwd} requestedThread={requestedThread} onActivity={onActivity} /></Suspense></div>}
    </div>
  </>;
  return presentation === "workspace" ? <main className="codex-history-surface codex-history-workspace" ref={workspace} hidden={!open} inert={!open} aria-labelledby={title}>{content}</main> : <dialog className="codex-history-surface codex-history-dialog" ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose(); }}>{content}</dialog>;
}
