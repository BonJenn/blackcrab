/**
 * One-shot pairing helper. Constructs a `LanWebSocketTransport` configured
 * with a pairing code, waits for the desktop to accept or reject, persists
 * the resulting host (with its remote token and LAN endpoint), and resolves
 * with the stored host. The transport is left open so the caller can keep
 * using it as the live connection.
 */

import { isPairingCode, type DesktopPairingPayload } from "@blackcrab/remote-protocol";

import {
  persistPairedHost,
  normalizePairingCode,
  storedHostFromPayload,
  type StoredPairedHost,
} from "../pairingStore";
import {
  LanWebSocketTransport,
  lanWebSocketUrl,
  type LanWebSocketTransportConfig,
} from "./lanWebSocketTransport";

export interface PairOverLanOptions {
  /** Display name the phone suggests for itself in the handshake. */
  deviceName: string;
  /** Bail out if the desktop does not respond within this many ms. */
  timeoutMs?: number;
  /** Override the WebSocket impl for tests. */
  webSocketFactory?: LanWebSocketTransportConfig["webSocketFactory"];
  timers?: LanWebSocketTransportConfig["timers"];
}

export interface PairOverLanResult {
  host: StoredPairedHost;
  hosts: StoredPairedHost[];
  transport: LanWebSocketTransport;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ManualPairingTarget {
  type: "manual_address";
  lanHost: string;
  lanPort: number;
  code: string;
}

export function manualPairingTarget(address: string, input: string): ManualPairingTarget {
  const code = normalizePairingCode(input);
  if (!isPairingCode(code)) throw new Error("Pairing code is not valid.");
  const value = address.trim();
  let url: URL;
  try { url = new URL(value.includes("://") ? value : `ws://${value}`); }
  catch { throw new Error("Enter the desktop address and port shown in Remote settings."); }
  const port = value.match(/:(\d+)\/?$/)?.[1];
  if (url.protocol !== "ws:" || !url.hostname || !port || Number(port) < 1 || Number(port) > 65535 ||
      url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("Enter the desktop address and port shown in Remote settings.");
  }
  return { type: "manual_address", code, lanHost: url.hostname.replace(/^\[|\]$/g, ""), lanPort: Number(port) };
}

export function buildLanUrl(payload: Pick<DesktopPairingPayload, "lanHost" | "lanPort">): string {
  return lanWebSocketUrl(payload.lanHost, payload.lanPort);
}

export async function pairOverLan(
  payload: DesktopPairingPayload | ManualPairingTarget,
  options: PairOverLanOptions,
): Promise<PairOverLanResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<PairOverLanResult>((resolve, reject) => {
    let transport: LanWebSocketTransport | null = null;
    let settled = false;

    const finalize = (work: () => Promise<void> | void) => {
      if (settled) return;
      settled = true;
      Promise.resolve()
        .then(work)
        .catch(reject);
    };

    const timeoutHandle = setTimeout(() => {
      finalize(() => {
        transport?.close();
        reject(new Error("Pairing timed out."));
      });
    }, timeoutMs);

    transport = new LanWebSocketTransport({
      url: buildLanUrl(payload),
      pairingCode: payload.code,
      deviceName: options.deviceName,
      hostId: payload.type === "manual_address" ? undefined : payload.hostId,
      webSocketFactory: options.webSocketFactory,
      timers: options.timers,
      onPaired: ({ remoteToken, hostId, e2eKey, deviceId }) => {
        finalize(async () => {
          clearTimeout(timeoutHandle);
          if (payload.type !== "manual_address" && hostId !== payload.hostId) {
            transport?.close();
            throw new Error("Desktop identity did not match the pairing details.");
          }
          const now = new Date();
          const host: StoredPairedHost = {
            ...(payload.type === "manual_address" ? {
              hostId,
              displayName: `Desktop ${payload.lanHost}`,
              platform: "unknown" as const,
              appVersion: "unknown",
              pairedAt: now.toISOString(),
              pairingSource: "manual_code" as const,
              lanHost: payload.lanHost,
              lanPort: payload.lanPort,
            } : storedHostFromPayload(payload, now)),
            remoteToken,
            e2eKey,
            deviceId,
            online: true,
            lastSeenAt: now.toISOString(),
          };
          let hosts: StoredPairedHost[];
          try { hosts = await persistPairedHost(host); }
          catch (error) { transport?.close(); throw error; }
          resolve({ host, hosts, transport: transport! });
        });
      },
      onFatalReject: (reason) => {
        finalize(() => {
          clearTimeout(timeoutHandle);
          transport?.close();
          reject(new Error(reason || "Desktop rejected the pairing."));
        });
      },
    });
  });
}
