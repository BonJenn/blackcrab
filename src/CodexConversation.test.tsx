import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import CodexConversation from "./CodexConversation";
import { CodexWorkspace } from "./codexWorkspace";
import { CodexLiveClient, CODEX_OUTBOX_PREFIX, type CodexEnvelope, type CodexLiveBackend } from "./codexLive";
import type { CodexAction, CodexContext } from "./codexControl";
import type { QueueSnapshot, TurnReceipt } from "./queueClient";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
let cleanup: (() => void) | undefined;
const launchThread = { id: "chosen-native", name: "Chosen", preview: "", cwd: "/chosen", model: "chosen-model", modelProvider: "fixture", createdAt: 1, updatedAt: 1, historyMode: "legacy", status: {} };
function fixture(corrupt = false) {
  const saved = new Map<string, string>();
  if (corrupt) saved.set(CODEX_OUTBOX_PREFIX + "panel", "corrupt");
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  const data = { context: null as CodexContext | null, queue: { threadId: "journal", revision: 0, paused: true, items: [] } as QueueSnapshot };
  const context: CodexContext = { provider: "codex", threadId: "journal", providerSessionId: "native", runId: "run", processFinished: false };
  let receive: (value: CodexEnvelope) => void = () => {};
  const receipts = new Map<string, TurnReceipt>();
  const off = vi.fn();
  const control = vi.fn(async (_panel: string, _context: CodexContext, action: CodexAction): Promise<unknown> => {
    if (action.type === "queue") return structuredClone(data.queue);
    if (action.type === "changeQueue") {
      if (action.expectedRevision !== data.queue.revision) throw new Error("queue changed");
      const change = action.change;
      if (change.type === "edit") data.queue.items = data.queue.items.map(item => item.commandId === change.commandId ? { ...item, text: change.text } : item);
      if (change.type === "cancel") data.queue.items = data.queue.items.filter(item => item.commandId !== change.commandId);
      if (change.type === "reorder") data.queue.items = change.commandIds.map(id => data.queue.items.find(item => item.commandId === id)!);
      if (change.type === "pause" || change.type === "resume") data.queue.paused = change.type === "pause";
      data.queue.revision++; return structuredClone(data.queue);
    }
    if (action.type === "submit") {
      const receipt = { commandId: action.commandId, threadId: "journal", turnId: "turn", status: action.queued ? "queued" : "running" };
      receipts.set(action.commandId, receipt); return receipt;
    }
    if (action.type === "stop") data.context = null;
  });
  const backend = {
    listen: vi.fn<CodexLiveBackend["listen"]>(async callback => { receive = callback; return off; }),
    context: vi.fn(async () => data.context),
    start: vi.fn(async (_panel, launch) => { data.context = { ...context, providerSessionId: launch.resumeId ?? "native" }; receive({ provider: "codex", panel_id: "panel", run_id: "run", event: { type: "ready", info: { runId: "run", threadId: "journal", providerThreadId: data.context.providerSessionId, cwd: launch.cwd, model: launch.model ?? "actual-default" } } }); }),
    control: control as CodexLiveBackend["control"],
    receipt: vi.fn(async (id: string) => { const value = receipts.get(id); if (!value) throw new Error("unknown"); return value; }),
    savedQueue: vi.fn(async () => data.queue),
  } satisfies CodexLiveBackend;
  const client = new CodexLiveClient("panel", backend, storage, () => "stable-command");
  const workspace = new CodexWorkspace(client, storage, "workspace", "/fixture");
  cleanup = () => client.dispose();
  const event = (event: unknown) => receive({ provider: "codex", panel_id: "panel", run_id: "run", event });
  const receipt = { commandId: "stable-command", threadId: "journal", turnId: "turn", status: "running" };
  const active = () => { event({ type: "user", receipt, text: "message" }); event({ type: "turn_started", receipt, providerTurnId: "provider-turn" }); };
  return { client, workspace, backend, control, receipts, saved, data, off, event, active, receipt };
}
function button(text: string) { const value = Array.from(element.querySelectorAll("button")).find(node => node.textContent === text); if (!value) throw new Error(`Missing button ${text}`); return value; }
async function click(text: string) { await act(async () => button(text).click()); }
async function input(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, text: string) {
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, text); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
async function mount(f: ReturnType<typeof fixture>, thread?: typeof launchThread) { await f.workspace.ready; await act(async () => root.render(<CodexConversation defaultCwd="/fixture" workspace={f.workspace} requestedThread={thread} />)); }
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_method, args) => { const query = (args as { query: { type: string } }).query; return { provider: "codex", result: { type: query.type, data: query.type === "models" ? { data: [], nextCursor: null, backwardsCursor: null } : launchThread } }; });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); cleanup?.(); cleanup = undefined; element.remove(); });
it("prepares history selection without starting, then resumes explicitly with read-only permissions", async () => {
  const f = fixture(); await mount(f, launchThread);
  expect(f.backend.start).not.toHaveBeenCalled();
  expect(f.workspace.state()).toMatchObject({ cwd: "/chosen", resumeId: "chosen-native", model: "chosen-model", permissionMode: "readOnly" });
  await click("Resume session");
  expect(f.backend.start).toHaveBeenCalledWith("panel", { cwd: "/chosen", resumeId: "chosen-native", model: "chosen-model", permissionMode: "readOnly" });
  expect(element.textContent).toContain("Session: live");
});
it("starts before composing, preserves drafts across view remounts and sends through the guarded controller", async () => {
  const f = fixture(); await mount(f);
  expect(element.querySelector<HTMLTextAreaElement>(".codex-composer textarea")?.disabled).toBe(true);
  await click("Start session");
  expect(f.workspace.state().resumeId).toBe("native");
  expect(button("Interrupt").disabled).toBe(true);
  await input(element.querySelector(".codex-composer textarea")!, "unsent draft");
  await act(async () => root.render(null));
  expect(f.off).not.toHaveBeenCalled();
  await mount(f);
  expect(element.querySelector<HTMLTextAreaElement>(".codex-composer textarea")?.value).toBe("unsent draft");
  expect(f.backend.start).toHaveBeenCalledTimes(1);
  await click("Send now");
  expect(f.control).toHaveBeenCalledWith("panel", expect.objectContaining({ runId: "run" }), { type: "submit", commandId: "stable-command", text: "unsent draft", queued: false });
  expect(f.workspace.state().draft).toBe("");
});
it("queues during a busy turn while keeping immediate sends disabled", async () => {
  const f = fixture(); await mount(f); await click("Start session");
  await act(async () => f.active());
  await input(element.querySelector(".codex-composer textarea")!, "follow-up");
  expect(button("Send now").disabled).toBe(true);
  expect(button("Queue message").disabled).toBe(false);
  await click("Queue message");
  expect(f.control).toHaveBeenCalledWith("panel", expect.anything(), { type: "submit", commandId: "stable-command", text: "follow-up", queued: true });
});
it("shows inert streamed content and only allows current opaque one-time approvals", async () => {
  const f = fixture(); await mount(f); await click("Start session");
  await act(async () => {
    f.active();
    f.event({ type: "text_delta", commandId: "stable-command", providerTurnId: "provider-turn", itemId: "item", text: "<img src=x onerror=bad()>" });
    f.event({ type: "approval_requested", commandId: "stable-command", providerTurnId: "provider-turn", approvalId: "opaque", method: "item/commandExecution/requestApproval", params: { command: "fixture command" } });
  });
  expect(element.querySelector("img")).toBeNull(); expect(element.textContent).toContain("<img src=x onerror=bad()>");
  await click("Allow once");
  expect(f.control).toHaveBeenCalledWith("panel", expect.anything(), { type: "answer", approvalId: "opaque", decision: "accept" });
  expect(element.querySelector('[aria-label="Codex approval"]')).toBeNull();
});
it("disables acceptance for incomplete approval details but still permits decline", async () => {
  const f = fixture(); await mount(f); await click("Start session");
  await act(async () => { f.active(); f.event({ type: "approval_requested", commandId: "stable-command", providerTurnId: "provider-turn", approvalId: "large", method: "item/fileChange/requestApproval", params: { details: "x".repeat(70000) } }); });
  expect(button("Allow once").disabled).toBe(true);
  expect(button("Decline").disabled).toBe(false);
  await click("Decline");
  expect(f.control).toHaveBeenCalledWith("panel", expect.anything(), { type: "answer", approvalId: "large", decision: "decline" });
});
it("keeps stale queue edits disabled until reopened against the latest revision", async () => {
  const f = fixture(); await mount(f); await click("Start session");
  const item = { commandId: "queued", turnId: "queued-turn", text: "original", createdAtMs: 1, updatedAtMs: 1 };
  await act(async () => { f.data.queue = { threadId: "journal", revision: 1, paused: true, items: [item] }; f.event({ type: "queue", snapshot: f.data.queue }); });
  await click("Edit");
  await act(async () => { f.data.queue = { ...f.data.queue, revision: 2, items: [{ ...item, text: "edited elsewhere" }] }; f.event({ type: "queue", snapshot: f.data.queue }); });
  expect(button("Save queued message").disabled).toBe(true);
  await click("Cancel edit"); await click("Edit");
  expect(element.querySelector<HTMLTextAreaElement>(".codex-queue textarea")?.value).toBe("edited elsewhere");
  await input(element.querySelector(".codex-queue textarea")!, "reviewed edit"); await click("Save queued message");
  expect(f.control).toHaveBeenCalledWith("panel", expect.anything(), { type: "changeQueue", expectedRevision: 2, change: { type: "edit", commandId: "queued", text: "reviewed edit" } });
});
it("retains a failed draft and confirms its original message without a second submission", async () => {
  const f = fixture(); await mount(f); await click("Start session");
  f.control.mockRejectedValueOnce(new Error("reply lost"));
  await input(element.querySelector(".codex-composer textarea")!, "original"); await click("Send now");
  expect(f.workspace.state().draft).toBe("original");
  expect(element.querySelector('[aria-label="Codex message recovery"]')).not.toBeNull();
  f.receipts.set("stable-command", { ...f.receipt, status: "succeeded" });
  await click("Confirm or retry original message");
  expect(f.control.mock.calls.filter(call => call[2].type === "submit")).toHaveLength(1);
  expect(f.workspace.state().draft).toBe("");
});
it("requires explicit review before discarding unreadable recovery and issues no provider write", async () => {
  const f = fixture(true); await mount(f);
  expect(button("Start session").disabled).toBe(true);
  expect(button("Discard recovery record").disabled).toBe(true);
  const review = element.querySelector<HTMLInputElement>('[aria-label="Codex message recovery"] input[type="checkbox"]')!;
  await act(async () => review.click()); await click("Discard recovery record");
  expect(f.client.state().recoveryBlocked).toBe(false);
  expect(f.backend.start).not.toHaveBeenCalled(); expect(f.control).not.toHaveBeenCalled();
});
it("reports background approval activity and keeps interrupt busy until the terminal event", async () => {
  const f = fixture(), activity = vi.fn(); await f.workspace.ready;
  await act(async () => root.render(<CodexConversation defaultCwd="/fixture" workspace={f.workspace} onActivity={activity} />));
  await click("Start session");
  await act(async () => { f.active(); f.event({ type: "approval_requested", commandId: "stable-command", providerTurnId: "provider-turn", approvalId: "opaque", method: "item/commandExecution/requestApproval", params: {} }); });
  expect(activity).toHaveBeenLastCalledWith("approval");
  await click("Interrupt"); expect(f.client.state().busy).toBe(true);
  await act(async () => f.event({ type: "turn_completed", receipt: { ...f.receipt, status: "interrupted" }, providerTurnId: "provider-turn", error: { message: "fixture failure" } }));
  expect(activity).toHaveBeenLastCalledWith("idle");
  expect(element.textContent).toContain("fixture failure");
});

it("keeps immediate sending disabled until a failed initial queue read can be refreshed", async () => {
  const f = fixture(); await mount(f);
  f.control.mockRejectedValueOnce(new Error("queue unavailable"));
  await click("Start session");
  await input(element.querySelector(".codex-composer textarea")!, "draft");
  expect(button("Send now").disabled).toBe(true);
  await click("Refresh queue");
  expect(button("Send now").disabled).toBe(false);
  expect(f.control.mock.calls.some(call => call[2].type === "submit")).toBe(false);
});
