import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import CodexHistory from "./CodexHistory";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./CodexPanes", () => ({ default: ({ requestedThread, onActivity }: { requestedThread?: { id: string }; onActivity?: (value: "running") => void }) => <section data-testid="conversation-stub">Selected thread: {requestedThread?.id}<button onClick={() => onActivity?.("running")}>Simulate background activity</button></section> }));
const call = vi.mocked(invoke);
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement;
let root: Root;
const close = vi.fn();
const thread = (id: string) => ({ id, name: id, preview: "prompt", cwd: "/fixture", modelProvider: "fixture-provider", model: "fixture-model", createdAt: 1, updatedAt: 2, historyMode: "paginated", status: { type: "notLoaded" } });
function reply(type: string, data: unknown) { return { provider: "codex", result: { type, data } }; }
function page(data: unknown[], nextCursor: string | null = null) { return { data, nextCursor, backwardsCursor: null }; }
function buttons() { return Array.from(element.querySelectorAll("button")); }
function button(text: string) { const value = buttons().find(value => value.textContent === text); if (!value) throw new Error(`Missing button: ${text}`); return value; }
async function click(text: string) { await act(async () => button(text).click()); }
async function mount() { await act(async () => root.render(<CodexHistory onClose={close} />)); }
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  call.mockReset(); close.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); });
it("reads history without starting a session and keeps failed next-page cursors retryable", async () => {
  call.mockResolvedValueOnce(reply("threads", page([thread("first")], "opaque:next")));
  await mount();
  expect(element.textContent).toContain("first");
  call.mockRejectedValueOnce(new Error("fixture offline"));
  await click("Load more");
  expect(element.textContent).toContain("fixture offline");
  expect(element.textContent).toContain("first");
  call.mockResolvedValueOnce(reply("threads", page([thread("first"), thread("second")])));
  await click("Retry next page");
  expect(element.querySelectorAll(".codex-thread-list li")).toHaveLength(2);
  expect(call.mock.calls.slice(-1)[0]?.[1]).toEqual({ query: { type: "threads", page: { limit: 30, cursor: "opaque:next" }, archived: false } });
  expect(call.mock.calls.every(([method]) => method === "codex_query")).toBe(true);
});
it("discards an old history response after archive filters change", async () => {
  const old = deferred(); call.mockReturnValueOnce(old.promise);
  await mount();
  call.mockResolvedValueOnce(reply("threads", page([thread("archived")]))) ;
  await act(async () => (element.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  expect(element.textContent).toContain("archived");
  await act(async () => old.resolve(reply("threads", page([thread("stale")]))));
  expect(element.textContent).not.toContain("stale");
  expect(call.mock.calls.slice(-1)[0]?.[1]).toMatchObject({ query: { archived: true, page: { cursor: null } } });
});
it("loads only the chosen turn's items, supports explicit legacy pages and escapes history content", async () => {
  call.mockResolvedValueOnce(reply("threads", page([thread("thread-1")])));
  await mount();
  call.mockResolvedValueOnce(reply("turns", page([{ id: "turn-1", status: "completed", itemsView: "notLoaded", items: [], error: null }])));
  await act(async () => element.querySelector<HTMLButtonElement>(".codex-thread-list button")!.click());
  call.mockResolvedValueOnce(reply("items", page([{ turnId: "turn-1", item: { id: "item-1", type: "agentMessage", text: '<img src=x onerror="bad()">' } }])));
  await click("View items");
  expect(element.textContent).toContain('<img src=x onerror="bad()">');
  expect(element.querySelector("img")).toBeNull();
  expect(call.mock.calls.slice(-1)[0]?.[1]).toMatchObject({ query: { type: "items", threadId: "thread-1", turnId: "turn-1" } });
  call.mockResolvedValueOnce(reply("turns", page([{ id: "turn-1", status: "completed", itemsView: "full", items: [{ type: "futureItem", id: "unknown", payload: "future content" }], error: null }])));
  const full = Array.from(element.querySelectorAll('input[type="checkbox"]')).slice(-1)[0] as HTMLInputElement;
  await act(async () => full.click());
  expect(call.mock.calls.slice(-1)[0]?.[1]).toMatchObject({ query: { type: "turns", itemsView: "full", page: { limit: 20, cursor: null } } });
  expect(element.textContent).toContain("future content");
  expect(element.querySelector('[aria-label="Codex turn items"]')).toBeNull();
});
it("loads catalog and account only when selected and offers account retry", async () => {
  call.mockResolvedValueOnce(reply("threads", page([]))); await mount();
  expect(call).toHaveBeenCalledTimes(1);
  call.mockResolvedValueOnce(reply("models", page([{ id: "model-id", model: "provider-model", displayName: "Dynamic model", description: "fixture", isDefault: true, inputModalities: ["text"], defaultReasoningEffort: "future", supportedReasoningEfforts: [{ reasoningEffort: "future", description: "dynamic choice" }], serviceTiers: [] }])));
  await click("Models");
  expect(element.textContent).toContain("future (default)");
  expect(element.textContent).toContain("provider-model");
  call.mockRejectedValueOnce(new Error("account unavailable")); await click("Account");
  expect(element.textContent).toContain("account unavailable");
  call.mockResolvedValueOnce(reply("account", { account: { type: "chatgpt", email: "fixture@example.test", planType: "plus" }, requiresOpenaiAuth: true }));
  await click("Refresh account");
  expect(element.textContent).toContain("fixture@example.test");
  expect(call.mock.calls.slice(-1)[0]?.[1]).toEqual({ query: { type: "account" } });
});
it("closes on Escape through the modal's cancel event and restores focus on unmount", async () => {
  const opener = document.createElement("button"); document.body.append(opener); opener.focus();
  call.mockResolvedValueOnce(reply("threads", page([]))); await mount();
  expect(element.querySelector("dialog")?.open).toBe(true);
  await act(async () => element.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
  expect(close).toHaveBeenCalledTimes(1);
  act(() => root.render(null));
  expect(document.activeElement).toBe(opener); opener.remove();
});

it("hands history to the preview without starting and keeps its view mounted across dialog close/reopen", async () => {
  const activity = vi.fn();
  call.mockResolvedValueOnce(reply("threads", page([thread("chosen-thread")])));
  await act(async () => root.render(<CodexHistory onClose={close} onActivity={activity} />));
  call.mockResolvedValueOnce(reply("turns", page([])));
  await act(async () => element.querySelector<HTMLButtonElement>(".codex-thread-list button")!.click());
  await click("Continue in conversation");
  await act(async () => { await import("./CodexPanes"); });
  expect(element.textContent).toContain("Selected thread: chosen-thread");
  await click("Simulate background activity");
  expect(activity).toHaveBeenCalledWith("running");
  const reads = call.mock.calls.length;
  await act(async () => root.render(<CodexHistory onClose={close} onActivity={activity} open={false} />));
  expect(element.querySelector("dialog")?.open).toBe(false);
  expect(element.querySelector('[data-testid="conversation-stub"]')).not.toBeNull();
  await act(async () => root.render(<CodexHistory onClose={close} onActivity={activity} open={true} />));
  expect(element.querySelector("dialog")?.open).toBe(true);
  expect(element.textContent).toContain("Selected thread: chosen-thread");
  expect(call.mock.calls.length).toBe(reads);
  expect(call.mock.calls.every(([method]) => method === "codex_query")).toBe(true);
});
it("renders a full workspace without a modal and preserves its view while inactive", async () => {
  const opener = document.createElement("button"); document.body.append(opener); opener.focus();
  call.mockResolvedValueOnce(reply("threads", page([])));
  await act(async () => root.render(<CodexHistory presentation="workspace" open={true} onClose={close} saveError="Selection is only saved for this app session" />));
  expect(element.querySelector("dialog")).toBeNull();
  const main = element.querySelector<HTMLElement>("main")!;
  expect(main.hidden).toBe(false);
  const picker = main.querySelector<HTMLSelectElement>(".desktop-provider-switcher select")!;
  expect(document.activeElement).toBe(picker);
  expect(element.textContent).toContain("Selection is only saved for this app session");
  await click("Conversation");
  const conversation = element.querySelector('[data-testid="conversation-stub"]');
  expect(conversation).not.toBeNull();
  await act(async () => { picker.value = "claude"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(<CodexHistory presentation="workspace" open={false} onClose={close} />));
  expect(main.hidden).toBe(true); expect(main.hasAttribute("inert")).toBe(true);
  expect(element.querySelector('[data-testid="conversation-stub"]')).toBe(conversation);
  expect(document.activeElement).toBe(opener);
  await act(async () => root.render(<CodexHistory presentation="workspace" open={true} onClose={close} />));
  expect(main.hidden).toBe(false); expect(element.querySelector('[data-testid="conversation-stub"]')).toBe(conversation);
  expect(call.mock.calls.every(([method]) => method === "codex_query")).toBe(true);
  opener.remove();
});
