import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  isHostPlatform,
  type DesktopPairingPayload,
  type HostId,
  type MessageId,
  type PairedHostSummary,
  type SessionId,
} from "@blackcrab/remote-protocol";

const STORAGE_KEY = "blackcrab.mobile.pairedHosts.v1";
const READ_CURSOR_KEY = "blackcrab.mobile.readCursors.v1";

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

// A mutation reads and replaces a whole collection. Keep later mutations and
// reads behind the durable write, including when the preceding write fails.
const pendingOperations = new Map<string, Promise<void>>();

export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
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
  if (!isStoredPairedHost(host)) throw new Error("Invalid paired host.");
  return updateCollection(STORAGE_KEY, "paired hosts", isStoredPairedHost, hosts =>
    [host, ...hosts.filter(stored => stored.hostId !== host.hostId)],
  );
}

export async function loadStoredHosts(): Promise<StoredPairedHost[]> {
  return serialize(STORAGE_KEY, async () =>
    readCollection(await durableStorage(), STORAGE_KEY, "paired hosts", isStoredPairedHost),
  );
}

export async function forgetStoredHost(hostId: HostId): Promise<StoredPairedHost[]> {
  return updateCollection(STORAGE_KEY, "paired hosts", isStoredPairedHost, hosts =>
    hosts.filter(host => host.hostId !== hostId),
  );
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
    (value.lanPort === undefined || (
      typeof value.lanPort === "number" && Number.isInteger(value.lanPort) &&
      value.lanPort >= 1 && value.lanPort <= 65535
    ))
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
  return JSON.stringify([hostId, sessionId]);
}

export async function loadReadCursors(): Promise<StoredReadCursor[]> {
  return serialize(READ_CURSOR_KEY, async () =>
    readCollection(await durableStorage(), READ_CURSOR_KEY, "read positions", isStoredReadCursor),
  );
}

export async function saveReadCursor(
  cursor: StoredReadCursor,
): Promise<StoredReadCursor[]> {
  if (!isStoredReadCursor(cursor)) throw new Error("Invalid read position.");
  const key = readCursorKey(cursor.hostId, cursor.sessionId);
  return updateCollection(READ_CURSOR_KEY, "read positions", isStoredReadCursor, existing => [
    cursor,
    ...existing.filter(
      (c) => readCursorKey(c.hostId, c.sessionId) !== key,
    ),
  ]);
}

function isStoredReadCursor(value: unknown): value is StoredReadCursor {
  if (!isRecord(value)) return false;
  return (
    typeof value.hostId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.lastReadMessageId === "string" &&
    typeof value.readAtMs === "number" && Number.isFinite(value.readAtMs)
  );
}

function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pendingOperations.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.then(() => {}, () => {});
  pendingOperations.set(key, settled);
  void settled.then(() => {
    if (pendingOperations.get(key) === settled) pendingOperations.delete(key);
  });
  return result;
}

async function readCollection<T>(
  storage: DurableStorage,
  key: string,
  label: string,
  validate: (value: unknown) => value is T,
): Promise<T[]> {
  let value: string | null;
  try { value = await storage.getItem(key); }
  catch { throw new Error(`Could not read saved ${label}. Reopen the app to retry.`); }
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(validate)) return parsed;
  } catch { /* Preserve the complete original value, including malformed JSON. */ }
  throw new Error(`Saved ${label} could not be read. No saved data was changed.`);
}

function updateCollection<T>(
  key: string,
  label: string,
  validate: (value: unknown) => value is T,
  update: (current: T[]) => T[],
): Promise<T[]> {
  return serialize(key, async () => {
    // Choose once for the entire operation; never read from a fallback and then
    // replace an existing keychain collection when native storage recovers.
    const storage = await durableStorage();
    const current = await readCollection(storage, key, label, validate);
    const next = update(current);
    try { await storage.setItem(key, JSON.stringify(next)); }
    catch { throw new Error(`Could not save ${label}. Reopen the app to retry.`); }
    return next;
  });
}

interface DurableStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

async function durableStorage(): Promise<DurableStorage> {
  if (Platform.OS === "web") {
    const storage = getLocalStorage();
    if (!storage) throw new Error("Browser storage is unavailable. Saved pairings cannot be read or changed.");
    return storage;
  }
  try {
    if (await SecureStore.isAvailableAsync()) return {
      getItem: key => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
    };
  } catch { /* A native failure must not switch to a different store. */ }
  throw new Error("Secure storage is unavailable. Reopen the app to retry.");
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
