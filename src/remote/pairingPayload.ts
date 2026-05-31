/**
 * Builds a serializable `DesktopPairingPayload` from a `pairing_start` response,
 * the host metadata returned by `remote_host_info`, and the LAN address the
 * desktop's transport server is listening on. The serialized JSON is what the
 * desktop renders as a QR for the mobile companion to scan.
 */

import {
  createDesktopPairingPayload,
  serializeDesktopPairingPayload,
  type DesktopPairingPayload,
} from "@blackcrab/remote-protocol";

import { fetchDesktopHostInfo, type HostInfoInvoker } from "./desktop";
import type { PairingStartResponse } from "./pairing";
import type { TransportEndpoint } from "./transport";

export interface BuiltPairingPayload {
  payload: DesktopPairingPayload;
  serialized: string;
}

export async function buildPairingPayload(
  start: PairingStartResponse,
  lan: TransportEndpoint,
  invoker?: HostInfoInvoker,
): Promise<BuiltPairingPayload> {
  const host = await fetchDesktopHostInfo(invoker);
  const payload = createDesktopPairingPayload({
    hostId: host.hostId,
    displayName: host.displayName,
    platform: host.platform,
    appVersion: host.appVersion,
    code: start.code,
    expiresAtMs: start.expiresAtMs,
    lanHost: lan.host,
    lanPort: lan.port,
  });
  return { payload, serialized: serializeDesktopPairingPayload(payload) };
}
