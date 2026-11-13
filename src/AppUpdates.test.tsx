import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppUpdates } from "./AppUpdates";
const api = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.2" }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: api.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: api.relaunch }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, mounted: boolean;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); mounted = true; });
afterEach(async () => { if (mounted) await act(() => root.unmount()); host.remove(); });
function update() { return { version: "0.4.3", close: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn().mockResolvedValue(undefined) }; }
it("serializes update checks and releases a late result after the view closes", async () => {
 const next = update(); let finish!: () => void; const busy = vi.fn();
 api.check.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(next); }));
 await act(() => root.render(<AppUpdates onBusyChange={busy} />));
 await act(() => { host.querySelector('button')!.click(); host.querySelector('button')!.click(); });
 expect(api.check).toHaveBeenCalledOnce(); expect(busy).toHaveBeenLastCalledWith(true);
 await act(() => root.unmount()); mounted = false;
 await act(() => finish()); expect(next.close).toHaveBeenCalledOnce(); expect(busy).toHaveBeenLastCalledWith(false);
});
it("keeps the update resource alive until installation settles and avoids a late relaunch", async () => {
 const next = update(); let finish!: () => void; const busy = vi.fn();
 next.downloadAndInstall.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(undefined); }));
 api.check.mockResolvedValueOnce(next);
 await act(() => root.render(<AppUpdates onBusyChange={busy} />));
 await act(() => host.querySelector('button')!.click());
 await act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Install update and restart')!.click());
 expect(busy).toHaveBeenLastCalledWith(true);
 await act(() => root.unmount()); mounted = false; expect(next.close).not.toHaveBeenCalled();
 await act(() => finish()); expect(next.close).toHaveBeenCalledOnce(); expect(api.relaunch).not.toHaveBeenCalled();
});
