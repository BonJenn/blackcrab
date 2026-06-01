/**
 * Auto-reconnect on app launch. A host paired over LAN persists its remote
 * token and LAN endpoint, which is everything needed to re-authenticate
 * without re-pairing. Constructing a `LanWebSocketTransport` here kicks off the
 * connection immediately and, via its built-in backoff, keeps retrying.
 */

import type { StoredPairedHost } from "../pairingStore";
import {
  LanWebSocketTransport,
  type LanWebSocketTransportConfig,
} from "./lanWebSocketTransport";

// The desktop ignores the device name on token re-auth (it's only used to
// label a brand-new pairing), so a plain constant avoids a react-native
// `Platform` import and keeps this module unit-testable.
const RECONNECT_DEVICE_NAME = "Blackcrab mobile";

/** A stored host can reconnect only if it kept a token and a LAN endpoint. */
export function canReconnect(host: StoredPairedHost): boolean {
  return (
    typeof host.remoteToken === "string" &&
    host.remoteToken.length > 0 &&
    typeof host.lanHost === "string" &&
    host.lanHost.length > 0 &&
    typeof host.lanPort === "number"
  );
}

/** The most-recently-paired host that can reconnect, if any. */
export function firstReconnectableHost(
  hosts: StoredPairedHost[],
): StoredPairedHost | undefined {
  return hosts.find(canReconnect);
}

export interface ConnectStoredHostOptions {
  /** Fired if the stored token is rejected (e.g. revoked on the desktop). */
  onFatalReject?: (reason: string) => void;
  webSocketFactory?: LanWebSocketTransportConfig["webSocketFactory"];
  timers?: LanWebSocketTransportConfig["timers"];
}

/**
 * Open a token-authenticated transport to a stored host. Returns `null` when
 * the host lacks a token or endpoint (e.g. a manual-code pairing).
 */
export function connectStoredHost(
  host: StoredPairedHost,
  options: ConnectStoredHostOptions = {},
): LanWebSocketTransport | null {
  if (!canReconnect(host)) return null;
  return new LanWebSocketTransport({
    url: `ws://${host.lanHost}:${host.lanPort}`,
    remoteToken: host.remoteToken,
    deviceName: RECONNECT_DEVICE_NAME,
    hostId: host.hostId,
    onFatalReject: options.onFatalReject,
    webSocketFactory: options.webSocketFactory,
    timers: options.timers,
  });
}
