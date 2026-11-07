import { act, useState, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { DESKTOP_PROVIDER_KEY } from "./desktopProvider";
const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), gridMount: vi.fn(), gridUnmount: vi.fn(), gridPermission: vi.fn() }));
vi.mock("./LivePanel", () => ({ LivePanel: ({ startEnabled }: { startEnabled: boolean }) => {
  useEffect(() => { lifecycle.gridMount(); return () => { lifecycle.gridUnmount(); }; }, []);
  useEffect(() => { lifecycle.gridPermission(startEnabled); }, [startEnabled]);
  return <section data-testid="claude-grid-owner" />;
}, setPermissionModeOnPanel: vi.fn(), respondPermission: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./CodexHistory", () => ({ default: ({ open, onClose, onActivity }: { open: boolean; onClose: () => void; onActivity: (activity: "approval") => void }) => {
  const [draft, setDraft] = useState("");
  useEffect(() => { lifecycle.mount(); return () => { lifecycle.unmount(); }; }, []);
  return <main data-testid="codex-view" hidden={!open}><input aria-label="Codex test draft" value={draft} onChange={event => setDraft(event.target.value)} /><button onClick={onClose}>Return to Claude</button><button onClick={() => onActivity("approval")}>Background approval</button></main>;
} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
function button(text: string) { return Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent === text)!; }
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) { await act(async () => {
  const prototype = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true }));
}); }
beforeEach(() => {
  localStorage.clear(); Object.values(lifecycle).forEach(mock => mock.mockClear());
  vi.mocked(invoke).mockReset().mockImplementation(async method => method === "save_dropped_file" ? "/tmp/provider-test.txt" : []);
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); localStorage.clear(); });
it("restores the provider, scopes shortcuts/drops and preserves both provider views across switches", async () => {
  localStorage.setItem(DESKTOP_PROVIDER_KEY, "codex");
  await act(async () => root.render(<App />));
  const claude = element.querySelector<HTMLElement>(".claude-desktop-view")!;
  expect(claude.hidden).toBe(true); expect(claude.hasAttribute("inert")).toBe(true);
  const codexDraft = element.querySelector<HTMLInputElement>('[aria-label="Codex test draft"]')!;
  await input(codexDraft, "retained Codex draft");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true })));
  expect(element.querySelector(".palette-overlay")).toBeNull();
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
  function drop() { const event = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { files: [{ name: "provider-test.txt", arrayBuffer }], types: ["Files"] } }); return event; }
  const blocked = drop(); await act(async () => window.dispatchEvent(blocked));
  expect(blocked.defaultPrevented).toBe(true); expect(arrayBuffer).not.toHaveBeenCalled();
  expect(vi.mocked(invoke).mock.calls.some(([method]) => method === "save_dropped_file")).toBe(false);
  await act(async () => button("Return to Claude").click());
  expect(claude.hidden).toBe(false); expect(claude.hasAttribute("inert")).toBe(false);
  expect(localStorage.getItem(DESKTOP_PROVIDER_KEY)).toBe("claude");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true })));
  expect(element.querySelector(".palette-overlay")).not.toBeNull();
  await act(async () => element.querySelector<HTMLElement>(".palette-overlay")!.click());
  const claudeDraft = claude.querySelector<HTMLTextAreaElement>("textarea")!;
  await input(claudeDraft, "retained Claude draft");
  await act(async () => window.dispatchEvent(drop()));
  expect(arrayBuffer).toHaveBeenCalledOnce();
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("save_dropped_file", expect.objectContaining({ name: "provider-test.txt" }));
  const picker = claude.querySelector<HTMLSelectElement>(".desktop-provider-switcher select")!;
  await act(async () => { picker.value = "codex"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(claude.hidden).toBe(true); expect(codexDraft.value).toBe("retained Codex draft");
  expect(claudeDraft.value).toBe("retained Claude draft");
  expect(lifecycle.mount).toHaveBeenCalledOnce(); expect(lifecycle.unmount).not.toHaveBeenCalled();
  expect(vi.mocked(invoke).mock.calls.every(([method]) => !["start_session", "send_message", "stop_session", "codex_control"].includes(method))).toBe(true);
});
it("opens Codex from forced Claude setup without dismissing that setup when returning", async () => {
  await act(async () => root.render(<App />));
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true })));
  await input(element.querySelector<HTMLInputElement>(".palette-input")!, "Claude Code setup");
  const option = Array.from(element.querySelectorAll<HTMLElement>(".palette-item")).find(node => node.textContent?.includes("Claude Code setup"))!;
  expect(option).toBeDefined();
  await act(async () => option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
  expect(element.querySelector(".onboarding-overlay")).not.toBeNull();
  await act(async () => button("Open Codex preview").click());
  expect(element.querySelector(".onboarding-overlay")).toBeNull();
  expect(element.querySelector<HTMLElement>('[data-testid="codex-view"]')!.hidden).toBe(false);
  await act(async () => button("Return to Claude").click());
  expect(element.querySelector(".onboarding-overlay")).not.toBeNull();
  expect(vi.mocked(invoke).mock.calls.every(([method]) => !["save_claude_oauth_token", "clear_claude_oauth_token", "start_session", "send_message"].includes(method))).toBe(true);
});
it("delays cold Claude grid owners until first visit and never disables or unmounts them on provider switches", async () => {
  localStorage.setItem(DESKTOP_PROVIDER_KEY, "codex");
  localStorage.setItem("gridMode", "1");
  localStorage.setItem("gridPanels", JSON.stringify(["new:fixture"]));
  localStorage.setItem("newPanelCwds", JSON.stringify({ "new:fixture": "/fixture" }));
  await act(async () => root.render(<App />));
  expect(lifecycle.gridMount).not.toHaveBeenCalled();
  await act(async () => button("Return to Claude").click());
  expect(lifecycle.gridMount).toHaveBeenCalledOnce();
  expect(lifecycle.gridPermission.mock.calls).toEqual([[true]]);
  const picker = element.querySelector<HTMLSelectElement>(".claude-desktop-view .desktop-provider-switcher select")!;
  await act(async () => { picker.value = "codex"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(lifecycle.gridMount).toHaveBeenCalledOnce();
  expect(lifecycle.gridUnmount).not.toHaveBeenCalled();
  expect(lifecycle.gridPermission.mock.calls).toEqual([[true]]);
  await act(async () => button("Return to Claude").click());
  expect(lifecycle.gridMount).toHaveBeenCalledOnce();
  expect(lifecycle.gridUnmount).not.toHaveBeenCalled();
});
