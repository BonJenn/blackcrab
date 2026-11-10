import { describe, expect, it } from "vitest";
import { parseEnvelope, type RemoteWireMessage } from "@blackcrab/remote-protocol";
import { openEnvelope, seal, toBase64 } from "../crypto/secretbox";
import { MobileQueueClient } from "../queue/client";
import { MobileProvidersClient } from "../providers/client";
import { LanWebSocketTransport, type MinimalWebSocket, type TimerProvider } from "./lanWebSocketTransport";
import { RelayTransport } from "./relayTransport";

class WireSocket implements MinimalWebSocket {
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  send(value: string) { this.sent.push(value); }
  close() { this.onclose?.({ code: 1000, reason: "test complete" }); }
  deliver(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const timers: TimerProvider = {setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, now: () => 0};
const key = toBase64(new Uint8Array(32).fill(7));
function fixture(mode: "lan" | "relay") {
  const ws = new WireSocket();
  const transport = mode === "lan"
    ? new LanWebSocketTransport({url: "ws://127.0.0.1:1", hostId: "host", remoteToken: "fixture-only", deviceName: "test", webSocketFactory: () => ws, timers})
    : new RelayTransport({url: "wss://relay.invalid", hostId: "host", deviceId: "fixture", e2eKey: key, webSocketFactory: () => ws, timers});
  ws.onopen?.({});
  ws.deliver(mode === "lan" ? {v: 1, msg: {type: "auth_response", status: "accepted", hostId: "host"}} : {type: "hello_ack"});
  expect(transport.status().state).toBe("connected");
  return {transport, deliver(msg: unknown) {
    ws.deliver(mode === "lan" ? {v: 1, msg} : {type: "data", payload: seal(key, JSON.stringify({v: 1, msg}))});
  }, last(): RemoteWireMessage {
    const raw = ws.sent.at(-1)!;
    const envelope = mode === "lan" ? parseEnvelope(raw) : openEnvelope(key, JSON.parse(raw).payload);
    if (!envelope) throw Error("Expected an actual serialized workflow request");
    return envelope.msg;
  }};
}
for (const mode of ["lan", "relay"] as const) describe(`${mode} serialized workflow events`, () => {
  it("loads queue state, applies live snapshots and confirms persisted enqueue recovery", async () => {
    const f = fixture(mode), disk = new Map<string, string>();
    let sequence = 0;
    const client = new MobileQueueClient({read: async k => disk.get(k) ?? null, write: async (k, v) => { disk.set(k, v); }, remove: async k => { disk.delete(k); }}, () => `queue-${++sequence}`);
    try {
      client.bind(f.transport, "host"); await client.open("host", "session");
      const get = f.last(); if (get.type !== "queue_request") throw Error("Missing queue request");
      const queue = {threadId: "thread", revision: 1, paused: true, items: []};
      f.deliver({type: "queue_result", hostId: "host", sessionId: "session", requestId: get.requestId, ok: true, error: null, queue, receipt: null});
      expect(client.state("host", "session").support).toBe("available");
      f.deliver({type: "queue_snapshot", hostId: "host", sessionId: "session", queue: {...queue, revision: 2}});
      expect(client.state("host", "session").queue?.revision).toBe(2);
      expect(await client.enqueue("host", "session", "held fixture message")).toBe(true);
      expect(disk.size).toBe(1);
      const enqueue = f.last(); if (enqueue.type !== "queue_request" || enqueue.operation.type !== "enqueue") throw Error("Missing enqueue request");
      f.deliver({type: "queue_result", hostId: "host", sessionId: "session", requestId: enqueue.requestId, ok: true, error: null, queue: {...queue, revision: 3}, receipt: {commandId: enqueue.operation.commandId, threadId: "thread", turnId: "turn", status: "held", createdAtMs: 1, updatedAtMs: 1, detail: null}});
      await expect.poll(() => client.state("host", "session").pending).toBeNull();
      expect(disk.size).toBe(0);
    } finally { client.dispose(); f.transport.close(); }
  });
  it("delivers validated provider discovery while ignoring malformed result payloads", () => {
    const f = fixture(mode), client = new MobileProvidersClient(() => "providers-1");
    try {
      client.bind(f.transport, "host");
      const request = f.last(); if (request.type !== "providers_request") throw Error("Missing provider request");
      f.deliver({type: "providers_result", hostId: "host", requestId: request.requestId, ok: true, error: null, providers: "invalid"});
      expect(client.state().loading).toBe(true);
      f.deliver({type: "providers_result", hostId: "host", requestId: request.requestId, ok: true, error: null, providers: []});
      expect(client.state().providers).toEqual([]);
      expect(client.state().loading).toBe(false);
    } finally { client.dispose(); f.transport.close(); }
  });
});
