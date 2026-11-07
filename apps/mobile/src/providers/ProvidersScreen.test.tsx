// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  Pressable: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) => createElement("button", { onClick: onPress, disabled }, children),
  StyleSheet: { create: (value: unknown) => value },
}));
import { ProvidersScreen } from "./ProvidersScreen";
import type { MobileProvidersClient, ProvidersState } from "./client";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("shows honest remote readiness and explicit refresh without presenting unsupported actions", () => {
  let state: ProvidersState = { hostId: "host", connected: true, loading: false, error: null, providers: [
    { id: "codex", displayName: "Codex", installed: true, desktopReady: false, remoteReady: false, capabilities: { resume: true, streaming: true, modelSelection: true, worktrees: false, steering: false, permissionModes: ["readOnly"] } },
    { id: "claude", displayName: "Claude Code", installed: false, desktopReady: true, remoteReady: true, capabilities: { resume: true, streaming: true, modelSelection: true, worktrees: true, steering: false, permissionModes: ["default"] } },
  ] };
  const refresh = vi.fn(), client = { state: () => state, subscribe: () => () => {}, refresh } as unknown as MobileProvidersClient;
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  try {
    act(() => root.render(<ProvidersScreen client={client} />));
    expect(element.textContent).toContain("Remote control not available · Desktop preview"); expect(element.textContent).toContain("CLI not installed");
    expect(element.querySelectorAll("button")).toHaveLength(1); act(() => element.querySelector("button")!.click()); expect(refresh).toHaveBeenCalledOnce();
    state = { ...state, connected: false, providers: null, error: "Discovery unavailable" }; act(() => root.render(<ProvidersScreen client={client} />));
    expect(element.textContent).toContain("Connect to a paired host"); expect(element.textContent).not.toContain("Claude Code"); expect(element.querySelector("button")!.disabled).toBe(true);
  } finally { act(() => root.unmount()); element.remove(); }
});
