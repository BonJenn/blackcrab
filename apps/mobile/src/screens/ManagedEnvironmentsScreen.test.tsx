// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  TextInput: ({ value, secureTextEntry, accessibilityLabel }: { value: string; secureTextEntry?: boolean; accessibilityLabel: string }) => createElement("input", { value, readOnly: true, type: secureTextEntry ? "password" : "text", "aria-label": accessibilityLabel }),
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) => createElement("button", { onClick: onPress, disabled, "aria-label": accessibilityLabel }, children),
  FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent }: { data: unknown[]; renderItem: (value: { item: unknown }) => ReactNode; ListHeaderComponent: ReactNode; ListEmptyComponent: ReactNode }) => createElement("div", null, ListHeaderComponent, data.length ? data.map((item, index) => createElement("div", { key: index }, renderItem({ item }))) : ListEmptyComponent),
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
import { ManagedEnvironmentsScreen } from "./ManagedEnvironmentsScreen";
import type { ManagedEnvironmentsClient, ManagedEnvironmentsSnapshot } from "../managed/types";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); });
function fixture() {
  let snapshot: ManagedEnvironmentsSnapshot = { loading: false, busy: false, selectedEnvironmentId: "one", environments: [{ environmentId: "one", label: "My workspace", address: "https://user:secret@example.test/pair?token=secret#secret", phase: "offline", dataStatus: "cached", projects: [{ id: "p", title: "Project", path: "/project" }], threads: [{ id: "t", title: "Saved thread", projectId: "p", status: "running" }] }] };
  const client: ManagedEnvironmentsClient = { getSnapshot: () => snapshot, subscribe: () => () => {}, pair: vi.fn(async () => {}), connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}), forget: vi.fn(async () => {}), select: vi.fn(async () => {}) };
  return { client, change(value: Partial<ManagedEnvironmentsSnapshot>) { snapshot = { ...snapshot, ...value }; }, state: () => snapshot, render() { act(() => root.render(<ManagedEnvironmentsScreen client={client} />)); } };
}
it("masks credentials and labels cached thread information as stale", () => {
  const f = fixture(); f.render();
  expect(element.textContent).toContain("https://example.test");
  expect(element.textContent).not.toContain("secret"); expect(element.textContent).not.toContain("user:");
  expect(element.querySelectorAll('input[type="password"]')).toHaveLength(2);
  expect(element.textContent).toContain("Showing saved information");
  expect(element.textContent).toContain("Saved thread");
  expect(element.textContent).toContain("read-only");
});
it("never substitutes another workspace when the saved selection is unavailable", () => {
  const f = fixture(); f.change({ selectedEnvironmentId: "missing" }); f.render();
  expect(element.textContent).toContain("Select a workspace");
  expect(element.textContent).not.toContain("Saved thread");
  expect(f.client.select).not.toHaveBeenCalled();
});
it("requires connected transport and live data before presenting an authoritative list", () => {
  const f = fixture(); f.change({ environments: [{ ...f.state().environments[0], phase: "connected", dataStatus: "synchronizing" }] }); f.render();
  expect(element.textContent).toContain("Refreshing workspace data");
  f.change({ environments: [{ ...f.state().environments[0], phase: "connected", dataStatus: "live" }] }); f.render();
  expect(element.textContent).not.toContain("may be out of date");
  expect(element.textContent).toContain("Disconnecting this phone leaves agents running");
});
