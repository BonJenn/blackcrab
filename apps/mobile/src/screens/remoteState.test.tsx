// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) => createElement("button", { onClick: onPress, disabled, "aria-label": accessibilityLabel }, children),
  FlatList: ({ data, renderItem, ListEmptyComponent }: { data: unknown[]; renderItem: (value: { item: unknown }) => ReactNode; ListEmptyComponent: ReactNode }) => createElement("div", null, data.length ? data.map((item, index) => createElement("div", { key: index }, renderItem({ item }))) : ListEmptyComponent),
  StyleSheet: { create: (value: unknown) => value },
}));
import { ApprovalScreen } from "./ApprovalScreen";
import { SessionsScreen } from "./SessionsScreen";
import type { StoredPairedHost } from "../pairingStore";
import { PairedHostsScreen } from "./PairedHostsScreen";
import type { ApprovalRequest } from "@blackcrab/remote-protocol";
import type { Transport, TransportStatus } from "../transport/types";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); });
const approval = (hostId: string): ApprovalRequest => ({ id: "approval-" + hostId, hostId, sessionId: "session", kind: "tool_call", summary: "Request from " + hostId, requestedAt: "2026-11-07T00:00:00Z" });
function connection() {
  let status: TransportStatus = { state: "connected", hostId: "one", sinceMs: 1 };
  const sendAction = vi.fn(() => true);
  const transport = { status: () => status, sendAction } as unknown as Transport;
  return { transport, sendAction, status: () => status, disconnect: () => { status = { ...status, state: "reconnecting" }; } };
}
it("shows empty real hosts, chats and attention rather than sample data", () => {
  act(() => root.render(<PairedHostsScreen loading={false} storedHosts={[]} onForgetHost={vi.fn()} onPairHost={vi.fn()} />));
  expect(element.textContent).toContain("No paired hosts"); expect(element.textContent).not.toContain("Sample hosts");
  expect(element.querySelectorAll("button")).toHaveLength(1);
  act(() => root.render(<SessionsScreen sessions={null} />));
  expect(element.textContent).toContain("Connect to a paired host"); expect(element.querySelectorAll("button")).toHaveLength(0);
  act(() => root.render(<ApprovalScreen approvals={null} />));
  expect(element.textContent).toContain("No approval requests received"); expect(element.querySelectorAll("button")).toHaveLength(0);
});
it("filters foreign approvals, disables disconnected decisions and checks live status again at tap time", () => {
  const f = connection();
  act(() => root.render(<ApprovalScreen hostId="one" transport={f.transport} status={f.status()} approvals={[approval("one"), approval("other")]} />));
  expect(element.textContent).toContain("Request from one"); expect(element.textContent).not.toContain("Request from other");
  f.disconnect(); act(() => element.querySelector<HTMLButtonElement>("button")!.click()); expect(f.sendAction).not.toHaveBeenCalled();
  act(() => root.render(<ApprovalScreen hostId="one" transport={f.transport} status={f.status()} approvals={[approval("one")]} />));
  expect(Array.from(element.querySelectorAll("button")).every(button => button.disabled)).toBe(true);
});
it("submits a decision once and waits for host confirmation without automatic retry", () => {
  const f = connection();
  act(() => root.render(<ApprovalScreen hostId="one" transport={f.transport} status={f.status()} approvals={[approval("one")]} />));
  const [allow, deny] = Array.from(element.querySelectorAll<HTMLButtonElement>("button"));
  act(() => { allow.click(); deny.click(); });
  expect(f.sendAction).toHaveBeenCalledExactlyOnceWith({ type: "approve", hostId: "one", approvalId: "approval-one" });
  expect(element.textContent).toContain("Waiting for host confirmation");
  expect(allow.disabled).toBe(true); expect(deny.disabled).toBe(true);
});
it("keeps a rejected decision available for explicit retry with an explanation", () => {
  const f = connection(); f.sendAction.mockReturnValueOnce(false);
  act(() => root.render(<ApprovalScreen hostId="one" transport={f.transport} status={f.status()} approvals={[approval("one")]} />));
  act(() => element.querySelector<HTMLButtonElement>("button")!.click());
  expect(element.textContent).toContain("decision was not sent");
  expect(element.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  expect(f.sendAction).toHaveBeenCalledOnce();
});

it("does not present stored host online metadata as a live connection", () => {
  const host: StoredPairedHost = { hostId: "one", displayName: "Desktop", platform: "macos", appVersion: "1", lastSeenAt: "2026-11-07T00:00:00Z", online: true, pairedAt: "2026-11-07T00:00:00Z", pairingSource: "manual_code" };
  act(() => root.render(<PairedHostsScreen loading={false} storedHosts={[host]} onForgetHost={vi.fn()} onPairHost={vi.fn()} />));
  expect(element.textContent).toContain("not connected"); expect(element.textContent).not.toContain("online");
});

it("connects and reconnects the selected stored host, opens its chats and disconnects explicitly", () => {
  const host: StoredPairedHost = { hostId: "one", displayName: "Desktop", platform: "macos", appVersion: "1", lastSeenAt: "2026-11-07T00:00:00Z", online: true, pairedAt: "2026-11-07T00:00:00Z", pairingSource: "desktop_payload", remoteToken: "fixture-token", lanHost: "127.0.0.1", lanPort: 1234 };
  const connect = vi.fn(), disconnect = vi.fn(), chats = vi.fn();
  const render = (active: boolean, state: TransportStatus["state"]) => act(() => root.render(<PairedHostsScreen loading={false} storedHosts={[host]} activeHostId={active ? "one" : null} activeStatus={{ state, hostId: "one", sinceMs: 1 }} onForgetHost={vi.fn()} onPairHost={vi.fn()} onConnectHost={connect} onDisconnectHost={disconnect} onViewSessions={chats} />));
  const button = (text: string) => Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent === text)!;
  render(false, "disconnected"); act(() => button("Connect").click()); expect(connect).toHaveBeenLastCalledWith("one", false);
  render(true, "error"); act(() => button("Reconnect").click()); expect(connect).toHaveBeenLastCalledWith("one", true);
  render(true, "connecting"); expect(button("Connecting…").disabled).toBe(true);
  render(true, "connected"); act(() => button("Open chats").click()); expect(chats).toHaveBeenCalledOnce();
  act(() => button("Disconnect").click()); expect(disconnect).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledTimes(2);
});
it("offers pairing again when stored credentials cannot establish a connection", () => {
  const host: StoredPairedHost = { hostId: "manual", displayName: "Manual", platform: "macos", appVersion: "1", lastSeenAt: "2026-11-07T00:00:00Z", online: false, pairedAt: "2026-11-07T00:00:00Z", pairingSource: "manual_code" };
  const pair = vi.fn(), connect = vi.fn();
  act(() => root.render(<PairedHostsScreen loading={false} storedHosts={[host]} onForgetHost={vi.fn()} onPairHost={pair} onConnectHost={connect} connectionError="Connection unavailable" />));
  expect(element.textContent).toContain("Connection unavailable");
  const button = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent === "Pair again")!;
  act(() => button.click()); expect(pair).toHaveBeenCalledOnce(); expect(connect).not.toHaveBeenCalled();
});

it("offers explicit startup selection storage retry and disconnect without implying a live connection", () => {
  const retry = vi.fn(), disconnect = vi.fn();
  act(() => root.render(<PairedHostsScreen loading={false} storedHosts={[]} onForgetHost={vi.fn()} onPairHost={vi.fn()} selectionError="Host selection was not saved" onRetrySelection={retry} onDisconnectHost={disconnect} />));
  expect(element.textContent).toContain("Host selection was not saved");
  const button = (text: string) => Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent === text)!;
  act(() => button("Retry saving startup host").click()); expect(retry).toHaveBeenCalledOnce();
  act(() => button("Disconnect on startup").click()); expect(disconnect).toHaveBeenCalledOnce();
  act(() => root.render(<PairedHostsScreen loading={false} storedHosts={[]} onForgetHost={vi.fn()} onPairHost={vi.fn()} savingSelection selectionError="Host selection was not saved" onRetrySelection={retry} />));
  expect(button("Retry saving startup host").disabled).toBe(true); expect(element.textContent).toContain("Saving startup host");
});
