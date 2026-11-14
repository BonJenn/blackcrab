import type { ManagedNativeDesktopClient } from "./managedNativeDesktopClient";
import type { ManagedServiceClient } from "./managedServiceClient";

export interface WorkspaceStartupClient {
  desktop: ManagedNativeDesktopClient;
  service: ManagedServiceClient;
  handoff(): Promise<void>;
}

function wait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** One serialized startup attempt. Never replay an uncertain service mutation. */
export async function startWorkspace(client: WorkspaceStartupClient, signal: AbortSignal,
  progress: (message: string) => void, pause = wait): Promise<void> {
  const current = () => signal.throwIfAborted();
  progress("Checking your workspace…");
  const desktop = await client.desktop.status(); current();
  if (!["ready", "running"].includes(desktop.state)) {
    throw new Error(desktop.error ?? (desktop.state === "unsupported"
      ? "This Blackcrab installation does not support the workspace on this platform."
      : "The workspace package could not be loaded. Install the complete Blackcrab app or check for an update."));
  }
  // Reusing an open workspace must not undo an intentional service stop.
  if (desktop.state !== "running") {
    let service = await client.service.status(); current();
    if (service.state === "notConfigured" && service.canInitialize) {
      progress("Setting up your workspace…");
      service = await client.service.initialize(); current();
    } else if (service.state === "notInstalled") {
      progress("Installing the background service…");
      service = await client.service.perform("install"); current();
    } else if (service.state === "stopped") {
      progress("Starting the background service…");
      service = await client.service.perform("start"); current();
    }
    for (let tries = 0; service.state === "starting" && tries < 120; tries++) {
      progress("Starting the background service…");
      await pause(signal); current();
      service = await client.service.status(); current();
    }
    // Existing direct ownership is valid; never replace it with a new service.
    if (!["running", "direct"].includes(service.state)) {
      throw new Error(service.error ?? "The background service is not ready. Check its status below, then try again.");
    }
  }
  progress("Opening Blackcrab…");
  const opened = await client.desktop.open(); current();
  if (opened.state !== "running") throw new Error(opened.error ?? "The workspace could not open. Check the background service and try again.");
  await client.handoff(); current();
}
