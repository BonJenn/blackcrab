import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ os: "ios", values: new Map<string, string>() }));
vi.mock("react-native", () => ({ Platform: { get OS() { return fixture.os; } } }));
vi.mock("expo-secure-store", () => ({
  isAvailableAsync: vi.fn(async () => true),
  getItemAsync: vi.fn(async (key: string) => fixture.values.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { fixture.values.set(key, value); }),
}));
import * as SecureStore from "expo-secure-store";
import {
  forgetStoredHost, loadReadCursors, loadStoredHosts, persistPairedHost,
  readCursorKey, saveReadCursor, type StoredPairedHost, type StoredReadCursor,
} from "./pairingStore";

const HOSTS = "blackcrab.mobile.pairedHosts.v1";
const CURSORS = "blackcrab.mobile.readCursors.v1";
const host = (hostId: string): StoredPairedHost => ({
  hostId, displayName: hostId, platform: "macos", appVersion: "1",
  lastSeenAt: "2026-01-01T00:00:00.000Z", online: false,
  pairedAt: "2026-01-01T00:00:00.000Z", pairingSource: "desktop_payload",
  remoteToken: "fixture-credential", deviceId: "fixture-phone", lanHost: "127.0.0.1", lanPort: 8124,
});
const cursor = (hostId: string, sessionId = "chat"): StoredReadCursor => ({
  hostId, sessionId, lastReadMessageId: "message", readAtMs: 123,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { fixture.os = "ios"; fixture.values.clear(); vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

it("loads populated v1 records without rewriting them and retains other hosts on mutation and reload", async () => {
  const saved = { ...host("saved"), futureMetadata: { preserved: true } };
  const raw = JSON.stringify([saved]);
  fixture.values.set(HOSTS, raw);
  expect(await loadStoredHosts()).toEqual([saved]);
  expect(fixture.values.get(HOSTS)).toBe(raw);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  await persistPairedHost(host("new"));
  await forgetStoredHost("new");
  vi.resetModules();
  expect(await (await import("./pairingStore")).loadStoredHosts()).toEqual([saved]);
});

it.each([
  "", "not JSON fixture-private-content", "null", "{}",
  JSON.stringify([host("retained"), { hostId: "broken" }]),
  JSON.stringify([{ ...host("retained"), remoteToken: 123 }]),
])("preserves an unreadable host catalog and refuses adding or forgetting (%#)", async raw => {
  fixture.values.set(HOSTS, raw);
  for (const operation of [loadStoredHosts, () => persistPairedHost(host("new")), () => forgetStoredHost("retained")]) {
    await expect(operation()).rejects.toThrow(/saved paired hosts/i);
  }
  expect(fixture.values.get(HOSTS)).toBe(raw);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it.each(["", "broken cursor", "{}", JSON.stringify([cursor("retained"), { sessionId: "broken" }])])(
  "preserves an unreadable cursor cache instead of overwriting it (%#)", async raw => {
    fixture.values.set(CURSORS, raw);
    await expect(loadReadCursors()).rejects.toThrow(/saved read positions/i);
    await expect(saveReadCursor(cursor("new"))).rejects.toThrow(/saved read positions/i);
    expect(fixture.values.get(CURSORS)).toBe(raw);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  },
);

it.each(["unavailable", "rejected"])("does not replace native data through a fallback when secure storage is %s", async failure => {
  const raw = JSON.stringify([host("retained")]);
  fixture.values.set(HOSTS, raw);
  const browser = { getItem: vi.fn(() => "[]"), setItem: vi.fn() };
  vi.stubGlobal("localStorage", browser);
  if (failure === "unavailable") vi.mocked(SecureStore.isAvailableAsync).mockResolvedValue(false);
  else vi.mocked(SecureStore.isAvailableAsync).mockRejectedValue(new Error("fixture-private-content"));
  await expect(loadStoredHosts()).rejects.toThrow(/secure storage/i);
  await expect(persistPairedHost(host("new"))).rejects.toThrow(/secure storage/i);
  await expect(saveReadCursor(cursor("new"))).rejects.toThrow(/secure storage/i);
  expect(fixture.values.get(HOSTS)).toBe(raw);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(browser.getItem).not.toHaveBeenCalled();
  expect(browser.setItem).not.toHaveBeenCalled();
});

it("retries after temporary unavailability without losing the original native catalog", async () => {
  fixture.values.set(HOSTS, JSON.stringify([host("retained")]));
  vi.mocked(SecureStore.isAvailableAsync).mockResolvedValueOnce(false);
  await expect(persistPairedHost(host("new"))).rejects.toThrow();
  expect(await persistPairedHost(host("new"))).toEqual([host("new"), host("retained")]);
});

it("surfaces storage failures without raw diagnostic data, preserves the catalog and permits retry", async () => {
  const raw = JSON.stringify([host("retained")]);
  fixture.values.set(HOSTS, raw);
  vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("fixture-private-content"));
  await expect(persistPairedHost(host("new"))).rejects.toThrow("Could not read saved paired hosts");
  expect(fixture.values.get(HOSTS)).toBe(raw);
  vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("fixture-private-content"));
  const error = await persistPairedHost(host("new")).catch(error => error as Error);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("Could not save paired hosts");
  expect(String(error)).not.toContain("fixture-private-content");
  expect(fixture.values.get(HOSTS)).toBe(raw);
  expect(await persistPairedHost(host("new"))).toEqual([host("new"), host("retained")]);
});

it("serializes overlapping pairings and reads behind a pending native write", async () => {
  const gate = deferred();
  const started = deferred();
  vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
    started.resolve(); await gate.promise; fixture.values.set(key, value);
  });
  const first = persistPairedHost(host("one"));
  await started.promise;
  const second = persistPairedHost(host("two"));
  let readSettled = false;
  const read = loadStoredHosts().then(value => { readSettled = true; return value; });
  try {
    // A slow host-catalog write must not block independent read-position saves.
    await saveReadCursor(cursor("one"));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(readSettled).toBe(false);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(2);
  } finally { gate.resolve(); await Promise.allSettled([first, second, read]); }
  expect(await read).toEqual([host("two"), host("one")]);
  expect(await loadStoredHosts()).toEqual([host("two"), host("one")]);
});

it("does not resurrect a forgotten host when pairing and forgetting overlap", async () => {
  fixture.values.set(HOSTS, JSON.stringify([host("old")]));
  const gate = deferred();
  const started = deferred();
  vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
    started.resolve(); await gate.promise; fixture.values.set(key, value);
  });
  const add = persistPairedHost(host("new"));
  await started.promise;
  const forget = forgetStoredHost("old");
  gate.resolve();
  await Promise.all([add, forget]);
  expect(await loadStoredHosts()).toEqual([host("new")]);
});

it("retains overlapping cursor updates and distinguishes identities containing delimiters", async () => {
  await Promise.all([saveReadCursor(cursor("first")), saveReadCursor(cursor("second"))]);
  expect(await loadReadCursors()).toEqual([cursor("second"), cursor("first")]);
  await saveReadCursor(cursor("a:b", "c"));
  await saveReadCursor(cursor("a", "b:c"));
  expect(readCursorKey("a:b", "c")).not.toBe(readCursorKey("a", "b:c"));
  expect(await loadReadCursors()).toHaveLength(4);
});

it("does not let a failed mutation block subsequent operations or publish unpersisted data", async () => {
  fixture.values.set(HOSTS, JSON.stringify([host("saved")]));
  vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("fixture-private-content"));
  const outcomes = await Promise.allSettled([persistPairedHost(host("failed")), persistPairedHost(host("next"))]);
  expect(outcomes.map(value => value.status)).toEqual(["rejected", "fulfilled"]);
  expect(await loadStoredHosts()).toEqual([host("next"), host("saved")]);
});

it("uses durable web storage without invoking native storage", async () => {
  fixture.os = "web";
  const values = new Map<string, string>([[HOSTS, JSON.stringify([host("browser")])]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  expect(await persistPairedHost(host("new"))).toEqual([host("new"), host("browser")]);
  expect(JSON.parse(values.get(HOSTS)!)).toEqual([host("new"), host("browser")]);
  expect(SecureStore.isAvailableAsync).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it("does not report durable pairing success when browser storage is unavailable", async () => {
  fixture.os = "web";
  vi.stubGlobal("localStorage", undefined);
  vi.mocked(SecureStore.isAvailableAsync).mockResolvedValue(false);
  await expect(persistPairedHost(host("new"))).rejects.toThrow(/browser storage/i);
  await expect(loadStoredHosts()).rejects.toThrow(/browser storage/i);
});

it("rejects invalid new records before they can damage readable catalogs", async () => {
  fixture.values.set(HOSTS, JSON.stringify([host("saved")]));
  fixture.values.set(CURSORS, JSON.stringify([cursor("saved")]));
  await expect(persistPairedHost({ ...host("invalid"), displayName: "" })).rejects.toThrow();
  await expect(saveReadCursor({ ...cursor("invalid"), readAtMs: NaN })).rejects.toThrow();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(await loadStoredHosts()).toEqual([host("saved")]);
  expect(await loadReadCursors()).toEqual([cursor("saved")]);
});

it.each([NaN, Infinity, 0, -1, 65536, 1.5])("does not persist an invalid LAN port (%s)", async lanPort => {
  const raw = JSON.stringify([host("saved")]);
  fixture.values.set(HOSTS, raw);
  await expect(persistPairedHost({ ...host("invalid"), lanPort })).rejects.toThrow("Invalid paired host");
  expect(fixture.values.get(HOSTS)).toBe(raw);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
