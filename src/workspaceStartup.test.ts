import { describe, expect, it, vi } from "vitest";
import { startWorkspace, type WorkspaceStartupClient } from "./workspaceStartup";
import type { ServiceState, ServiceStatus } from "./managedServiceClient";

const state = (value: ServiceState): ServiceStatus => ({ state: value, canInitialize: value === "notConfigured", installed: ["running", "stopped", "starting"].includes(value), loaded: ["running", "starting"].includes(value) });
function fixture(value: ServiceState = "running") {
  return {
    desktop: { status: vi.fn().mockResolvedValue({ state: "ready" }), open: vi.fn().mockResolvedValue({ state: "running" }) },
    service: { status: vi.fn().mockResolvedValue(state(value)), initialize: vi.fn().mockResolvedValue(state("running")), perform: vi.fn().mockResolvedValue(state("running")) },
    handoff: vi.fn().mockResolvedValue(undefined),
  } satisfies WorkspaceStartupClient;
}
const run = (client: WorkspaceStartupClient, signal = new AbortController().signal, pause = async () => {}) => startWorkspace(client, signal, vi.fn(), pause);

describe("workspace startup", () => {
  it("opens the workspace and hands off without a click", async () => {
    const api = fixture(); await run(api);
    expect(api.desktop.open).toHaveBeenCalledOnce(); expect(api.handoff).toHaveBeenCalledOnce();
    expect(api.service.perform).not.toHaveBeenCalled(); expect(api.service.initialize).not.toHaveBeenCalled();
  });
  it.each([["notInstalled", "install"], ["stopped", "start"]] as const)("recovers %s through one %s action", async (value, action) => {
    const api = fixture(value); await run(api); expect(api.service.perform).toHaveBeenCalledExactlyOnceWith(action); expect(api.handoff).toHaveBeenCalledOnce();
  });
  it("initializes only a fresh configurable host", async () => {
    const api = fixture("notConfigured"); await run(api); expect(api.service.initialize).toHaveBeenCalledOnce();
    const refused = fixture("notConfigured"); refused.service.status.mockResolvedValue({ ...state("notConfigured"), canInitialize: false });
    await expect(run(refused)).rejects.toThrow("not ready"); expect(refused.service.initialize).not.toHaveBeenCalled();
  });
  it("retains existing direct ownership", async () => {
    const api = fixture("direct"); await run(api); expect(api.service.perform).not.toHaveBeenCalled(); expect(api.service.initialize).not.toHaveBeenCalled();
  });
  it("reuses the current desktop without undoing an intentional service stop", async () => {
    const api = fixture("stopped"); api.desktop.status.mockResolvedValue({ state: "running" }); await run(api);
    expect(api.service.status).not.toHaveBeenCalled(); expect(api.desktop.open).toHaveBeenCalledOnce();
  });
  it("waits for readiness without replaying installation", async () => {
    const api = fixture("notInstalled"); api.service.perform.mockResolvedValue(state("starting"));
    api.service.status.mockResolvedValueOnce(state("notInstalled")).mockResolvedValueOnce(state("starting")).mockResolvedValue(state("running"));
    await run(api); expect(api.service.perform).toHaveBeenCalledOnce(); expect(api.desktop.open).toHaveBeenCalledOnce();
  });
  it("bounds a service that never becomes ready", async () => {
    const api = fixture("starting"); const pause = vi.fn().mockResolvedValue(undefined);
    await expect(run(api, new AbortController().signal, pause)).rejects.toThrow("not ready");
    expect(pause).toHaveBeenCalledTimes(120); expect(api.desktop.open).not.toHaveBeenCalled();
  });
  it("does not replay an uncertain native mutation", async () => {
    const api = fixture("stopped"); api.service.perform.mockRejectedValue(new Error("Service manager timed out"));
    await expect(run(api)).rejects.toThrow("timed out"); expect(api.service.perform).toHaveBeenCalledOnce(); expect(api.handoff).not.toHaveBeenCalled();
  });
  it("does not initialize anything for a missing or unsupported package", async () => {
    for (const value of ["notBundled", "unsupported", "unavailable"]) {
      const api = fixture("notConfigured"); api.desktop.status.mockResolvedValue({ state: value });
      await expect(run(api)).rejects.toThrow(); expect(api.service.status).not.toHaveBeenCalled(); expect(api.handoff).not.toHaveBeenCalled();
    }
  });
  it("preserves an actionable open error and keeps recovery visible", async () => {
    const api = fixture(); api.desktop.open.mockResolvedValue({ state: "ready", error: "Start the background service" });
    await expect(run(api)).rejects.toThrow("Start the background service"); expect(api.handoff).not.toHaveBeenCalled();
  });
  it("does not open or hide after an abandoned in-flight setup", async () => {
    const api = fixture("notConfigured"), controller = new AbortController();
    api.service.initialize.mockImplementation(async () => { controller.abort(); return state("running"); });
    await expect(run(api, controller.signal)).rejects.toThrow(); expect(api.desktop.open).not.toHaveBeenCalled(); expect(api.handoff).not.toHaveBeenCalled();
  });
});
