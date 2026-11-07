import { useId, useState } from "react";
import { queueClient, type QueueChange, type QueueState } from "./queueClient";

export function QueueControls({ panelId, state, busy, ensureSession, live, sessionId, compact = false }: {
  panelId: string; state: QueueState; busy: boolean; ensureSession: () => Promise<void>; live: boolean; sessionId?: string; compact?: boolean;
}) {
  const titleId = useId();
  const [expanded,setExpanded] = useState(!compact);
  const [editing, setEditing] = useState<{ id: string; text: string; revision: number } | null>(null);
  const items = state.queue?.items ?? [];
  const disabled = state.saving || state.loading;
  if (!items.length && !state.pending && !state.error) return null;
  async function change(value: QueueChange, revision = state.queue?.revision) {
    try {
      await ensureSession();
      return await queueClient.mutate(panelId, value, revision);
    } catch (error) { queueClient.report(panelId, error); return false; }
  }
  async function retry() {
    try { await ensureSession(); await queueClient.retry(panelId); }
    catch (error) { queueClient.report(panelId, error); }
  }
  function move(id: string, direction: number) {
    const order = items.map(item => item.commandId);
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void change({ type: "reorder", commandIds: order });
  }
  return <section className="followup-queue" aria-labelledby={titleId}>
    <div className="followup-head">
      <h3 id={titleId}><button type="button" className="followup-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Queue <span>{items.length}</span></button></h3>
      {items.length > 0 && <button type="button" className="btn btn-secondary" disabled={disabled || (state.queue?.paused && busy)} onClick={() => void change({ type: state.queue?.paused ? "resume" : "pause" })}>
        {state.queue?.paused ? "Resume queue" : "Pause queue"}
      </button>}
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => void queueClient.refresh(panelId, sessionId, live)}>Refresh</button>
    </div>
    {state.queue?.paused && items.length > 0 && <p className="followup-hint">Queued messages are paused. Review the conversation before resuming.</p>}
    {state.error && <p className="followup-error" role="alert">{state.error}</p>}
    {state.pending && <div className="followup-pending" role="status">
      <span>{state.saving ? "Confirming message…" : "Message needs confirmation."}</span>
      <pre>{state.pending.text}</pre>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => void retry()}>Retry message</button>
    </div>}
    {expanded && <ol className="followup-list">
      {items.map((item, index) => <li key={item.commandId}>
        {editing?.id === item.commandId ? <form onSubmit={event => {
          event.preventDefault();
          void change({ type: "edit", commandId: item.commandId, text: editing.text }, editing.revision).then(saved => { if (saved) setEditing(null); });
        }}>
          <textarea autoFocus aria-label="Edit queued message" value={editing.text} disabled={disabled} onChange={event => setEditing({ id: item.commandId, text: event.target.value, revision: editing.revision })} />
          {editing.revision !== state.queue?.revision && <p className="followup-hint" role="status">Queue changed. Cancel this edit to review the latest message.</p>}
          <div className="followup-actions">
            <button type="submit" className="btn btn-secondary" disabled={disabled || !editing.text.trim() || editing.revision !== state.queue?.revision}>Save message</button>
            <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => setEditing(null)}>Cancel edit</button>
          </div>
        </form> : <>
          <pre>{item.text}</pre>
          <div className="followup-actions">
            <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => setEditing({ id: item.commandId, text: item.text, revision: state.queue?.revision ?? 0 })}>Edit</button>
            <button type="button" className="btn btn-secondary" disabled={disabled || index === 0} aria-label={`Move queued message ${index + 1} up`} onClick={() => move(item.commandId, -1)}>↑</button>
            <button type="button" className="btn btn-secondary" disabled={disabled || index === items.length - 1} aria-label={`Move queued message ${index + 1} down`} onClick={() => move(item.commandId, 1)}>↓</button>
            <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => void change({ type: "cancel", commandId: item.commandId })}>Remove</button>
          </div>
        </>}
      </li>)}
    </ol>}
  </section>;
}
