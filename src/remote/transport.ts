/**
 * TypeScript facade for the desktop transport server (LAN WebSocket).
 *
 * Mirrors the Tauri command `remote_transport_info`, which returns the
 * LAN host + port the server is bound to.
 */

import { invoke } from "@tauri-apps/api/core";

export interface TransportEndpoint {
  host: string;
  port: number;
}

export type TransportInfoInvoker = () => Promise<unknown>;

const defaultInvoker: TransportInfoInvoker = () =>
  invoke("remote_transport_info");

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asPort(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 65535
    ? value
    : fallback;
}

export function normalizeTransportInfo(raw: unknown): TransportEndpoint {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    host: asString(r.host, "127.0.0.1"),
    port: asPort(r.port, 0),
  };
}

export async function fetchTransportEndpoint(
  invoker: TransportInfoInvoker = defaultInvoker,
): Promise<TransportEndpoint> {
  return normalizeTransportInfo(await invoker());
}

export type RelayUrlInvoker = () => Promise<unknown>;

const defaultRelayUrlInvoker: RelayUrlInvoker = () => invoke("remote_relay_url");

/** The relay URL the desktop is configured with, or "" when none. */
export async function fetchRelayUrl(
  invoker: RelayUrlInvoker = defaultRelayUrlInvoker,
): Promise<string> {
  const value = await invoker();
  return typeof value === "string" ? value : "";
}
