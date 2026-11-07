import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ExecutionContext = { threadId: string; runId: string; processFinished: boolean };
export type TurnReceipt = { commandId: string; threadId: string; turnId: string; status: string; detail?: string | null };
export type QueueItem = { commandId: string; turnId: string; text: string; createdAtMs: number; updatedAtMs: number };
export type QueueSnapshot = { threadId: string; revision: number; paused: boolean; items: QueueItem[] };
export type QueueChange =
  | { type: "edit"; commandId: string; text: string }
  | { type: "cancel"; commandId: string }
  | { type: "reorder"; commandIds: string[] }
  | { type: "pause" | "resume" };
export type QueueEvent = { panel_id: string; thread_id: string; run_id: string };
export type DispatchEvent = QueueEvent & { text: string; receipt: TurnReceipt };
export type DraftIdentity = { draftText?: string; draftKey?: string; attachmentIds: string[] };
export type Submission = DraftIdentity & { version: 1; commandId: string; threadId: string; text: string };
export type AcceptedEvent = { panelId: string; submission: Submission };
export type QueueState = {
  context: ExecutionContext | null;
  queue: QueueSnapshot | null;
  loading: boolean;
  saving: boolean;
  pending: Submission | null;
  error: string | null;
};
export interface QueueBackend {
  context(panelId: string): Promise<ExecutionContext>;
  queue(panelId: string): Promise<QueueSnapshot>;
  savedQueue(sessionId: string): Promise<QueueSnapshot | null>;
  enqueue(panelId: string, text: string, commandId: string): Promise<TurnReceipt>;
  change(panelId: string, expectedRevision: number, change: QueueChange): Promise<QueueSnapshot>;
  receipt(commandId: string): Promise<TurnReceipt>;
  onChanged(callback: (event: QueueEvent) => void): Promise<() => void>;
  onDispatched(callback: (event: DispatchEvent) => void): Promise<() => void>;
}
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Panel = { state: QueueState; epoch: number; read: number; sessionId?: string; seen: Set<string>; listeners: Set<() => void> };
const EMPTY: QueueState = { context: null, queue: null, loading: false, saving: false, pending: null, error: null };
const RECOVERY_PREFIX = "blackcrab.queueSubmission.v1.";

export class QueueController {
  private attaching = new Map<string, Promise<void>>();
  private panels = new Map<string, Panel>();
  private dispatchListeners = new Set<(event: DispatchEvent) => void>();
  private preparedListeners = new Set<(event: AcceptedEvent) => void>();
  private acceptedListeners = new Set<(event: AcceptedEvent) => void>();
  private ready: Promise<void> | null = null;
  private unlisten: Array<() => void> = [];
  private disposed = false;

  constructor(private backend: QueueBackend, private storage: RecoveryStorage, private makeId: () => string = () => crypto.randomUUID()) {}

  private panel(id: string): Panel {
    let panel = this.panels.get(id);
    if (!panel) {
      panel = { state: EMPTY, epoch: 0, read: 0, seen: new Set(), listeners: new Set() };
      this.panels.set(id, panel);
    }
    return panel;
  }
  state = (id: string): QueueState => this.panel(id).state;
  acceptsRun(id: string, runId?: string): boolean {
    const context = this.panel(id).state.context;
    return !runId || !context || context.runId === runId;
  }
  subscribe = (id: string, callback: () => void): (() => void) => {
    const panel = this.panel(id);
    panel.listeners.add(callback);
    return () => panel.listeners.delete(callback);
  };
  onDispatch(callback: (event: DispatchEvent) => void): () => void {
    this.dispatchListeners.add(callback);
    return () => this.dispatchListeners.delete(callback);
  }
  onPrepared(callback: (event: AcceptedEvent) => void): () => void {
    this.preparedListeners.add(callback);
    return () => this.preparedListeners.delete(callback);
  }
  onAccepted(callback: (event: AcceptedEvent) => void): () => void {
    this.acceptedListeners.add(callback);
    return () => this.acceptedListeners.delete(callback);
  }
  private update(panel: Panel, patch: Partial<QueueState>) {
    panel.state = { ...panel.state, ...patch };
    panel.listeners.forEach(callback => callback());
  }
  report(id: string, error: unknown) { this.update(this.panel(id), { error: String(error) }); }
  startFailed(id: string, error: unknown) { this.update(this.panel(id), { loading: false, saving: false, error: String(error) }); }

  async connect(): Promise<void> {
    if (this.disposed) throw new Error("Queue connection closed");
    if (!this.ready) {
      const owned: Array<() => void> = [];
      const collect = (off: () => void) => {
        let closed = false;
        const once = () => { if (!closed) { closed = true; off(); } };
        if (this.disposed) once();
        else { owned.push(once); this.unlisten.push(once); }
      };
      this.ready = Promise.allSettled([
        this.backend.onChanged(event => {
          const panel = this.panels.get(event.panel_id);
          if (panel?.state.context?.runId === event.run_id) void this.refresh(event.panel_id);
        }).then(collect),
        this.backend.onDispatched(event => {
          const panel = this.panels.get(event.panel_id);
          if (!panel || panel.state.context?.runId !== event.run_id || panel.state.context.threadId !== event.thread_id || event.receipt?.threadId !== event.thread_id || typeof event.text !== "string" || panel.seen.has(event.receipt.commandId)) return;
          panel.seen.add(event.receipt.commandId);
          this.dispatchListeners.forEach(callback => callback(event));
        }).then(collect),
      ]).then(results => {
        const failed = results.find(result => result.status === "rejected");
        if (failed?.status === "rejected") {
          owned.forEach(off => off());
          this.unlisten = this.unlisten.filter(off => !owned.includes(off));
          this.ready = null;
          throw failed.reason;
        }
        if (this.disposed) owned.forEach(off => off());
      });
    }
    await this.ready;
    if (this.disposed) throw new Error("Queue connection closed");
  }
  dispose() {
    this.disposed = true;
    this.unlisten.splice(0).forEach(off => off());
    this.dispatchListeners.clear();
    this.acceptedListeners.clear();
    this.preparedListeners.clear();
  }
  invalidate(id: string, sessionId?: string) {
    const panel = this.panel(id);
    this.attaching.delete(id);
    panel.sessionId = sessionId;
    panel.epoch++;
    panel.read++;
    panel.seen.clear();
    this.update(panel, { context: null, queue: null, pending: null, saving: false, loading: true });
  }
  private recover(threadId: string): Submission | null {
    const raw = this.storage.getItem(RECOVERY_PREFIX + threadId);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<Submission>;
    if (record.version !== 1 || record.threadId !== threadId || typeof record.commandId !== "string" || !record.commandId || typeof record.text !== "string" || !record.text.trim() || (record.draftText !== undefined && typeof record.draftText !== "string") || (record.draftKey !== undefined && typeof record.draftKey !== "string") || !Array.isArray(record.attachmentIds) || !record.attachmentIds.every(id => typeof id === "string")) throw new Error("Could not read the unconfirmed message. Your composer draft is unchanged.");
    return record as Submission;
  }
  attach(id: string, sessionId?: string): Promise<void> {
    const existing = this.attaching.get(id);
    if (existing) return existing;
    const pending = this.loadAttachment(id, sessionId).finally(() => {
      if (this.attaching.get(id) === pending) this.attaching.delete(id);
    });
    this.attaching.set(id,pending);
    return pending;
  }
  private async loadAttachment(id: string, sessionId?: string): Promise<void> {
    const panel = this.panel(id);
    panel.sessionId = sessionId || panel.sessionId;
    const epoch = ++panel.epoch;
    const read = ++panel.read;
    this.update(panel, { loading: true, error: null });
    try {
      await this.connect();
      const [context, queue] = await Promise.all([this.backend.context(id), this.backend.queue(id)]);
      const latest = await this.backend.context(id);
      if (context.runId !== latest.runId || queue.threadId !== latest.threadId) throw new Error("Session changed while loading its queue. Reload and try again.");
      if (panel.epoch !== epoch || panel.read !== read) return;
      if (panel.state.context?.runId !== context.runId) {
        panel.seen.clear();
        this.update(panel, { saving: false });
      }
      this.update(panel, { context, queue, pending: this.recover(context.threadId), loading: false });
    } catch (error) {
      if (panel.epoch === epoch && panel.read === read) this.update(panel, { loading: false, error: String(error) });
      throw error;
    }
  }
  async refresh(id: string, sessionId?: string, live = true): Promise<void> {
    const attaching = this.attaching.get(id);
    if (attaching) {
      try { await attaching; } catch (error) { this.report(id,error); }
      return;
    }
    const panel = this.panel(id);
    panel.sessionId = sessionId || panel.sessionId;
    const epoch = panel.epoch;
    const read = ++panel.read;
    try {
      if (live && !panel.state.context) { await this.attach(id,panel.sessionId); return; }
      if (!live) {
        const queue = panel.sessionId ? await this.backend.savedQueue(panel.sessionId) : null;
        if (panel.epoch === epoch && panel.read === read) this.update(panel, { queue, loading: false, pending: queue ? this.recover(queue.threadId) : panel.state.pending });
        return;
      }
      const [context, queue] = await Promise.all([this.backend.context(id), this.backend.queue(id)]);
      if (panel.epoch !== epoch || panel.read !== read || context.runId !== panel.state.context?.runId || context.threadId !== queue.threadId) return;
      if (panel.state.queue?.threadId === queue.threadId && panel.state.queue.revision > queue.revision) return;
      this.update(panel, { context, queue, loading: false });
    } catch (error) {
      if (panel.epoch !== epoch || panel.read !== read) return;
      if (panel.sessionId) {
        try {
          const queue = await this.backend.savedQueue(panel.sessionId);
          if (panel.epoch === epoch && panel.read === read) this.update(panel, { context: null, queue, loading: false });
          return;
        } catch { /* Show the original connection error below. */ }
      }
      this.update(panel, { loading: false, error: String(error) });
    }
  }
  async submit(id: string, text: string, draft: DraftIdentity = { attachmentIds: [] }, commandId = this.makeId()): Promise<boolean> {
    const panel = this.panel(id);
    if (panel.state.saving) return false;
    if (panel.state.pending) { this.report(id, "Confirm the previous queued message before sending another."); return false; }
    if (!panel.state.context || panel.state.context.processFinished) { this.report(id, "Resume the session before sending."); return false; }
    const submission: Submission = { version: 1, commandId, threadId: panel.state.context.threadId, text, ...draft };
    try { this.storage.setItem(RECOVERY_PREFIX + submission.threadId, JSON.stringify(submission)); }
    catch { this.report(id, "Could not save the message for retry. Your draft is unchanged."); return false; }
    this.update(panel, { pending: submission });
    this.preparedListeners.forEach(callback => callback({panelId:id,submission}));
    return this.attempt(id, submission);
  }
  async retry(id: string): Promise<boolean> {
    const panel = this.panel(id);
    if (!panel.state.pending || panel.state.saving) return false;
    return this.attempt(id, panel.state.pending);
  }
  private async attempt(id: string, submission: Submission): Promise<boolean> {
    const panel = this.panel(id);
    if (panel.state.context?.threadId !== submission.threadId || panel.state.context.processFinished) {
      this.report(id, "Resume the original session before retrying this message.");
      return false;
    }
    const epoch = panel.epoch;
    this.update(panel, { saving: true, error: null });
    let receipt: TurnReceipt;
    try {
      await this.connect();
      try { receipt = await this.backend.enqueue(id, submission.text, submission.commandId); }
      catch (error) {
        try { receipt = await this.backend.receipt(submission.commandId); }
        catch { throw error; }
      }
      if (receipt.threadId !== submission.threadId) throw new Error("The message belongs to a different session.");
      let cleared = true;
      try {
        if (this.recover(submission.threadId)?.commandId === submission.commandId) this.storage.removeItem(RECOVERY_PREFIX + submission.threadId);
      }
      catch { cleared = false; }
      if (panel.epoch === epoch) this.update(panel, {
        pending: cleared ? null : submission,
        error: !cleared ? "Message accepted. Retry to finish confirming it." : ["uncertain", "failed", "interrupted"].includes(receipt.status) ? `Message ${receipt.status}. Review the conversation before continuing.` : null,
      });
      this.acceptedListeners.forEach(callback => callback({ panelId: id, submission }));
      return true;
    } catch (error) {
      if (panel.epoch === epoch) this.update(panel, { pending: submission, error: `Could not confirm the queued message. Retry safely. ${String(error)}` });
      return false;
    } finally {
      if (panel.epoch === epoch) this.update(panel, { saving: false });
      if (panel.epoch === epoch) await this.refresh(id);
    }
  }
  async mutate(id: string, change: QueueChange, expectedRevision?: number): Promise<boolean> {
    const panel = this.panel(id);
    if (panel.state.saving || !panel.state.queue) return false;
    const epoch = panel.epoch;
    this.update(panel, { saving: true, error: null });
    try {
      const queue = await this.backend.change(id, expectedRevision ?? panel.state.queue.revision, change);
      if (panel.epoch === epoch && (!panel.state.queue || panel.state.queue.revision <= queue.revision)) this.update(panel, { queue });
      return true;
    } catch (error) { if (panel.epoch === epoch) this.report(id, error); return false; }
    finally {
      if (panel.epoch === epoch) this.update(panel, { saving: false });
      if (panel.epoch === epoch) await this.refresh(id);
    }
  }
  async retryDenied(id: string, text: string): Promise<void> {
    const panel = this.panel(id);
    const commandId = this.makeId();
    if (!await this.submit(id, text, { attachmentIds: [] }, commandId)) return;
    const queue = panel.state.queue;
    if (!queue?.paused) return;
    const replay = queue.items.find(item => item.commandId === commandId);
    if (!replay || replay.text !== text) { this.report(id, "Review the paused queue before resuming."); return; }
    if (queue.items.length > 1 && !await this.mutate(id, { type: "reorder", commandIds: [replay.commandId, ...queue.items.filter(item => item.commandId !== replay.commandId).map(item => item.commandId)] })) return;
    await this.mutate(id, { type: "resume" });
  }
}

const backend: QueueBackend = {
  context: panelId => invoke("session_execution", { panelId }),
  queue: panelId => invoke("session_queue", { panelId }),
  savedQueue: sessionId => invoke("execution_queue", { sessionId }),
  enqueue: (panelId, text, commandId) => invoke("queue_message", { panelId, text, commandId }),
  change: (panelId, expectedRevision, change) => invoke("update_session_queue", { panelId, expectedRevision, change }),
  receipt: commandId => invoke("execution_receipt", { commandId }),
  onChanged: callback => listen<QueueEvent>("execution-queue-changed", event => callback(event.payload)),
  onDispatched: callback => listen<DispatchEvent>("execution-queue-dispatched", event => callback(event.payload)),
};
export const queueClient = new QueueController(backend, {
  getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key),
});
export async function startQueuedSession(options: Record<string, unknown> & { panelId: string; resumeId?: string | null }): Promise<void> {
  queueClient.invalidate(options.panelId, options.resumeId || undefined);
  try { await invoke("start_session", options); }
  catch (error) { queueClient.startFailed(options.panelId, error); throw error; }
  try { await queueClient.attach(options.panelId, options.resumeId || undefined); }
  catch (error) { queueClient.report(options.panelId, error); }
}
if (import.meta.hot) import.meta.hot.dispose(() => queueClient.dispose());
