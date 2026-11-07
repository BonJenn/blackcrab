import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import CodexPanes from "./CodexPanes";
import { CodexDesktop } from "./codexDesktop";
import { CodexWorkspace } from "./codexWorkspace";
import { CodexLiveClient, type CodexEnvelope, type CodexLiveBackend } from "./codexLive";
import type { CodexContext, CodexAction } from "./codexControl";
import type { CodexThread } from "./codexClient";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
const clients: CodexLiveClient[] = [];
const second = "00000000-0000-0000-0000-000000000002";
function fixture() {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  const contexts = new Map<string, CodexContext>();
  const listeners = new Set<(event: CodexEnvelope) => void>();
  const send = (panel: string, event: unknown) => listeners.forEach(callback => callback({ provider: "codex", panel_id: panel, run_id: `run-${panel}`, event }));
  const queue = (panel: string) => ({ threadId: `journal-${panel}`, revision: 0, paused: true, items: [] });
  const start = vi.fn<CodexLiveBackend["start"]>(async (panel, launch) => {
    contexts.set(panel, { provider: "codex", threadId: `journal-${panel}`, providerSessionId: launch.resumeId ?? `native-${panel}`, runId: `run-${panel}`, processFinished: false });
    send(panel, { type: "ready", info: { runId: `run-${panel}`, threadId: `journal-${panel}`, providerThreadId: contexts.get(panel)!.providerSessionId, cwd: launch.cwd, model: "fixture" } });
  });
  const control = vi.fn(async (panel: string, _context: CodexContext, action: CodexAction): Promise<unknown> => {
    if (action.type === "queue") return queue(panel);
    if (action.type === "submit") {
      const receipt = { commandId: action.commandId, threadId: `journal-${panel}`, turnId: `turn-${panel}`, status: "running" };
      send(panel, { type: "user", receipt, text: action.text });
      send(panel, { type: "turn_started", receipt, providerTurnId: `provider-turn-${panel}` });
      return receipt;
    }
    if (action.type === "stop") contexts.delete(panel);
  });
  const backend: CodexLiveBackend = { listen: async callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, context: async panel => contexts.get(panel) ?? null, start, control: control as CodexLiveBackend["control"], receipt: async () => { throw new Error("unknown"); }, savedQueue: async () => null };
  const desktop = new CodexDesktop(storage, "layout", id => {
    const client = new CodexLiveClient(id, backend, storage, () => `command-${id}`); clients.push(client);
    return new CodexWorkspace(client, storage, `workspace-${id}`, "/fixture");
  }, () => second);
  return { desktop, start, control, send, saved };
}
function pane(index: number) { return element.querySelector<HTMLElement>(`.codex-pane[aria-label="Conversation ${index}"]`)!; }
function button(text: string, scope: ParentNode = element) { const node = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent === text); if (!node) throw new Error(`Missing ${text}`); return node; }
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()); }
async function draft(index: number, value: string) { await act(async () => {
  const field = pane(index).querySelector<HTMLTextAreaElement>(".codex-composer textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}); }
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue({ provider: "codex", result: { type: "models", data: { data: [], nextCursor: null, backwardsCursor: null } } });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); clients.splice(0).forEach(client => client.dispose()); });
it("keeps hidden runs and drafts alive, isolates sends, and surfaces background approvals", async () => {
  const f = fixture(), activity = vi.fn();
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} onActivity={activity} />));
  await click("Start session", pane(1));
  await draft(1, "first unsent draft");
  await click("Add conversation");
  expect(pane(1).hidden).toBe(true); expect(pane(2).hidden).toBe(false);
  await click("Start session", pane(2)); await draft(2, "second message"); await click("Send now", pane(2));
  expect(f.control.mock.calls.filter(([, , action]) => action.type === "submit")).toEqual([[second, expect.objectContaining({ runId: `run-${second}` }), expect.objectContaining({ type: "submit", text: "second message" })]]);
  expect(f.desktop.workspace("primary").state().draft).toBe("first unsent draft");
  await click("Conversation 1");
  expect(pane(2).hidden).toBe(true);
  await act(async () => f.send(second, { type: "approval_requested", approvalId: "approval", commandId: `command-${second}`, providerTurnId: `provider-turn-${second}`, method: "item/commandExecution/requestApproval", params: { command: "fixture only" } }));
  expect(activity).toHaveBeenLastCalledWith("approval");
  expect(button("Conversation 2 · approval")).toBeDefined();
  expect(pane(1).textContent).not.toContain("fixture only");
  await click("Grid view");
  expect(pane(1).hidden).toBe(false); expect(pane(2).hidden).toBe(false);
  expect(button("Remove pane", pane(2)).disabled).toBe(true);
  expect(f.start).toHaveBeenCalledTimes(2);
  expect(vi.mocked(invoke).mock.calls).toHaveLength(1); // Shared catalog, including grid view.
  await act(async () => root.render(null));
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} />));
  expect(f.desktop.workspace("primary").state().draft).toBe("first unsent draft");
  expect(pane(2).textContent).toContain("fixture only");
  expect(f.start).toHaveBeenCalledTimes(2);
});
it("binds history preparation to the selected owner once and never moves it on selection changes", async () => {
  const f = fixture();
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} />));
  await click("Add conversation");
  const thread = { id: "chosen", cwd: "/chosen", model: "chosen-model" } as CodexThread;
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} requestedThread={thread} />));
  expect(f.desktop.workspace(second).state().resumeId).toBe("chosen");
  expect(f.start).not.toHaveBeenCalled();
  await click("Conversation 1");
  expect(f.desktop.workspace("primary").state().resumeId).toBe("");
  expect(f.desktop.workspace(second).state().resumeId).toBe("chosen");
  await click("Conversation 2"); await click("Resume session", pane(2));
  expect(f.start).toHaveBeenCalledWith(second, { cwd: "/chosen", model: "chosen-model", resumeId: "chosen", permissionMode: "readOnly" });
});

it("routes history to the grid owner selected by pointer or keyboard focus", async () => {
  const f = fixture();
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} />));
  await click("Add conversation"); await click("Grid view");
  expect(f.desktop.state().selected).toBe(second);
  await act(async () => pane(1).querySelector("header")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(f.desktop.state().selected).toBe("primary");
  const firstThread = { id: "first-target", cwd: "/first", model: "first-model" } as CodexThread;
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} requestedThread={firstThread} />));
  expect(f.desktop.workspace("primary").state().resumeId).toBe("first-target");
  expect(f.desktop.workspace(second).state().resumeId).toBe("");
  await act(async () => pane(2).querySelector<HTMLInputElement>("input")!.focus());
  expect(f.desktop.state().selected).toBe(second);
  const secondThread = { id: "second-target", cwd: "/second", model: "second-model" } as CodexThread;
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} requestedThread={secondThread} />));
  expect(f.desktop.workspace(second).state().resumeId).toBe("second-target");
  expect(f.desktop.workspace("primary").state().resumeId).toBe("first-target");
  expect(f.start).not.toHaveBeenCalled();
});

it("reopens a retained pane from the UI with its original settings and without starting work", async () => {
  const f = fixture();
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} />));
  await click("Add conversation");
  await act(async () => f.desktop.workspace(second).update({ cwd: "/retained", model: "retained-model" }));
  await click("Remove pane", pane(2));
  expect(element.querySelectorAll(".codex-pane")).toHaveLength(1);
  expect(element.querySelector('[aria-label="Retained conversations"]')!.textContent).toContain("never starts or submits work");
  await click("Reopen retained conversation 1");
  expect(element.querySelectorAll(".codex-pane")).toHaveLength(2);
  expect(pane(2).hidden).toBe(false);
  expect(f.desktop.workspace(second).state()).toMatchObject({ cwd: "/retained", model: "retained-model" });
  expect(f.desktop.state().retained).toEqual([]);
  expect(f.start).not.toHaveBeenCalled(); expect(f.control).not.toHaveBeenCalled();
});
it("does not reapply an old history request after the target pane is removed and reopened", async () => {
  const f = fixture();
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} />));
  await click("Add conversation");
  const thread = { id: "old-history-target", cwd: "/old", model: "old-model" } as CodexThread;
  await act(async () => root.render(<CodexPanes defaultCwd="" desktop={f.desktop} requestedThread={thread} />));
  await act(async () => f.desktop.workspace(second).update({ resumeId: "", cwd: "/new-choice", model: "new-model" }));
  await click("Remove pane", pane(2)); await click("Reopen retained conversation 1");
  expect(f.desktop.workspace(second).state()).toMatchObject({ resumeId: "", cwd: "/new-choice", model: "new-model" });
  expect(f.start).not.toHaveBeenCalled();
});
