import { expect, it, vi } from "vitest";
import { CodexLiveClient, CODEX_OUTBOX_PREFIX, nativeCodexLiveBackend, type CodexEnvelope, type CodexLaunch, type CodexLiveBackend } from "./codexLive";
import type { CodexAction, CodexContext } from "./codexControl";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import type { QueueSnapshot, TurnReceipt } from "./queueClient";
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const context: CodexContext = { provider: "codex", threadId: "journal", providerSessionId: "native", runId: "run-1", processFinished: false };
  const data = { context: null as CodexContext | null, queue: { threadId: "journal", revision: 0, paused: true, items: [] } as QueueSnapshot };
  const saved = new Map<string, string>();
  const receipts = new Map<string, TurnReceipt>();
  const storage = { getItem: vi.fn((key: string) => saved.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { saved.set(key, value); }), removeItem: vi.fn((key: string) => { saved.delete(key); }) };
  let receiver: (event: CodexEnvelope) => void = () => {};
  const off = vi.fn();
  const control = vi.fn(async (_panel: string, _context: CodexContext, action: CodexAction): Promise<unknown> => {
    if (action.type === "queue" || action.type === "changeQueue") return structuredClone(data.queue);
    if (action.type === "submit") {
      expect(saved.has(CODEX_OUTBOX_PREFIX + "panel")).toBe(true);
      const result = { threadId: "journal", commandId: action.commandId, turnId: `turn-${action.commandId}`, status: action.queued ? "queued" : "running" };
      receipts.set(action.commandId, result); return result;
    }
    if (action.type === "stop") data.context = null;
  });
  const backend = {
    listen: vi.fn<CodexLiveBackend["listen"]>(async callback => { receiver = callback; return off; }),
    context: vi.fn(async () => data.context ? { ...data.context } : null),
    start: vi.fn(async (_panel: string, _launch: CodexLaunch) => {
      data.context = { ...context };
      receiver({ provider: "codex", panel_id: "panel", run_id: context.runId, event: { type: "ready", info: { threadId: "journal", providerThreadId: "native", runId: context.runId, model: "actual-model", cwd: "/actual" } } });
    }),
    control: control as CodexLiveBackend["control"],
    receipt: vi.fn(async (id: string) => { const value = receipts.get(id); if (!value) throw new Error("receipt unavailable"); return value; }),
    savedQueue: vi.fn(async () => structuredClone(data.queue)),
  } satisfies CodexLiveBackend;
  let next = 0;
  const client = new CodexLiveClient("panel", backend, storage, () => `command-${++next}`);
  const event = (event: unknown, run = context.runId) => receiver({ provider: "codex", panel_id: "panel", run_id: run, event });
  const receipt = (commandId = "command-1", status = "running"): TurnReceipt => ({ commandId, threadId: "journal", turnId: `turn-${commandId}`, status });
  const user = (commandId = "command-1") => event({ type: "user", text: "original", receipt: receipt(commandId, "dispatching") });
  const started = (commandId = "command-1") => event({ type: "turn_started", receipt: receipt(commandId), providerTurnId: `provider-${commandId}` });
  const delta = (text: string, extra: Record<string, unknown> = {}) => event({ type: "text_delta", commandId: "command-1", providerTurnId: "provider-command-1", itemId: "item", text, ...extra });
  return { client, backend, control, data, context, storage, saved, receipts, off, event, receipt, user, started, delta, raw: (value: CodexEnvelope) => receiver(value) };
}
const launch: CodexLaunch = { cwd: "/fixture", permissionMode: "readOnly" };
it("subscribes before startup, captures early ready identity and never sends automatically", async () => {
  const f = fixture();
  expect(await f.client.start(launch)).toBe(true);
  expect(f.backend.listen.mock.invocationCallOrder[0]).toBeLessThan(f.backend.start.mock.invocationCallOrder[0]);
  expect(f.client.state().info?.model).toBe("actual-model");
  expect(f.client.state().context).toEqual(f.context);
  expect(f.control.mock.calls.map(call => call[2].type)).toEqual(["queue"]);
  f.client.dispose(); expect(f.off).toHaveBeenCalledTimes(1);
});
it("inspects a pre-existing run as detached and will not replace it or replay state", async () => {
  const f = fixture(); f.data.context = f.context;
  expect(await f.client.inspect()).toBe(true);
  expect(f.client.state().phase).toBe("detached");
  expect(await f.client.start(launch)).toBe(false);
  expect(await f.client.submit("message")).toBe(false);
  expect(f.backend.start).not.toHaveBeenCalled();
  expect(await f.client.stop()).toBe(true);
  expect(f.control).toHaveBeenCalledWith("panel", f.context, { type: "stop" });
  expect(f.client.state().phase).toBe("stopped");
});
it("a lost startup response is detached rather than retried or silently replaced", async () => {
  const f = fixture();
  f.backend.start.mockImplementationOnce(async () => { f.data.context = f.context; throw new Error("start reply lost"); });
  expect(await f.client.start(launch)).toBe(false);
  expect(f.client.state().phase).toBe("detached");
  expect(await f.client.start(launch)).toBe(false);
  expect(f.backend.start).toHaveBeenCalledTimes(1);
});
it("persists before dispatch, deduplicates users and keeps final output/receipts ahead of late acknowledgements", async () => {
  const f = fixture(); await f.client.start(launch);
  const ack = deferred<TurnReceipt>();
  f.control.mockImplementationOnce(async () => { expect(f.saved.size).toBe(1); return ack.promise; });
  const sent = f.client.submit("original");
  f.user(); f.user(); f.started(); f.delta("hello");
  f.event({ type: "item", commandId: "command-1", providerTurnId: "provider-command-1", item: { type: "agentMessage", id: "item", text: "" }, completed: false });
  expect(f.client.state().output[0].text).toBe("hello");
  f.event({ type: "item", commandId: "command-1", providerTurnId: "provider-command-1", item: { type: "agentMessage", id: "item", text: "hello world" }, completed: true });
  f.delta("must not duplicate");
  f.event({ type: "turn_completed", receipt: f.receipt("command-1", "succeeded"), providerTurnId: "provider-command-1" });
  ack.resolve(f.receipt()); expect(await sent).toBe(true);
  expect(f.client.state().users).toHaveLength(1);
  expect(f.client.state().users[0].receipt.status).toBe("succeeded");
  expect(f.client.state().output[0].text).toBe("hello world");
  expect(f.client.state().busy).toBe(false);
  expect(f.saved.size).toBe(0);
});
it("rejects foreign panel/provider/run/turn identities and stale queue reads", async () => {
  const f = fixture(); await f.client.start(launch); f.user(); f.started();
  for (const extra of [{ provider: "claude" }, { panel_id: "other" }, { run_id: "old-run" }]) f.raw({ provider: "codex", panel_id: "panel", run_id: "run-1", event: { type: "closed", reason: "foreign" }, ...extra });
  f.delta("foreign", { providerTurnId: "other" });
  f.event({ type: "turn_completed", receipt: f.receipt("command-1", "succeeded"), providerTurnId: "other" });
  expect(f.client.state().busy).toBe(true);
  f.event({ type: "turn_started", receipt: { ...f.receipt(), turnId: "foreign-turn" }, providerTurnId: "other" });
  f.delta("accepted");
  f.event({ type: "queue", snapshot: { ...f.data.queue, revision: 5 } });
  const old = deferred<QueueSnapshot>(); f.control.mockReturnValueOnce(old.promise);
  const reading = f.client.refreshQueue();
  f.event({ type: "queue", snapshot: { ...f.data.queue, revision: 6 } });
  old.resolve({ ...f.data.queue, revision: 2 }); await reading;
  expect(f.client.state().queue?.revision).toBe(6);
  expect(f.client.state().phase).toBe("live");
  expect(f.client.state().output[0].text).toBe("accepted");
  f.event({ type: "usage", commandId: "command-1", providerTurnId: "other", usage: { total: 999 } });
  f.event({ type: "usage", commandId: "command-1", providerTurnId: "provider-command-1", usage: { total: 5 } });
  f.event({ type: "notice", method: "fixture/notice", params: { threadId: "other", text: "foreign" } });
  f.event({ type: "notice", method: "fixture/notice", params: { threadId: "native", text: "current" } });
  expect(f.client.state().usage[0].preview).toContain("5");
  expect(f.client.state().notices).toHaveLength(1);
});
it("recovers a lost send acknowledgement from its receipt without another submit", async () => {
  const f = fixture(); await f.client.start(launch);
  f.control.mockImplementationOnce(async () => { f.receipts.set("command-1", f.receipt("command-1", "uncertain")); throw new Error("ack lost"); });
  expect(await f.client.submit("original")).toBe(true);
  expect(f.control.mock.calls.filter(call => call[2].type === "submit")).toHaveLength(1);
  expect(f.client.state().pending).toBeNull();
  expect(f.client.state().error).toContain("uncertain");
});
it("reload retains original outbox identity and retries only after explicit original-session resume", async () => {
  const f = fixture(); await f.client.start(launch);
  f.control.mockRejectedValueOnce(new Error("transport lost"));
  expect(await f.client.submit("original")).toBe(false);
  expect(f.saved.size).toBe(1); f.client.dispose();
  f.data.context = null; f.context.runId = "run-2";
  const reloaded = new CodexLiveClient("panel", f.backend, f.storage, () => "must-not-be-used");
  expect(await reloaded.start({ ...launch, resumeId: "other" })).toBe(false);
  expect(await reloaded.start({ ...launch, resumeId: "native" })).toBe(true);
  expect(await reloaded.submit("different")).toBe(false);
  expect(await reloaded.retry()).toBe(true);
  const writes = f.control.mock.calls.filter(call => call[2].type === "submit");
  expect(writes.map(call => call[2])).toEqual([{ type: "submit", commandId: "command-1", text: "original", queued: false }, { type: "submit", commandId: "command-1", text: "original", queued: false }]);
  expect(writes[1][1].runId).toBe("run-2");
  expect(f.saved.size).toBe(0);
});
it("storage failures block dispatch and keep accepted records until explicit confirmation cleanup succeeds", async () => {
  const f = fixture(); await f.client.start(launch);
  f.storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  expect(await f.client.submit("draft")).toBe(false);
  expect(f.control.mock.calls.some(call => call[2].type === "submit")).toBe(false);
  f.storage.removeItem.mockImplementationOnce(() => { throw new Error("storage unavailable"); });
  expect(await f.client.submit("original")).toBe(false);
  expect(f.client.state().pending?.commandId).toBe("command-2");
  expect(await f.client.retry()).toBe(true);
  expect(f.control.mock.calls.filter(call => call[2].type === "submit")).toHaveLength(1);
});
it("corrupt recovery data fails closed and requires explicit discard without provider actions", async () => {
  const f = fixture(); f.saved.set(CODEX_OUTBOX_PREFIX + "panel", "corrupt");
  const recovered = new CodexLiveClient("panel", f.backend, f.storage);
  expect(recovered.state().recoveryBlocked).toBe(true);
  expect(await recovered.start(launch)).toBe(false);
  expect(recovered.discardRecovery(false)).toBe(false);
  expect(recovered.discardRecovery(true)).toBe(true);
  expect(f.backend.start).not.toHaveBeenCalled(); expect(f.control).not.toHaveBeenCalled();
});
it("queue conflicts retain the caller's revision and refresh without automatically resuming", async () => {
  const f = fixture(); await f.client.start(launch);
  f.data.queue.revision = 8;
  f.control.mockRejectedValueOnce(new Error("revision changed"));
  expect(await f.client.mutate({ type: "edit", commandId: "queued", text: "edit" }, 1)).toBe(false);
  expect(f.control.mock.calls.find(call => call[2].type === "changeQueue")?.[2]).toEqual({ type: "changeQueue", expectedRevision: 1, change: { type: "edit", commandId: "queued", text: "edit" } });
  expect(f.client.state().queue?.revision).toBe(8);
  expect(f.client.state().error).toContain("changed");
  f.user(); f.started();
  expect(await f.client.mutate({ type: "resume" }, 8)).toBe(false);
});
it("approvals require the current bound turn and are one-time; interrupt waits for terminal state", async () => {
  const f = fixture(); await f.client.start(launch); f.user(); f.started();
  f.event({ type: "approval_requested", approvalId: "foreign", commandId: "command-1", providerTurnId: "other", method: "approval", params: {} });
  expect(await f.client.answer("foreign", "accept")).toBe(false);
  f.event({ type: "approval_requested", approvalId: "opaque", commandId: "command-1", providerTurnId: "provider-command-1", method: "approval", params: { command: "fixture" } });
  expect(await f.client.answer("opaque", "decline")).toBe(true);
  f.event({ type: "approval_requested", approvalId: "opaque", commandId: "command-1", providerTurnId: "provider-command-1", method: "approval", params: {} });
  expect(f.client.state().approvals).toHaveLength(0);
  expect(await f.client.answer("opaque", "accept")).toBe(false);
  expect(await f.client.interrupt()).toBe(true);
  expect(f.client.state().busy).toBe(true);
  f.event({ type: "turn_completed", receipt: f.receipt("command-1", "interrupted"), providerTurnId: "provider-command-1" });
  expect(f.client.state().busy).toBe(false);
});
it("stop invalidates in-flight sends but keeps their recovery record for receipt confirmation", async () => {
  const f = fixture(); await f.client.start(launch);
  const ack = deferred<TurnReceipt>(); f.control.mockReturnValueOnce(ack.promise);
  const sent = f.client.submit("original");
  expect(await f.client.stop()).toBe(true);
  ack.resolve(f.receipt()); expect(await sent).toBe(false);
  expect(f.client.state().phase).toBe("stopped"); expect(f.saved.size).toBe(1);
  f.receipts.set("command-1", f.receipt("command-1", "interrupted"));
  expect(await f.client.retry()).toBe(true);
  expect(f.client.state().pending).toBeNull();
  expect(f.backend.start).toHaveBeenCalledTimes(1);
});
it("caps display output and keeps unknown items as inert text", async () => {
  const f = fixture(); await f.client.start(launch); f.user(); f.started();
  for (let index = 0; index < 18; index++) f.event({ type: "item", commandId: "command-1", providerTurnId: "provider-command-1", item: { id: `item-${index}`, type: "futureItem", text: "<script>inert</script>" + "x".repeat(128 * 1024) }, completed: true });
  expect(f.client.state().output.reduce((size, item) => size + item.text.length, 0)).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(f.client.state().truncated).toBe(true);
  expect(f.client.state().output[0].text).toContain("<script>inert</script>");
});
it("late listener registration is cleaned up and disposed clients cannot dispatch or overwrite recovery", async () => {
  const f = fixture(); const registration = deferred<() => void>(); f.backend.listen.mockReturnValueOnce(registration.promise);
  const connecting = f.client.connect(); f.client.dispose(); registration.resolve(f.off); await connecting;
  expect(f.off).toHaveBeenCalledTimes(1);
  expect(await f.client.submit("no write")).toBe(false);
  expect(await f.client.start(launch)).toBe(false);
  expect(f.client.discardRecovery(true)).toBe(false);
  expect(f.saved.size).toBe(0); expect(f.control).not.toHaveBeenCalled();
});

it("native launch/read bindings specify Codex without changing auth, permissions or worktrees implicitly", async () => {
  const call = vi.mocked(invoke); call.mockReset();
  call.mockResolvedValueOnce(undefined);
  await nativeCodexLiveBackend.start("owned-panel", { cwd: "/project", permissionMode: "readOnly", resumeId: "native-id", model: "chosen-model" });
  expect(call).toHaveBeenLastCalledWith("start_session", { panelId: "owned-panel", provider: "codex", cwd: "/project", permissionMode: "readOnly", resumeId: "native-id", model: "chosen-model", useWorktree: false });
  call.mockRejectedValueOnce("no active session for this panel");
  expect(await nativeCodexLiveBackend.context("owned-panel")).toBeNull();
  call.mockRejectedValueOnce(new Error("native unavailable"));
  await expect(nativeCodexLiveBackend.context("owned-panel")).rejects.toThrow("native unavailable");
  call.mockResolvedValueOnce(null);
  await nativeCodexLiveBackend.savedQueue("native-id");
  expect(call).toHaveBeenLastCalledWith("execution_queue", { sessionId: "native-id", provider: "codex" });
});

it("foreign receipts never confirm or clear a pending message", async () => {
  const f = fixture(); await f.client.start(launch);
  f.control.mockResolvedValueOnce({ ...f.receipt(), threadId: "foreign" });
  expect(await f.client.submit("original")).toBe(false);
  expect(f.saved.size).toBe(1);
  f.receipts.set("command-1", { ...f.receipt(), commandId: "other-command" });
  expect(await f.client.retry()).toBe(false);
  expect(f.client.state().pending?.text).toBe("original");
  expect(f.control.mock.calls.filter(call => call[2].type === "submit")).toHaveLength(1);
});

it("closed runtimes reconcile the active receipt and saved queue without replaying a turn", async () => {
  const f = fixture(); await f.client.start(launch); f.user(); f.started();
  f.receipts.set("command-1", f.receipt("command-1", "uncertain"));
  f.event({ type: "closed", reason: "provider disconnected" });
  await Promise.resolve(); await Promise.resolve();
  expect(f.client.state().phase).toBe("stopped");
  expect(f.client.state().users[0].receipt.status).toBe("uncertain");
  expect(f.client.state().busy).toBe(false);
  expect(f.backend.savedQueue).toHaveBeenCalledWith("native");
  expect(f.control.mock.calls.some(call => call[2].type === "submit")).toBe(false);
});

it("inspection of a replacement clears old display state without attaching or controlling it", async () => {
  const f = fixture(); await f.client.start(launch); f.user(); f.started(); f.delta("old output");
  await f.client.stop();
  f.data.context = { ...f.context, runId: "replacement", threadId: "other-journal", providerSessionId: "other-native" };
  expect(await f.client.inspect()).toBe(true);
  expect(f.client.state().phase).toBe("detached");
  expect(f.client.state().output).toHaveLength(0);
  expect(f.client.state().users).toHaveLength(0);
  expect(f.client.state().receipts).toHaveLength(0);
  expect(f.client.state().queue).toBeNull();
  expect(f.backend.start).toHaveBeenCalledTimes(1);
});

it("a superseded startup cannot report success for a later run after its initial queue read finishes", async () => {
  const f = fixture(); const oldRead = deferred<QueueSnapshot>();
  f.control.mockReturnValueOnce(oldRead.promise);
  const starting = f.client.start(launch);
  await vi.waitFor(() => expect(f.client.state().phase).toBe("live"));
  expect(await f.client.stop()).toBe(true);
  f.context.runId = "later-run";
  expect(await f.client.start(launch)).toBe(true);
  oldRead.resolve({ ...f.data.queue, revision: 99 });
  expect(await starting).toBe(false);
  expect(f.client.state().context?.runId).toBe("later-run");
  expect(f.client.state().queue?.revision).toBe(0);
});
