import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { codexContext, codexControl, type CodexAction, type CodexContext } from "./codexControl";
import { historyItem } from "./codexClient";
import type { QueueChange, QueueSnapshot, TurnReceipt } from "./queueClient";

export type CodexLaunch = { cwd: string; model?: string; permissionMode: "default" | "readOnly"; resumeId?: string };
export type CodexInfo = { threadId: string; providerThreadId: string; runId: string; model: string; cwd: string };
export type CodexEnvelope = { provider: string; panel_id: string; run_id: string; event: unknown };
export type CodexPending = { version: 1; provider: "codex"; panelId: string; threadId: string; providerSessionId: string; runId: string; commandId: string; text: string; queued: boolean };
export type CodexOutput = { commandId: string; itemId: string; label: string; text: string; completed: boolean; truncated: boolean };
export type CodexApproval = { id: string; commandId: string; providerTurnId: string; method: string; preview: string };
export type CodexLiveState = {
  phase: "idle" | "starting" | "live" | "detached" | "stopping" | "stopped";
  context: CodexContext | null;
  info: CodexInfo | null;
  busy: boolean;
  sending: boolean;
  operation: string | null;
  pending: CodexPending | null;
  recoveryBlocked: boolean;
  queue: QueueSnapshot | null;
  users: Array<{ text: string; receipt: TurnReceipt }>;
  receipts: TurnReceipt[];
  notices: Array<{ method: string; preview: string }>;
  output: CodexOutput[];
  approvals: CodexApproval[];
  usage: Array<{ commandId: string; preview: string }>;
  truncated: boolean;
  error: string | null;
};
export interface CodexLiveBackend {
  listen(callback: (event: CodexEnvelope) => void): Promise<() => void>;
  context(panelId: string): Promise<CodexContext | null>;
  start(panelId: string, launch: CodexLaunch): Promise<void>;
  control: typeof codexControl;
  receipt(commandId: string): Promise<TurnReceipt>;
  savedQueue(providerSessionId: string): Promise<QueueSnapshot | null>;
}
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const CODEX_OUTBOX_PREFIX = "blackcrab.codexOutbox.v1.";
const TEXT_LIMIT = 128 * 1024;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const TERMINAL = new Set(["succeeded", "failed", "interrupted", "uncertain", "cancelled"]);
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function validReceipt(value: unknown, thread: string, command?: string): value is TurnReceipt {
  return object(value) && value.threadId === thread && string(value.commandId) && (!command || value.commandId === command) && string(value.turnId) && string(value.status);
}
function validQueue(value: unknown, thread: string): value is QueueSnapshot {
  return object(value) && value.threadId === thread && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && typeof value.paused === "boolean" && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(item => object(item) && string(item.commandId) && string(item.turnId) && typeof item.text === "string");
}
function parsePending(value: string, panelId: string): CodexPending {
  const pending: unknown = JSON.parse(value);
  if (!object(pending) || pending.version !== 1 || pending.provider !== "codex" || pending.panelId !== panelId || ![pending.threadId, pending.providerSessionId, pending.runId, pending.commandId].every(string) || typeof pending.text !== "string" || !pending.text.trim() || pending.text.length > 1024 * 1024 || typeof pending.queued !== "boolean") throw new Error("Unconfirmed Codex message cannot be read; review history before discarding recovery data");
  return pending as CodexPending;
}
function preview(value: unknown, limit = TEXT_LIMIT): string { return (typeof value === "string" ? value : JSON.stringify(value) ?? "").slice(0, limit); }

/** One owner per panel. Persistence covers unconfirmed sends, never provider output. */
export class CodexLiveClient {
  private value: CodexLiveState = { phase: "idle", context: null, info: null, busy: false, sending: false, operation: null, pending: null, recoveryBlocked: false, queue: null, users: [], receipts: [], notices: [], output: [], approvals: [], usage: [], truncated: false, error: null };
  private subscribers = new Set<() => void>();
  private epoch = 0;
  private queueRead = 0;
  private disposed = false;
  private connected: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private early = new Map<string, CodexInfo>();
  private active: string | null = null;
  private turns = new Map<string, string>();
  private receipts = new Map<string, TurnReceipt>();
  private resolvedApprovals = new Set<string>();
  readonly key: string;
  constructor(readonly panelId: string, private backend: CodexLiveBackend, private storage: StorageAccess, private makeId: () => string = () => crypto.randomUUID()) {
    this.key = CODEX_OUTBOX_PREFIX + panelId;
    try { const raw = storage.getItem(this.key); if (raw !== null) this.value.pending = parsePending(raw, panelId); }
    catch (error) { this.value.recoveryBlocked = true; this.value.error = String(error); }
  }
  state = (): CodexLiveState => this.value;
  subscribe = (callback: () => void): (() => void) => { this.subscribers.add(callback); return () => { this.subscribers.delete(callback); }; };
  private update(patch: Partial<CodexLiveState>) {
    if (this.disposed) return;
    this.value = { ...this.value, ...patch };
    this.subscribers.forEach(callback => callback());
  }
  private current(epoch: number) { return !this.disposed && epoch === this.epoch; }
  private fail(error: unknown) { this.update({ error: String(error) }); return false; }
  async connect(): Promise<void> {
    if (this.disposed) throw new Error("Codex client closed");
    if (!this.connected) this.connected = this.backend.listen(event => this.receive(event)).then(off => { if (this.disposed) off(); else this.unlisten = off; }, error => { this.connected = null; throw error; });
    return this.connected;
  }
  async inspect(): Promise<boolean> {
    if (this.disposed || this.value.operation || this.value.sending || this.value.phase === "live") return false;
    const epoch = ++this.epoch;
    this.update({ operation: "inspect", error: null });
    try {
      await this.connect();
      const context = await this.backend.context(this.panelId);
      if (!this.current(epoch)) return false;
      if (context?.runId !== this.value.context?.runId) {
        this.active = null; this.turns.clear(); this.receipts.clear(); this.resolvedApprovals.clear();
        this.update({ queue: null, users: [], receipts: [], output: [], usage: [], notices: [], truncated: false });
      }
      this.update({ context, phase: context ? context.processFinished ? "stopped" : "detached" : "idle", busy: !!context && !context.processFinished, approvals: [], info: null,
        error: context && !context.processFinished ? "A Codex run is already present. Review history, then explicitly stop it before resuming; live state was not replayed." : null });
      return true;
    } catch (error) { if (this.current(epoch)) this.fail(error); return false; }
    finally { if (this.current(epoch)) this.update({ operation: null }); }
  }
  async start(launch: CodexLaunch): Promise<boolean> {
    if (this.disposed || this.value.operation || this.value.sending || this.value.phase === "live" || this.value.phase === "detached" || this.value.recoveryBlocked) return false;
    if (this.value.pending && launch.resumeId !== this.value.pending.providerSessionId) return this.fail("Resume the original Codex session before confirming this message");
    const epoch = ++this.epoch;
    this.early.clear();
    this.update({ operation: "start", phase: "starting", error: null });
    try {
      await this.connect();
      const prior = await this.backend.context(this.panelId);
      if (!this.current(epoch)) return false;
      if (prior && !prior.processFinished) {
        this.update({ context: prior, phase: "detached", busy: true });
        return this.fail("A Codex run is already present; stop it explicitly before replacing it");
      }
      this.update({ context: null });
      await this.backend.start(this.panelId, launch);
      const context = await this.backend.context(this.panelId);
      if (!this.current(epoch)) return false;
      if (!context || (launch.resumeId && context.providerSessionId !== launch.resumeId) || (this.value.pending && context.threadId !== this.value.pending.threadId)) throw new Error("Codex startup returned a different session identity");
      this.active = null; this.turns.clear(); this.receipts.clear(); this.resolvedApprovals.clear();
      const candidate = this.early.get(context.runId);
      const info = candidate?.threadId === context.threadId && candidate.providerThreadId === context.providerSessionId ? candidate : null;
      this.update({ context, info, phase: context.processFinished ? "stopped" : "live", busy: false, queue: null, users: [], receipts: [], notices: [], output: [], approvals: [], usage: [], truncated: false });
      await this.refreshQueue();
      return this.current(epoch) && this.state().phase === "live";
    } catch (error) {
      if (this.current(epoch)) {
        // A lost start response may still have created a runtime. Never retry it.
        try { const context = await this.backend.context(this.panelId); if (this.current(epoch)) this.update({ context, phase: context && !context.processFinished ? "detached" : "stopped", busy: !!context && !context.processFinished }); }
        catch { if (this.current(epoch)) this.update({ phase: "detached", busy: true }); }
        if (this.current(epoch)) this.fail(error);
      }
      return false;
    } finally { if (this.current(epoch)) { this.early.clear(); this.update({ operation: null }); } }
  }
  private receipt(receipt: TurnReceipt) {
    const prior = this.receipts.get(receipt.commandId);
    if (prior && TERMINAL.has(prior.status)) return prior;
    this.receipts.set(receipt.commandId, receipt);
    if (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
    const users = this.value.users.map(user => user.receipt.commandId === receipt.commandId ? { ...user, receipt } : user);
    const finished = TERMINAL.has(receipt.status);
    if (finished && this.active === receipt.commandId) this.active = null;
    this.update({ users, receipts: [...this.receipts.values()], busy: this.value.phase === "live" ? this.active !== null : this.value.busy, approvals: finished ? this.value.approvals.filter(item => item.commandId !== receipt.commandId) : this.value.approvals });
    return receipt;
  }
  private queue(snapshot: unknown) {
    const context = this.value.context;
    if (context && validQueue(snapshot, context.threadId) && (!this.value.queue || snapshot.revision >= this.value.queue.revision)) this.update({ queue: snapshot });
  }
  async refreshQueue(): Promise<boolean> {
    const context = this.value.context, epoch = this.epoch, read = ++this.queueRead;
    if (this.disposed || !context) return false;
    try {
      const snapshot = this.value.phase === "stopped" ? await this.backend.savedQueue(context.providerSessionId) : await this.backend.control(this.panelId, context, { type: "queue" });
      if (this.current(epoch) && read === this.queueRead && snapshot) this.queue(snapshot);
      return true;
    } catch (error) { if (this.current(epoch) && read === this.queueRead) this.fail(error); return false; }
  }
  async submit(text: string, queued = false): Promise<boolean> {
    const context = this.value.context;
    if (this.disposed || !context || this.value.phase !== "live" || this.value.pending || this.value.sending || this.value.operation || this.value.recoveryBlocked) return false;
    if (!text.trim() || text.length > 1024 * 1024) return this.fail("Message must contain text and be at most 1,048,576 characters");
    if (!queued && (this.value.busy || !!this.value.queue?.items.length)) return this.fail("Wait for the current turn and resolve queued messages before sending immediately");
    const pending: CodexPending = { version: 1, provider: "codex", panelId: this.panelId, threadId: context.threadId, providerSessionId: context.providerSessionId, runId: context.runId, commandId: this.makeId(), text, queued };
    try { this.storage.setItem(this.key, JSON.stringify(pending)); }
    catch (error) { return this.fail(`Message was not sent; the draft is unchanged. ${String(error)}`); }
    this.update({ pending });
    return this.attempt(pending, false);
  }
  async retry(): Promise<boolean> {
    if (this.disposed || !this.value.pending || this.value.sending || this.value.operation || this.value.recoveryBlocked) return false;
    return this.attempt(this.value.pending, true);
  }
  private async attempt(pending: CodexPending, lookup: boolean): Promise<boolean> {
    const epoch = this.epoch;
    this.update({ sending: true, error: null });
    try {
      let receipt: TurnReceipt | undefined;
      if (lookup) { try { receipt = await this.backend.receipt(pending.commandId); } catch { /* Explicit retry may reuse the same ID through the journal-backed runtime. */ } }
      if (!receipt) {
        const context = this.value.context;
        if (!this.current(epoch) || !context || this.value.phase !== "live" || context.threadId !== pending.threadId || context.providerSessionId !== pending.providerSessionId) throw new Error("Resume the original Codex session before retrying this message");
        try { receipt = await this.backend.control(this.panelId, context, { type: "submit", commandId: pending.commandId, text: pending.text, queued: pending.queued }); }
        catch (error) { try { receipt = await this.backend.receipt(pending.commandId); } catch { throw error; } }
      }
      if (!validReceipt(receipt, pending.threadId, pending.commandId)) throw new Error("The message receipt belongs to a different command or session");
      if (!this.current(epoch)) return false;
      if (!this.value.context || this.value.context.threadId === receipt.threadId) this.receipt(receipt);
      const raw = this.storage.getItem(this.key);
      const stored = raw ? parsePending(raw, this.panelId) : null;
      if (!stored || stored.commandId !== pending.commandId || stored.text !== pending.text || stored.threadId !== pending.threadId || stored.providerSessionId !== pending.providerSessionId || stored.runId !== pending.runId || stored.queued !== pending.queued) throw new Error("Recovery data changed; review before confirming this message");
      this.storage.removeItem(this.key);
      this.update({ pending: null, error: ["failed", "interrupted", "uncertain", "cancelled"].includes(receipt.status) ? `Message ${receipt.status}. Review history before continuing.` : null });
      return true;
    } catch (error) { if (this.current(epoch)) this.fail(`Could not confirm this message. Its original ID and text are retained. ${String(error)}`); return false; }
    finally { if (this.current(epoch)) { this.update({ sending: false }); await this.refreshQueue(); } }
  }
  /** This forgets a recovery record only; it does not undo or cancel provider work. */
  discardRecovery(confirmed: boolean): boolean {
    if (this.disposed || !confirmed || this.value.sending || this.value.operation) return false;
    try { this.storage.removeItem(this.key); this.update({ pending: null, recoveryBlocked: false, error: null }); return true; }
    catch (error) { return this.fail(error); }
  }
  async mutate(change: QueueChange, expectedRevision: number): Promise<boolean> {
    const context = this.value.context;
    if (this.disposed || !context || this.value.phase !== "live" || this.value.operation || (change.type === "resume" && this.value.busy)) return false;
    const epoch = this.epoch;
    this.update({ operation: "queue", error: null });
    try { const snapshot = await this.backend.control(this.panelId, context, { type: "changeQueue", expectedRevision, change }); if (!this.current(epoch)) return false; this.queue(snapshot); return true; }
    catch (error) { if (this.current(epoch)) { await this.refreshQueue(); if (this.current(epoch)) this.fail(error); } return false; }
    finally { if (this.current(epoch)) this.update({ operation: null }); }
  }
  async interrupt(): Promise<boolean> { return this.action({ type: "interrupt" }); }
  async answer(id: string, decision: "accept" | "decline" | "cancel"): Promise<boolean> {
    if (this.value.phase !== "live" || !this.value.approvals.some(item => item.id === id)) return false;
    return this.action({ type: "answer", approvalId: id, decision });
  }
  private async action(action: Extract<CodexAction, { type: "interrupt" | "answer" }>): Promise<boolean> {
    const context = this.value.context, epoch = this.epoch;
    if (this.disposed || !context || !["live", "detached"].includes(this.value.phase) || this.value.operation) return false;
    this.update({ operation: action.type, error: null });
    try {
      await this.backend.control(this.panelId, context, action);
      if (!this.current(epoch)) return false;
      if (action.type === "answer") this.resolveApproval(action.approvalId);
      await this.refreshQueue(); return this.current(epoch);
    } catch (error) { if (this.current(epoch)) this.fail(error); return false; }
    finally { if (this.current(epoch)) this.update({ operation: null }); }
  }
  async stop(): Promise<boolean> {
    const context = this.value.context;
    if (this.disposed || !context || this.value.phase === "starting" || this.value.phase === "stopping") return false;
    const epoch = ++this.epoch;
    const command = this.active;
    this.update({ phase: "stopping", operation: "stop", sending: false, approvals: [], error: null });
    try {
      await this.backend.control(this.panelId, context, { type: "stop" });
      if (!this.current(epoch)) return false;
      this.active = null;
      this.update({ phase: "stopped", context: { ...context, processFinished: true }, busy: false });
      if (command) await this.reconcileReceipt(command, context.threadId, epoch);
      await this.refreshQueue(); return this.current(epoch);
    } catch (error) { if (this.current(epoch)) { this.update({ phase: "detached", busy: true }); this.fail(error); } return false; }
    finally { if (this.current(epoch)) this.update({ operation: null }); }
  }
  private async reconcileReceipt(command: string, thread: string, epoch: number) {
    try { const receipt = await this.backend.receipt(command); if (this.current(epoch) && validReceipt(receipt, thread, command)) this.receipt(receipt); }
    catch { /* Preserve the shutdown reason and pending outbox; reads never trigger replay. */ }
  }
  private resolveApproval(id: string) {
    this.resolvedApprovals.add(id);
    if (this.resolvedApprovals.size > 256) this.resolvedApprovals.delete(this.resolvedApprovals.values().next().value!);
    this.update({ approvals: this.value.approvals.filter(item => item.id !== id) });
  }
  private receive(envelope: CodexEnvelope) {
    if (this.disposed || !object(envelope) || envelope.provider !== "codex" || envelope.panel_id !== this.panelId || !string(envelope.run_id) || !object(envelope.event)) return;
    const event = envelope.event;
    if (object(event.receipt) && string(event.receipt.commandId)) {
      const prior = this.receipts.get(event.receipt.commandId);
      if (prior && prior.turnId !== event.receipt.turnId) return;
    }
    if (this.value.phase === "starting" && event.type === "ready" && object(event.info)) {
      const info = event.info;
      if (info.runId === envelope.run_id && [info.runId, info.threadId, info.providerThreadId, info.model, info.cwd].every(string) && this.early.size < 4) this.early.set(envelope.run_id, info as CodexInfo);
      return;
    }
    const context = this.value.context;
    if (!context || envelope.run_id !== context.runId || this.value.phase !== "live") return;
    if (event.type === "ready" && object(event.info) && event.info.runId === context.runId && event.info.threadId === context.threadId && event.info.providerThreadId === context.providerSessionId && [event.info.model, event.info.cwd].every(string)) { this.update({ info: event.info as CodexInfo }); return; }
    if (event.type === "closed") {
      const command = this.active; this.active = null;
      this.update({ phase: "stopped", context: { ...context, processFinished: true }, busy: false, approvals: [], error: preview(event.reason) });
      if (command) void this.reconcileReceipt(command, context.threadId, this.epoch);
      void this.refreshQueue(); return;
    }
    if (event.type === "queue") { this.queue(event.snapshot); return; }
    if (event.type === "notice" && string(event.method)) {
      if (object(event.params) && string(event.params.threadId) && event.params.threadId !== context.providerSessionId) return;
      this.update({ notices: [...this.value.notices, { method: event.method, preview: preview(event.params, 16384) }].slice(-32) }); return;
    }
    if (event.type === "approval_resolved" && string(event.approvalId)) { this.resolveApproval(event.approvalId); return; }
    if (event.type === "user" && validReceipt(event.receipt, context.threadId) && typeof event.text === "string") {
      const receipt = this.receipt(event.receipt);
      if (!TERMINAL.has(receipt.status)) this.active = receipt.commandId;
      let users = this.value.users;
      if (!users.some(user => user.receipt.commandId === receipt.commandId)) users = [...users, { text: event.text.slice(0, TEXT_LIMIT), receipt }];
      const truncated = users.length > 100 || event.text.length > TEXT_LIMIT;
      this.update({ users: users.slice(-100), busy: this.active !== null, truncated: this.value.truncated || truncated }); return;
    }
    if (event.type === "turn_started" && validReceipt(event.receipt, context.threadId) && string(event.providerTurnId)) {
      const prior = this.turns.get(event.receipt.commandId);
      if (prior && prior !== event.providerTurnId) return;
      const receipt = this.receipt(event.receipt);
      this.turns.set(receipt.commandId, event.providerTurnId);
      if (this.turns.size > 256) this.turns.delete(this.turns.keys().next().value!);
      if (!TERMINAL.has(receipt.status)) this.active = receipt.commandId;
      this.update({ busy: this.active !== null }); return;
    }
    if (!string(event.commandId) && event.type !== "turn_completed") return;
    const command = event.type === "turn_completed" && validReceipt(event.receipt, context.threadId) ? event.receipt.commandId : event.commandId;
    if (!string(command) || !string(event.providerTurnId) || this.turns.get(command) !== event.providerTurnId) return;
    if (event.type === "turn_completed" && validReceipt(event.receipt, context.threadId, command) && TERMINAL.has(event.receipt.status)) { this.receipt(event.receipt); return; }
    if (this.active !== command || TERMINAL.has(this.receipts.get(command)?.status ?? "")) return;
    if (event.type === "approval_requested" && string(event.approvalId) && string(event.method)) {
      if (!this.resolvedApprovals.has(event.approvalId) && !this.value.approvals.some(item => item.id === event.approvalId) && this.value.approvals.length < 32) this.update({ approvals: [...this.value.approvals, { id: event.approvalId, commandId: command, providerTurnId: event.providerTurnId, method: event.method, preview: preview(event.params, 65536) }] });
    } else if (event.type === "usage") {
      this.update({ usage: [...this.value.usage.filter(item => item.commandId !== command), { commandId: command, preview: preview(event.usage, 16384) }].slice(-100) });
    } else if (event.type === "item" && object(event.item) && string(event.item.id)) {
      const item = historyItem(event.item);
      const itemId = event.item.id;
      const prior = this.value.output.find(value => value.commandId === command && value.itemId === itemId);
      const text = event.completed !== true && prior?.text ? prior.text : item.text;
      this.output({ commandId: command, itemId: event.item.id, label: item.type, text: text.slice(0, TEXT_LIMIT), completed: event.completed === true, truncated: !!prior?.truncated || text.length > TEXT_LIMIT });
    } else if (event.type === "text_delta" && string(event.itemId) && typeof event.text === "string") {
      const prior = this.value.output.find(item => item.commandId === command && item.itemId === event.itemId);
      if (prior?.completed) return;
      const text = (prior?.text ?? "") + event.text;
      this.output({ commandId: command, itemId: event.itemId, label: prior?.label ?? "Assistant", text: text.slice(0, TEXT_LIMIT), completed: false, truncated: !!prior?.truncated || text.length > TEXT_LIMIT });
    }
  }
  private output(item: CodexOutput) {
    const prior = this.value.output.find(value => value.commandId === item.commandId && value.itemId === item.itemId);
    if (prior?.completed && !item.completed) return;
    let output = prior ? this.value.output.map(value => value === prior ? item : value) : [...this.value.output, item];
    let size = output.reduce((total, value) => total + value.text.length, 0), dropped = false;
    while (output.length > 200 || size > OUTPUT_LIMIT) { size -= output[0].text.length; output = output.slice(1); dropped = true; }
    this.update({ output, truncated: this.value.truncated || item.truncated || dropped });
  }
  dispose() { this.disposed = true; ++this.epoch; this.unlisten?.(); this.unlisten = null; this.subscribers.clear(); }
}

export const nativeCodexLiveBackend: CodexLiveBackend = {
  listen: callback => listen<CodexEnvelope>("provider-event", event => callback(event.payload)),
  context: async panelId => {
    try { return await codexContext(panelId); }
    catch (error) { if ((error instanceof Error ? error.message : String(error)) === "no active session for this panel") return null; throw error; }
  },
  start: (panelId, launch) => invoke("start_session", { panelId, provider: "codex", ...launch, useWorktree: false }),
  control: codexControl,
  receipt: commandId => invoke("execution_receipt", { commandId }),
  savedQueue: sessionId => invoke("execution_queue", { sessionId, provider: "codex" }),
};
