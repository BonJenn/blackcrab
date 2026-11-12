import { invoke, isTauri } from "@tauri-apps/api/core";
export type ManagedNativeDesktopStatus = { state: "notBundled" | "ready" | "running" | "unsupported" | "unavailable"; error?: string };
export interface ManagedNativeDesktopClient {
  status(): Promise<ManagedNativeDesktopStatus>;
  open(): Promise<ManagedNativeDesktopStatus>;
}
export function readManagedNativeDesktopStatus(value: unknown): ManagedNativeDesktopStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected desktop response.");
  const result = value as Record<string, unknown>;
  if (!["notBundled", "ready", "running", "unsupported", "unavailable"].includes(result.state as string)
    || (result.error !== undefined && typeof result.error !== "string")
    || Object.keys(result).some(key => key !== "state" && key !== "error")) throw new Error("Unexpected desktop response.");
  return result as ManagedNativeDesktopStatus;
}
export const managedNativeDesktopClient: ManagedNativeDesktopClient = {
  status: async () => isTauri() ? readManagedNativeDesktopStatus(await invoke<unknown>("managed_native_desktop_status")) : { state: "notBundled" },
  open: async () => readManagedNativeDesktopStatus(await invoke<unknown>("managed_native_desktop_open")),
};
