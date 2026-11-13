import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ManagedServiceControls } from "./ManagedServiceControls";
import type { ManagedServiceClient, ServiceStatus } from "./managedServiceClient";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const status = (state: ServiceStatus["state"], extra: Partial<ServiceStatus> = {}): ServiceStatus => ({ state, canInitialize: false, installed: false, loaded: false, ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function client(overrides: Partial<ManagedServiceClient> = {}): ManagedServiceClient {
  return { status: vi.fn(async () => status("notConfigured", { canInitialize: true })), initialize: vi.fn(async () => status("running", { installed: true, loaded: true })), perform: vi.fn(async () => status("stopped", { installed: true })), ...overrides };
}
function surface(api: ManagedServiceClient) {
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  return { element, render: (value = api) => act(() => root.render(<ManagedServiceControls client={value} />)),
    button: (text: string) => Array.from(element.querySelectorAll("button")).find(item => item.textContent === text)!,
    dispose: () => { act(() => root.unmount()); element.remove(); } };
}
it("enables only after status and fences duplicate setup requests", async () => {
  const setup = deferred<ServiceStatus>(), api = client({ initialize: vi.fn(() => setup.promise) }), view = surface(api);
  try { await act(async () => view.render()); act(() => view.button("Enable background service").click());
    expect(view.button("Enable background service").disabled).toBe(true); act(() => view.button("Enable background service").click());
    expect(api.initialize).toHaveBeenCalledTimes(1); expect(view.element.textContent).toContain("Enabling background service");
    await act(async () => setup.resolve(status("running", { installed: true, loaded: true })));
    expect(view.button("Stop background service").disabled).toBe(false); expect(view.element.textContent).toContain("service is running");
  } finally { view.dispose(); }
});
it("offers lifecycle actions from actual installed and loaded state", async () => {
  const api = client({ status: vi.fn(async () => status("running", { installed: true, loaded: true })), perform: vi.fn(async () => status("stopped", { installed: true })) }), view = surface(api);
  try { await act(async () => view.render()); await act(async () => view.button("Stop background service").click());
    expect(api.perform).toHaveBeenCalledExactlyOnceWith("stop"); expect(view.button("Start background service").disabled).toBe(false);
    await act(async () => view.button("Uninstall background service").click()); expect(api.perform).toHaveBeenLastCalledWith("uninstall");
    expect(view.element.textContent).toContain("keeps workspace history and settings");
  } finally { view.dispose(); }
});
it("refreshes prepared state after a failed enable without initializing over it again", async () => {
  const api = client({ status: vi.fn().mockResolvedValueOnce(status("notConfigured", { canInitialize: true })).mockResolvedValue(status("notInstalled")), initialize: vi.fn().mockRejectedValue(new Error("Service activation failed.")) }), view = surface(api);
  try { await act(async () => view.render()); await act(async () => view.button("Enable background service").click());
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe("Service activation failed.");
    expect(view.button("Install background service").disabled).toBe(false); expect(view.button("Enable background service")).toBeUndefined();
    expect(api.initialize).toHaveBeenCalledTimes(1);
  } finally { view.dispose(); }
});
it("ignores stale operation results after client replacement", async () => {
  const operation = deferred<ServiceStatus>(), old = client({ initialize: vi.fn(() => operation.promise) }), next = client({ status: vi.fn(async () => status("stopped", { installed: true })) }), view = surface(old);
  try { await act(async () => view.render()); act(() => view.button("Enable background service").click());
    await act(async () => view.render(next)); await act(async () => operation.resolve(status("running", { installed: true, loaded: true })));
    expect(view.element.textContent).toContain("service is stopped"); expect(view.button("Stop background service")).toBeUndefined();
  } finally { view.dispose(); }
});
it("hides unavailable installations and preserves loaded controls after readiness errors", async () => {
  const api = client({ status: vi.fn(async () => status("notAvailable")) }), view = surface(api);
  try { await act(async () => view.render()); expect(view.element.textContent).toBe("");
    await act(async () => view.render(client({ status: vi.fn(async () => status("unavailable", { installed: true, loaded: true, error: "Host identity was refused." })) })));
    expect(view.button("Stop background service").disabled).toBe(false); expect(view.element.querySelector('[role="alert"]')?.textContent).toBe("Host identity was refused.");
  } finally { view.dispose(); }
});
it("explains the permission-name update without restarting an active service automatically", async () => {
  const api = client({
    status: vi.fn(async () => status("running", { installed: true, loaded: true, permissionIdentityRestartRequired: true })),
    perform: vi.fn(async () => status("running", { installed: true, loaded: true, permissionIdentityRestartRequired: false })),
  }), view = surface(api);
  try {
    await act(async () => view.render());
    expect(view.element.textContent).toContain("when your agents are idle");
    expect(api.perform).not.toHaveBeenCalled();
    await act(async () => view.button("Restart background service").click());
    expect(api.perform).toHaveBeenCalledExactlyOnceWith("restart");
    expect(view.element.textContent).not.toContain("when your agents are idle");
  } finally { view.dispose(); }
});
