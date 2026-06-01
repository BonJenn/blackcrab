/**
 * One-shot pairing helper. Constructs a `LanWebSocketTransport` configured
 * with a pairing code, waits for the desktop to accept or reject, persists
 * the resulting host (with its remote token and LAN endpoint), and resolves
 * with the stored host. The transport is left open so the caller can keep
 * using it as the live connection.
 */

import type { DesktopPairingPayload } from "@blackcrab/remote-protocol";

import {
  persistPairedHost,
  storedHostFromPayload,
  type StoredPairedHost,
} from "../pairingStore";
import {
  LanWebSocketTransport,
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

export function buildLanUrl(payload: DesktopPairingPayload): string {
  return `ws://${payload.lanHost}:${payload.lanPort}`;
}

export async function pairOverLan(
  payload: DesktopPairingPayload,
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
      hostId: payload.hostId,
      webSocketFactory: options.webSocketFactory,
      timers: options.timers,
      onPaired: ({ remoteToken, e2eKey }) => {
        finalize(async () => {
          clearTimeout(timeoutHandle);
          const host: StoredPairedHost = {
            ...storedHostFromPayload(payload),
            remoteToken,
            e2eKey,
            online: true,
            lastSeenAt: new Date().toISOString(),
          };
          const hosts = await persistPairedHost(host);
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
