/**
 * Thin facade between the desktop UI process and the remote protocol.
 *
 * Pulls host metadata from the Tauri command `remote_host_info`, then runs
 * the pure `buildSnapshotEvents` adapter to produce typed `RemoteEvent[]`.
 * No transport, no subscription — the future local-network bridge or relay
 * client calls `getRemoteSnapshot` and forwards the result.
 */

import { invoke } from "@tauri-apps/api/core";
import type { HostPlatform, RemoteEvent } from "@blackcrab/remote-protocol";

import {
  buildSnapshotEvents,
  type DesktopApprovalPrompt,
  type DesktopHostInfo,
  type DesktopSessionActivity,
  type DesktopSessionInfo,
} from "./snapshot";

const VALID_PLATFORMS = new Set<HostPlatform>([
  "macos",
  "windows",
  "linux",
  "unknown",
]);

function asPlatform(value: unknown): HostPlatform {
  return typeof value === "string" && VALID_PLATFORMS.has(value as HostPlatform)
    ? (value as HostPlatform)
    : "unknown";
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Normalize the raw `remote_host_info` payload into a `DesktopHostInfo`.
 * Exported so unit tests can exercise the validation without invoking Tauri.
 */
export function normalizeHostInfo(raw: unknown): DesktopHostInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const displayName = asString(r.displayName, "blackcrab-host");
  return {
    hostId: asString(r.hostId, `desktop-${displayName}`),
    displayName,
    platform: asPlatform(r.platform),
    appVersion: asString(r.appVersion, "0.0.0"),
    online: asBool(r.online, true),
    lastSeenAtMs: asNumber(r.lastSeenAtMs, Date.now()),
  };
}

export interface GetRemoteSnapshotInput {
  sessions: {
    info: DesktopSessionInfo;
    activity?: DesktopSessionActivity;
  }[];
  approvals?: DesktopApprovalPrompt[];
}

export type HostInfoInvoker = () => Promise<unknown>;

const defaultInvoker: HostInfoInvoker = () => invoke("remote_host_info");

export async function fetchDesktopHostInfo(
  invoker: HostInfoInvoker = defaultInvoker,
): Promise<DesktopHostInfo> {
  const raw = await invoker();
  return normalizeHostInfo(raw);
}

/**
 * Build the snapshot bundle a freshly-connected mobile client would receive.
 * Accepts already-known session and approval data from callers (the desktop
 * UI already holds it) and pulls host metadata from Rust.
 */
export async function getRemoteSnapshot(
  input: GetRemoteSnapshotInput,
  options: { invoker?: HostInfoInvoker } = {},
): Promise<RemoteEvent[]> {
  const host = await fetchDesktopHostInfo(options.invoker);
  return buildSnapshotEvents({
    host,
    sessions: input.sessions,
    approvals: input.approvals,
  });
}
