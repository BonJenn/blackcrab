import * as SecureStore from "expo-secure-store";
import {
  hasDesktopPairingPayloadExpired,
  isHostPlatform,
  isPairingCode,
  parseDesktopPairingPayload,
  type DesktopPairingPayload,
  type HostId,
  type MessageId,
  type PairedHostSummary,
  type SessionId,
} from "@blackcrab/remote-protocol";

const STORAGE_KEY = "blackcrab.mobile.pairedHosts.v1";
const READ_CURSOR_KEY = "blackcrab.mobile.readCursors.v1";
const MANUAL_HOST_ID_PREFIX = "manual-pairing-";

export type StoredPairingSource = "desktop_payload" | "manual_code";

export interface StoredPairedHost extends PairedHostSummary {
  pairedAt: string;
  pairingSource: StoredPairingSource;
  /** Set after a successful LAN pairing handshake. */
  remoteToken?: string;
  /** base64 32-byte E2E key for relay traffic, minted over LAN at pairing. */
  e2eKey?: string;
  /**
   * Per-device relay auth token minted by the desktop at pairing. Sent in the
   * relay hello for a future device-auth gate; not yet required by the relay.
   */
  relayDeviceToken?: string;
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
    (value.relayDeviceToken === undefined ||
      typeof value.relayDeviceToken === "string") &&
    (value.deviceId === undefined || typeof value.deviceId === "string") &&
    (value.relayUrl === undefined || typeof value.relayUrl === "string") &&
    (value.lanHost === undefined || typeof value.lanHost === "string") &&
    (value.lanPort === undefined || typeof value.lanPort === "number")
  );
}

// ---------------------------------------------------------------------------
// Read cursors: cache the host-canonical "last read message" per session so the
// transcript can show a "new messages" divider and land where you left off even
// before the host's snapshot arrives. The host remains authoritative; this is a
// local cache keyed by host + session.
// ---------------------------------------------------------------------------

export interface StoredReadCursor {
  hostId: HostId;
  sessionId: SessionId;
  lastReadMessageId: MessageId;
  readAtMs: number;
}

export function readCursorKey(hostId: HostId, sessionId: SessionId): string {
  return `${hostId}:${sessionId}`;
}

export async function loadReadCursors(): Promise<StoredReadCursor[]> {
  const value = await readStoredValue(READ_CURSOR_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredReadCursor);
  } catch {
    return [];
  }
}

export async function saveReadCursor(
  cursor: StoredReadCursor,
): Promise<StoredReadCursor[]> {
  const existing = await loadReadCursors();
  const key = readCursorKey(cursor.hostId, cursor.sessionId);
  const next = [
    cursor,
    ...existing.filter(
      (c) => readCursorKey(c.hostId, c.sessionId) !== key,
    ),
  ];
  await writeStoredValue(READ_CURSOR_KEY, JSON.stringify(next));
  return next;
}

function isStoredReadCursor(value: unknown): value is StoredReadCursor {
  if (!isRecord(value)) return false;
  return (
    typeof value.hostId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.lastReadMessageId === "string" &&
    typeof value.readAtMs === "number"
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
