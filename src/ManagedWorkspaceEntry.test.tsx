import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ManagedWorkspaceEntry } from "./ManagedWorkspaceEntry";
import type { ManagedHostClient, ManagedHostStatus } from "./managedHostClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function client(overrides: Partial<ManagedHostClient> = {}): ManagedHostClient {
  return { status: vi.fn(async (): Promise<ManagedHostStatus> => ({ state: "notConfigured" })), start: vi.fn(async (): Promise<ManagedHostStatus> => ({ state: "running", artifactPath: "/runtime" })), openWorkspace: vi.fn(async () => {}), chooseArtifactDirectory: vi.fn(async () => "/runtime"), ...overrides };
}
function surface(api: ManagedHostClient) {
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  const render = (value = api) => act(() => root.render(<ManagedWorkspaceEntry client={value} />));
  const button = (text: string) => Array.from(element.querySelectorAll("button")).find(item => item.textContent === text)!;
  const dispose = () => { act(() => root.unmount()); element.remove(); };
  return { element, render, button, dispose };
}

it("waits for startup status and prevents duplicate starts while the selected runtime starts", async () => {
  const check = deferred<ManagedHostStatus>(), start = deferred<ManagedHostStatus>();
  const api = client({ status: vi.fn(() => check.promise), start: vi.fn(() => start.promise) });
  const view = surface(api);
  try {
    view.render();
    expect(view.element.textContent).toContain("Checking workspace service");
    expect(Array.from(view.element.querySelectorAll("button")).every(item => item.disabled)).toBe(true);
    await act(async () => check.resolve({ state: "notConfigured" }));
    expect(view.element.textContent).toContain("Choose a workspace runtime to get started");
    await act(async () => view.button("Choose workspace runtime").click());
    expect(view.element.textContent).toContain("Starting workspace service");
    expect(api.start).toHaveBeenCalledExactlyOnceWith("/runtime");
    act(() => view.button("Choose workspace runtime").click());
    expect(api.start).toHaveBeenCalledTimes(1);
    await act(async () => start.resolve({ state: "running", artifactPath: "/runtime", environmentId: "environment" }));
    expect(view.button("Open workspace").disabled).toBe(false);
    expect(view.element.textContent).toContain("Workspace service is running");
    expect(view.element.textContent).not.toContain("environment");
  } finally { view.dispose(); }
});

it("cancels folder selection without changing the configured host or starting it", async () => {
  const api = client({ status: vi.fn(async (): Promise<ManagedHostStatus> => ({ state: "stopped", artifactPath: "/existing" })), chooseArtifactDirectory: vi.fn(async () => null) });
  const view = surface(api);
  try {
    await act(async () => view.render());
    await act(async () => view.button("Change workspace runtime").click());
    expect(api.start).not.toHaveBeenCalled(); expect(api.openWorkspace).not.toHaveBeenCalled();
    expect(view.element.textContent).toContain("Workspace service is stopped");
    expect(view.button("Open workspace").disabled).toBe(false);
  } finally { view.dispose(); }
});

it("keeps actionable failures visible and lets the user retry selection and opening", async () => {
  const api = client({ start: vi.fn().mockRejectedValueOnce(new Error("Runtime integrity check failed.")).mockResolvedValue({ state: "running", artifactPath: "/runtime" }), openWorkspace: vi.fn().mockRejectedValueOnce(new Error("Workspace window could not open.")).mockResolvedValue(undefined) });
  const view = surface(api);
  try {
    await act(async () => view.render());
    await act(async () => view.button("Choose workspace runtime").click());
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe("Runtime integrity check failed.");
    await act(async () => view.button("Choose workspace runtime").click());
    expect(view.element.querySelector('[role="alert"]')).toBeNull();
    await act(async () => view.button("Open workspace").click());
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe("Workspace window could not open.");
    vi.mocked(api.status).mockResolvedValue({ state: "running", artifactPath: "/runtime" });
    await act(async () => view.button("Open workspace").click());
    expect(view.element.textContent).toContain("Workspace window opened.");
    expect(view.element.querySelector('[role="alert"]')).toBeNull();
  } finally { view.dispose(); }
});

it("retires pending reads and folder selections when their client is replaced", async () => {
  const staleCheck = deferred<ManagedHostStatus>(), selection = deferred<string | null>();
  const old = client({ status: vi.fn(() => staleCheck.promise) });
  const current = client({ chooseArtifactDirectory: vi.fn(() => selection.promise) });
  const next = client({ status: vi.fn(async (): Promise<ManagedHostStatus> => ({ state: "running", artifactPath: "/next" })) });
  const view = surface(old);
  try {
    view.render();
    await act(async () => view.render(current));
    await act(async () => staleCheck.reject(new Error("retired read")));
    expect(view.element.textContent).not.toContain("retired read");
    await act(async () => view.button("Choose workspace runtime").click());
    await act(async () => view.render(next));
    await act(async () => selection.resolve("/retired-selection"));
    expect(current.start).not.toHaveBeenCalled();
    expect(view.element.textContent).toContain("Workspace service is running");
    expect(view.button("Open workspace").disabled).toBe(false);
  } finally { view.dispose(); }
});

it("distinguishes an opened window from a subsequent status refresh failure", async () => {
  const api = client({ status: vi.fn().mockResolvedValueOnce({ state: "running", artifactPath: "/runtime" }).mockRejectedValueOnce(new Error("Status refresh unavailable.")) });
  const view = surface(api);
  try {
    await act(async () => view.render());
    await act(async () => view.button("Open workspace").click());
    expect(view.element.textContent).toContain("Workspace window opened.");
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe("Status refresh unavailable.");
    expect(view.button("Open workspace").disabled).toBe(false);
  } finally { view.dispose(); }
});

it("offers refresh after a startup failure and surfaces an unavailable host's explanation", async () => {
  const api = client({ status: vi.fn().mockRejectedValueOnce(new Error("Host status unavailable.")).mockResolvedValueOnce({ state: "unavailable", artifactPath: "/runtime", error: "Configured runtime was moved." }) });
  const view = surface(api);
  try {
    await act(async () => view.render());
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe("Host status unavailable.");
    await act(async () => view.button("Refresh status").click());
    expect(view.element.textContent).toContain("Workspace service is unavailable");
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe("Configured runtime was moved.");
    expect(view.button("Change workspace runtime").disabled).toBe(false);
  } finally { view.dispose(); }
});
