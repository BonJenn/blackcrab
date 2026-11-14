import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { WorkspaceStartupClient } from "./workspaceStartup";
const events = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name: string, callback: () => void) => { events.set(name, callback); return () => { events.delete(name); }; }) }));
vi.mock("./AppUpdates", () => ({ AppUpdates: () => <p>App updates</p> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); events.clear(); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); });
function client(): WorkspaceStartupClient {
 return { desktop: { status: vi.fn().mockResolvedValue({ state: "ready" }), open: vi.fn().mockResolvedValue({ state: "running" }) }, service: { status: vi.fn().mockResolvedValue({ state: "running", canInitialize: false, installed: true, loaded: true }), initialize: vi.fn(), perform: vi.fn() }, handoff: vi.fn().mockResolvedValue(undefined) };
}
describe("new-workspace application", () => {
 it("starts automatically and never mounts the retired session UI", async () => {
  const api = client(); await act(() => root.render(<App client={api} />));
  expect(api.desktop.open).toHaveBeenCalledOnce(); expect(api.handoff).toHaveBeenCalledOnce();
  expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toMatch(/Open full desktop|Claude Code|Codex|new session/);
 });
 it("shows service recovery and retries only on request after failure", async () => {
  const api = client(); vi.mocked(api.desktop.open).mockRejectedValueOnce(new Error("The workspace could not open"));
  await act(() => root.render(<App client={api} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not open"); expect(api.desktop.open).toHaveBeenCalledOnce();
  const retry = [...host.querySelectorAll('button')].find(x => x.textContent === 'Try again')!;
  await act(() => retry.click()); expect(api.desktop.open).toHaveBeenCalledTimes(2); expect(api.handoff).toHaveBeenCalledOnce();
 });
 it("shows a native string refusal and retries the recovered service on request", async () => {
  const api = client();
  vi.mocked(api.service.status).mockRejectedValueOnce("Private native browser capability was refused");
  await act(() => root.render(<App client={api} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Private native browser capability was refused");
  expect(api.desktop.open).not.toHaveBeenCalled();
  const retry = [...host.querySelectorAll('button')].find(x => x.textContent === 'Try again')!;
  await act(() => retry.click());
  expect(api.desktop.open).toHaveBeenCalledOnce(); expect(api.handoff).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="alert"]')).toBeNull();
 });
 it("reopens from the native menu and exposes service settings without another launch", async () => {
  const api = client(); await act(() => root.render(<App client={api} />));
  await act(() => events.get('blackcrab-open-settings')!());
  expect(host.textContent).toContain('Background service'); expect(api.desktop.open).toHaveBeenCalledOnce();
  await act(() => events.get('blackcrab-open-workspace')!()); expect(api.desktop.open).toHaveBeenCalledTimes(2);
 });
 it("waits for in-flight startup before exposing service settings", async () => {
  const api = client(); let finish!: () => void;
  vi.mocked(api.desktop.open).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ state: 'running' }); }));
  await act(() => root.render(<App client={api} />));
  await act(() => events.get('blackcrab-open-settings')!());
  expect(host.textContent).not.toContain('Background service');
  await act(() => finish());
  expect(api.handoff).not.toHaveBeenCalled(); expect(host.textContent).toContain('Background service');
 });
 it("does not reopen or unmount service controls while a service mutation is pending", async () => {
  const api = client(); let finish!: () => void;
  vi.mocked(api.service.perform).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ state: 'stopped', installed: true, loaded: false, canInitialize: false }); }));
  await act(() => root.render(<App client={api} />));
  await act(() => events.get('blackcrab-open-settings')!());
  await act(() => [...host.querySelectorAll('button')].find(x => x.textContent === 'Stop background service')!.click());
  expect([...host.querySelectorAll('button')].find(x => x.textContent === 'Return to workspace')!.disabled).toBe(true);
  await act(() => events.get('blackcrab-open-workspace')!());
  expect(api.desktop.open).toHaveBeenCalledOnce();
  await act(() => finish());
  expect([...host.querySelectorAll('button')].find(x => x.textContent === 'Return to workspace')!.disabled).toBe(false);
 });
});
