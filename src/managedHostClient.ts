import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type ManagedHostStatus = {
  state: "notConfigured" | "stopped" | "running" | "unavailable";
  artifactPath?: string;
  environmentId?: string;
  error?: string;
};

export interface ManagedHostClient {
  status(): Promise<ManagedHostStatus>;
  start(artifactPath: string): Promise<ManagedHostStatus>;
  openWorkspace(): Promise<void>;
  chooseArtifactDirectory(): Promise<string | null>;
}

function readStatus(value: unknown): ManagedHostStatus {
  if (!value || typeof value !== "object") throw new Error("Unexpected workspace service response.");
  const result = value as Record<string, unknown>;
  if (!["notConfigured", "stopped", "running", "unavailable"].includes(result.state as string)
    || ["artifactPath", "environmentId", "error"].some(key => result[key] !== undefined && typeof result[key] !== "string")) {
    throw new Error("Unexpected workspace service response.");
  }
  return result as ManagedHostStatus;
}

export const managedHostClient: ManagedHostClient = {
  status: async () => readStatus(await invoke<unknown>("managed_host_status")),
  start: async artifactPath => readStatus(await invoke<unknown>("managed_host_start", { artifactPath })),
  openWorkspace: () => invoke<void>("managed_workspace_open"),
  chooseArtifactDirectory: async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose workspace runtime" });
    return typeof selected === "string" ? selected : null;
  },
};
