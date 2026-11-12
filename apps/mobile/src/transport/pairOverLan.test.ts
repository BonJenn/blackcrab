import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { createDesktopPairingPayload, parseEnvelope, serializeEnvelope, type RemoteWireMessage } from "@blackcrab/remote-protocol";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  isAvailableAsync: async () => true,
  getItemAsync: async (key: string) => storage.get(key) ?? null,
  setItemAsync: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
}));
import * as SecureStore from "expo-secure-store";
import { loadStoredHosts } from "../pairingStore";
import { buildLanUrl, manualPairingTarget, pairOverLan } from "./pairOverLan";
import { LanWebSocketTransport } from "./lanWebSocketTransport";
import { connectStoredHost } from "./reconnect";

const cleanups: Array<() => void | Promise<void>> = [];
beforeEach(() => { storage.clear(); vi.clearAllMocks(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function host(reply: (message: RemoteWireMessage) => RemoteWireMessage | null) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let peerClosed!: () => void;
  const disconnected = new Promise<void>(resolve => { peerClosed = resolve; });
  cleanups.push(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  server.on("connection", socket => {
    socket.once("close", peerClosed);
    socket.on("message", bytes => {
      const envelope = parseEnvelope(bytes.toString());
      if (!envelope) return;
      const response = reply(envelope.msg);
      if (response) socket.send(serializeEnvelope(response));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback listener");
  return { address: `127.0.0.1:${address.port}`, port: address.port, disconnected };
}
const accepted = { type: "pairing_response", code: "ABCDEFGH", status: "accepted", hostId: "actual-desktop", remoteToken: "fixture-token" } as const;

it("pairs manually over the real wire and saves the returned identity only after acceptance", async () => {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let received: RemoteWireMessage | undefined;
  const fixture = await host(message => {
    if (message.type === "auth") {
      expect(message.remoteToken).toBe("fixture-token");
      return { type: "auth_response", status: "accepted", hostId: "actual-desktop" };
    }
    received = message; release!(); return accepted;
  });
  const operation = pairOverLan(manualPairingTarget(fixture.address, "abcd-efgh"), { deviceName: "Fixture phone" });
  expect(storage.size).toBe(0);
  await waiting;
  const paired = await operation;
  cleanups.push(() => paired.transport.close());
  expect(received).toMatchObject({ type: "pairing_request", code: "ABCDEFGH", deviceName: "Fixture phone" });
  expect(paired.host).toMatchObject({ hostId: "actual-desktop", remoteToken: "fixture-token", pairingSource: "manual_code", lanHost: "127.0.0.1", lanPort: fixture.port, online: true });
  expect(paired.host.hostId).not.toContain("abcdefgh");
  expect(await loadStoredHosts()).toEqual([paired.host]);
  expect(paired.transport.status()).toMatchObject({ state: "connected", hostId: "actual-desktop" });
  paired.transport.close();
  await fixture.disconnected;
  const restored = connectStoredHost((await loadStoredHosts())[0]!);
  expect(restored).not.toBeNull();
  cleanups.push(() => restored?.close());
  await vi.waitFor(() => expect(restored?.status()).toMatchObject({ state: "connected", hostId: "actual-desktop" }));
});

it.each([
  { ...accepted, code: "HGFEDCBA" },
  { type: "pairing_response", code: "ABCDEFGH", status: "rejected", rejectedReason: "invalid code" } as const,
])("does not save rejected or unrelated pairing responses", async response => {
  const fixture = await host(() => response);
  await expect(pairOverLan(manualPairingTarget(fixture.address, "ABCDEFGH"), { deviceName: "Fixture phone" })).rejects.toThrow();
  expect(await loadStoredHosts()).toEqual([]);
});

it("rejects a payload whose host identity differs from the actual handshake", async () => {
  const fixture = await host(() => accepted);
  const payload = createDesktopPairingPayload({ hostId: "different-desktop", displayName: "Fixture", platform: "macos", appVersion: "1", code: "ABCDEFGH", expiresAtMs: Date.now() + 60000, lanHost: "127.0.0.1", lanPort: fixture.port });
  await expect(pairOverLan(payload, { deviceName: "Fixture phone" })).rejects.toThrow(/identity/);
  expect(await loadStoredHosts()).toEqual([]);
});

it("closes the accepted connection when durable credential storage fails", async () => {
  const fixture = await host(() => accepted);
  vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(pairOverLan(manualPairingTarget(fixture.address, "ABCDEFGH"), { deviceName: "Fixture phone" })).rejects.toThrow("storage unavailable");
  await fixture.disconnected;
  expect(await loadStoredHosts()).toEqual([]);
});

it("times out without manufacturing a paired host", async () => {
  const fixture = await host(() => null);
  await expect(pairOverLan(manualPairingTarget(fixture.address, "ABCDEFGH"), { deviceName: "Fixture phone", timeoutMs: 100 })).rejects.toThrow("timed out");
  await fixture.disconnected;
  expect(await loadStoredHosts()).toEqual([]);
});

it("refuses a different host on reconnect", async () => {
  const fixture = await host(() => ({ type: "auth_response", status: "accepted", hostId: "other-desktop" }));
  let reject!: (reason: string) => void;
  const rejected = new Promise<string>(resolve => { reject = resolve; });
  const transport = new LanWebSocketTransport({ url: `ws://${fixture.address}`, remoteToken: "fixture-token", hostId: "actual-desktop", deviceName: "Fixture phone", onFatalReject: reject });
  cleanups.push(() => transport.close());
  expect(await rejected).toMatch(/identity/);
  expect(transport.status().state).not.toBe("connected");
});

it("supports IPv6 and explicit default ports without accepting credentials or paths", () => {
  expect(buildLanUrl(manualPairingTarget("[::1]:8124", "ABCDEFGH"))).toBe("ws://[::1]:8124");
  expect(buildLanUrl(manualPairingTarget("ws://desktop.local:80", "ABCDEFGH"))).toBe("ws://desktop.local:80");
  for (const address of ["", "desktop.local", "localhost:0", "localhost:65536", "https://localhost:8124", "ws://user:pass@localhost:8124", "localhost:8124/path", "localhost:8124?token=x", "localhost:8124#x"]) expect(() => manualPairingTarget(address, "ABCDEFGH")).toThrow();
  expect(() => manualPairingTarget("localhost:8124", "bad")).toThrow(/code/);
});
