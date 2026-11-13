import { invoke } from "@tauri-apps/api/core";
export type ServiceState = "notAvailable" | "notConfigured" | "direct" | "notInstalled" | "stopped" | "starting" | "running" | "unavailable";
export type ServiceAction = "install" | "start" | "stop" | "restart" | "uninstall";
export type ServiceStatus = { state: ServiceState; canInitialize: boolean; installed: boolean; loaded: boolean; error?: string };
export interface ManagedServiceClient {
  status(): Promise<ServiceStatus>;
  initialize(): Promise<ServiceStatus>;
  perform(action: ServiceAction): Promise<ServiceStatus>;
}
export function readServiceStatus(value: unknown): ServiceStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected background-service response.");
  const result = value as Record<string, unknown>;
  if (!["notAvailable", "notConfigured", "direct", "notInstalled", "stopped", "starting", "running", "unavailable"].includes(result.state as string)
    || ["canInitialize", "installed", "loaded"].some(key => typeof result[key] !== "boolean")
    || (result.error !== undefined && typeof result.error !== "string")
    || Object.keys(result).some(key => !["state", "canInitialize", "installed", "loaded", "error"].includes(key))) throw new Error("Unexpected background-service response.");
  return result as ServiceStatus;
}
const control = async (action: ServiceAction | "status") => readServiceStatus(await invoke<unknown>("managed_service_control", { action }));
export const managedServiceClient: ManagedServiceClient = {
  status: () => control("status"),
  initialize: async () => { await invoke<unknown>("managed_service_initialize"); return control("install"); },
  perform: control,
};
