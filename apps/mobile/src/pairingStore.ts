import * as SecureStore from "expo-secure-store";
import {
  hasDesktopPairingPayloadExpired,
  isHostPlatform,
  isPairingCode,
  parseDesktopPairingPayload,
  type DesktopPairingPayload,
  type HostId,
  type PairedHostSummary,
} from "@blackcrab/remote-protocol";

const STORAGE_KEY = "blackcrab.mobile.pairedHosts.v1";
const MANUAL_HOST_ID_PREFIX = "manual-pairing-";

export type StoredPairingSource = "desktop_payload" | "manual_code";

export interface StoredPairedHost extends PairedHostSummary {
  pairedAt: string;
  pairingSource: StoredPairingSource;
  /** Set after a successful LAN pairing handshake. */
  remoteToken?: string;
  /** base64 32-byte E2E key for relay traffic, minted over LAN at pairing. */
  e2eKey?: string;
  /** This device's id, used to address it through the relay. */
  deviceId?: string;
  /** Relay URL to reach this host off-LAN, when the host advertised one. */
  relayUrl?: string;
  /** LAN endpoint to reconnect to with the remoteToken. */
  lanHost?: string;
  lanPort?: number;
}

export type CreateStoredHostResult =
  | { ok: true; host: StoredPairedHost }
  | { ok: false; error: string };

export type PairHostFromInputResult =
  | { ok: true; host: StoredPairedHost; hosts: StoredPairedHost[] }
  | { ok: false; error: string };

const memoryStore = new Map<string, string>();

export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function createStoredHostFromPairingInput(
  input: string,
  now = new Date(),
): CreateStoredHostResult {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return { ok: false, error: "Enter a pairing code or payload." };
  }

  const payload = parseDesktopPairingPayload(trimmedInput);
  if (payload) {
    if (hasDesktopPairingPayloadExpired(payload, now.getTime())) {
      return { ok: false, error: "This pairing code has expired." };
    }

    return {
      ok: true,
      host: storedHostFromPayload(payload, now),
    };
  }

  const code = normalizePairingCode(trimmedInput);
  if (!isPairingCode(code)) {
    return { ok: false, error: "Pairing code is not valid." };
  }

  return {
    ok: true,
    host: {
      hostId: `${MANUAL_HOST_ID_PREFIX}${code.toLowerCase()}`,
      displayName: `Desktop ${code.slice(-4)}`,
      platform: "unknown",
      appVersion: "unknown",
      lastSeenAt: now.toISOString(),
      online: false,
      pairedAt: now.toISOString(),
      pairingSource: "manual_code",
    },
  };
}

export function storedHostFromPayload(
  payload: DesktopPairingPayload,
  now: Date = new Date(),
): StoredPairedHost {
  return {
    hostId: payload.hostId,
    displayName: payload.displayName,
    platform: payload.platform,
    appVersion: payload.appVersion,
    lastSeenAt: now.toISOString(),
    online: false,
    pairedAt: now.toISOString(),
    pairingSource: "desktop_payload",
    lanHost: payload.lanHost,
    lanPort: payload.lanPort,
    relayUrl: payload.relayUrl,
  };
}

export async function persistPairedHost(
  host: StoredPairedHost,
): Promise<StoredPairedHost[]> {
  return upsertStoredHost(host);
}

export async function pairHostFromInput(
  input: string,
): Promise<PairHostFromInputResult> {
  const result = createStoredHostFromPairingInput(input);
  if (!result.ok) {
    return result;
  }

  const hosts = await upsertStoredHost(result.host);
  return { ok: true, host: result.host, hosts };
}

export async function loadStoredHosts(): Promise<StoredPairedHost[]> {
  const value = await readStoredValue(STORAGE_KEY);
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredPairedHost);
  } catch {
    return [];
  }
}

export async function forgetStoredHost(hostId: HostId): Promise<StoredPairedHost[]> {
  const hosts = await loadStoredHosts();
  const nextHosts = hosts.filter((host) => host.hostId !== hostId);
  await writeStoredValue(STORAGE_KEY, JSON.stringify(nextHosts));
  return nextHosts;
}

async function upsertStoredHost(host: StoredPairedHost): Promise<StoredPairedHost[]> {
  const hosts = await loadStoredHosts();
  const nextHosts = [host, ...hosts.filter((stored) => stored.hostId !== host.hostId)];
  await writeStoredValue(STORAGE_KEY, JSON.stringify(nextHosts));
  return nextHosts;
}

function isStoredPairedHost(value: unknown): value is StoredPairedHost {
  if (!isRecord(value)) return false;

  return (
    typeof value.hostId === "string" &&
    value.hostId.length > 0 &&
    typeof value.displayName === "string" &&
    value.displayName.length > 0 &&
    isHostPlatform(value.platform) &&
    typeof value.appVersion === "string" &&
    typeof value.lastSeenAt === "string" &&
    typeof value.online === "boolean" &&
    typeof value.pairedAt === "string" &&
    (value.pairingSource === "desktop_payload" ||
      value.pairingSource === "manual_code") &&
    (value.remoteToken === undefined || typeof value.remoteToken === "string") &&
    (value.e2eKey === undefined || typeof value.e2eKey === "string") &&
    (value.deviceId === undefined || typeof value.deviceId === "string") &&
    (value.relayUrl === undefined || typeof value.relayUrl === "string") &&
    (value.lanHost === undefined || typeof value.lanHost === "string") &&
    (value.lanPort === undefined || typeof value.lanPort === "number")
  );
}

async function readStoredValue(key: string): Promise<string | null> {
  if (await canUseSecureStore()) {
    return SecureStore.getItemAsync(key);
  }

  const storage = getLocalStorage();
  if (storage) {
    return storage.getItem(key);
  }

  return memoryStore.get(key) ?? null;
}

async function writeStoredValue(key: string, value: string): Promise<void> {
  if (await canUseSecureStore()) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  const storage = getLocalStorage();
  if (storage) {
    storage.setItem(key, value);
    return;
  }

  memoryStore.set(key, value);
}

async function canUseSecureStore(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getLocalStorage(): LocalStorageLike | null {
  try {
    return (
      (globalThis as { localStorage?: LocalStorageLike }).localStorage ?? null
    );
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
