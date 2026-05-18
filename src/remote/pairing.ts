/**
 * TypeScript facade for the desktop pairing service.
 *
 * Wraps the Tauri commands defined in `src-tauri/src/pairing.rs`. No transport
 * yet — these calls only manage local pairing state on disk.
 */

import { invoke } from "@tauri-apps/api/core";

export interface PairedDevice {
  deviceId: string;
  displayName: string;
  pairedAtMs: number;
  lastSeenAtMs: number;
}

export interface PairingStartResponse {
  code: string;
  expiresAtMs: number;
}

export interface PairingAcceptResponse {
  remoteToken: string;
  pairedDevice: PairedDevice;
}

export type PairingInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoker: PairingInvoker = (command, args) =>
  invoke(command, args) as Promise<never>;

export interface PairingClientOptions {
  invoker?: PairingInvoker;
}

export class PairingClient {
  private readonly invoker: PairingInvoker;

  constructor(options: PairingClientOptions = {}) {
    this.invoker = options.invoker ?? defaultInvoker;
  }

  start(): Promise<PairingStartResponse> {
    return this.invoker<PairingStartResponse>("pairing_start");
  }

  accept(code: string, deviceName: string): Promise<PairingAcceptResponse> {
    return this.invoker<PairingAcceptResponse>("pairing_accept", {
      code,
      deviceName,
    });
  }

  cancel(code: string): Promise<boolean> {
    return this.invoker<boolean>("pairing_cancel", { code });
  }

  listDevices(): Promise<PairedDevice[]> {
    return this.invoker<PairedDevice[]>("pairing_list_devices");
  }

  revoke(deviceId: string): Promise<boolean> {
    return this.invoker<boolean>("pairing_revoke", { deviceId });
  }
}

export const pairingClient = new PairingClient();
