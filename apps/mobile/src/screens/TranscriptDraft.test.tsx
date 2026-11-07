// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Pressable: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) => createElement("button", { onClick: onPress, disabled }, children),
  TextInput: ({ value, onChangeText, editable }: { value: string; onChangeText: (value: string) => void; editable: boolean }) => createElement("textarea", { value, disabled: !editable, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) }),
  FlatList: ({ ListEmptyComponent }: { ListEmptyComponent: ReactNode }) => createElement("div", null, ListEmptyComponent),
  StyleSheet: { create: (value: unknown) => value }, Platform: { OS: "ios" }, UIManager: {},
  LayoutAnimation: { configureNext: vi.fn() }, Animated: {}, Easing: {}, Alert: { alert: vi.fn() },
}));
vi.mock("../attachments", () => ({ pickFile: vi.fn(), pickPhoto: vi.fn(), takePhoto: vi.fn() }));
vi.mock("../components/Markdown", () => ({ Markdown: () => null }));
vi.mock("../queue/QueueControls", () => ({ QueueControls: () => null }));
vi.mock("../drafts/storage", () => ({ draftStorage: { read: async () => null, write: async () => {} } }));
vi.mock("../queue/storage", () => ({ queueId: () => "fixture-id" }));
import { TranscriptScreen } from "./TranscriptScreen";
import { MobileDraftClient } from "../drafts/client";
import type { MobileQueueClient } from "../queue/client";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); });
function fixture(raw?: string) {
  const saved = new Map<string,string>(); if (raw) saved.set(JSON.stringify(["one", "session"]), raw);
  const storage = { read: vi.fn(async (key: string) => saved.get(key) ?? null), write: vi.fn(async (key: string, value: string) => { saved.set(key, value); }) };
  let id = 0; const drafts = new MobileDraftClient(storage, () => `edit-${++id}`);
  const state = { loaded: true, support: "available", queue: { threadId: "thread", revision: 1, paused: false, items: [] }, busy: false, pending: null, needsRefresh: false };
  const enqueue = vi.fn(async () => true);
  const queue = { subscribe: () => () => {}, state: () => state, open: async () => {}, enqueue } as unknown as MobileQueueClient;
  const render = (host = "one", connected = false) => act(async () => root.render(<TranscriptScreen key={host} hostId={host} sessionId="session" queueClient={queue} draftClient={drafts} entries={[]} connected={connected} />));
  return { saved, storage, drafts, enqueue, render };
}
async function input(value: string) { await act(async () => { const field = element.querySelector<HTMLTextAreaElement>("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
const button = (text: string) => Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent === text)!;
it("retains offline drafts through navigation without transferring them to another host or auto-sending", async () => {
  const f = fixture(); await f.render();
  expect(element.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
  await input("offline draft");
  expect(button("Queue").disabled).toBe(true);
  await f.render("two"); expect(element.querySelector("textarea")?.value).toBe("");
  await f.render("one"); expect(element.querySelector("textarea")?.value).toBe("offline draft");
  expect(f.enqueue).not.toHaveBeenCalled();
  expect(JSON.parse(f.saved.get(JSON.stringify(["one", "session"]))!).text).toBe("offline draft");
});
it("hands exact local draft identity to the queue and preserves edits made during the handoff", async () => {
  const f = fixture(); await f.render("one", true); await input(" original ");
  let resolve!: (accepted: boolean) => void;
  f.enqueue.mockImplementationOnce(() => new Promise<boolean>(yes => { resolve = yes; }));
  await act(async () => button("Queue").click());
  expect(f.enqueue).toHaveBeenCalledWith("one", "session", "original", { editId: expect.any(String), text: " original " });
  await input("newer draft"); await act(async () => resolve(true));
  expect(element.querySelector("textarea")?.value).toBe("newer draft");
  await act(async () => button("Queue").click());
  expect(element.querySelector("textarea")?.value).toBe("");
  expect(JSON.parse(f.saved.get(JSON.stringify(["one", "session"]))!).text).toBe("");
});
it("preserves unreadable saved text and allows explicit loading retry without sending", async () => {
  const f = fixture("broken"); await f.render("one", true);
  expect(element.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
  expect(f.storage.write).not.toHaveBeenCalled();
  f.saved.set(JSON.stringify(["one", "session"]), JSON.stringify({ version: 1, hostId: "one", sessionId: "session", text: "recovered", editId: "saved-edit" }));
  await act(async () => button("Retry loading draft").click());
  expect(element.querySelector("textarea")?.value).toBe("recovered"); expect(f.enqueue).not.toHaveBeenCalled();
});
