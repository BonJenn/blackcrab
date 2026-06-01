import { describe, expect, it } from "vitest";

import { openEnvelope, sealEnvelope, toBase64 } from "../crypto/secretbox";
import type { MinimalWebSocket, TimerProvider } from "./lanWebSocketTransport";
import { RelayTransport } from "./relayTransport";
import type { TransportStatus } from "./types";

const KEY_B64 = toBase64(
  Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1)),
);

class FakeWebSocket implements MinimalWebSocket {
  sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    this.closed = true;
    this.onclose?.({ code: 1000, reason: "test-close" });
  }
  open(): void {
    this.onopen?.({});
  }
  deliver(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

const noopTimers: TimerProvider = {
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  now: () => 0,
};

function make() {
  const ws = new FakeWebSocket();
  const transport = new RelayTransport({
    url: "wss://relay.example.com",
    hostId: "host-1",
    deviceId: "dev-1",
    e2eKey: KEY_B64,
    webSocketFactory: () => ws,
    timers: noopTimers,
  });
  return { ws, transport };
}

describe("RelayTransport", () => {
  it("sends a device hello on open and connects on hello_ack", () => {
    const { ws, transport } = make();
    const statuses: TransportStatus[] = [];
    transport.subscribe((s) => statuses.push(s));

    ws.open();
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: "hello",
      role: "device",
      hostId: "host-1",
      deviceId: "dev-1",
    });

    ws.deliver({ type: "hello_ack" });
    expect(statuses.at(-1)?.state).toBe("connected");
    transport.close();
  });

  it("surfaces decrypted events from data frames", () => {
    const { ws, transport } = make();
    const events: string[] = [];
    transport.subscribeEvents((e) => events.push(e.type));

    ws.open();
    ws.deliver({ type: "hello_ack" });

    const payload = sealEnvelope(KEY_B64, {
      type: "sessions",
      hostId: "host-1",
      sessions: [],
    } as never);
    ws.deliver({ type: "data", payload });

    expect(events).toContain("sessions");
    transport.close();
  });

  it("seals outbound actions into data frames", () => {
    const { ws, transport } = make();
    ws.open();
    ws.deliver({ type: "hello_ack" });

    const ok = transport.sendAction({
      type: "send_message",
      hostId: "host-1",
      sessionId: "s1",
      body: "hi",
    });
    expect(ok).toBe(true);

    const frame = JSON.parse(ws.sent.at(-1)!);
    expect(frame.type).toBe("data");
    const opened = openEnvelope(KEY_B64, frame.payload);
    expect(opened?.msg).toEqual({
      type: "send_message",
      hostId: "host-1",
      sessionId: "s1",
      body: "hi",
    });
    transport.close();
  });

  it("drops actions and reports false before connecting", () => {
    const { ws, transport } = make();
    ws.open(); // hello sent, not yet acked
    const sentBefore = ws.sent.length;
    const ok = transport.sendAction({
      type: "stop_session",
      hostId: "host-1",
      sessionId: "s1",
    });
    expect(ok).toBe(false);
    expect(ws.sent.length).toBe(sentBefore);
    transport.close();
  });

  it("stops on hello_error", () => {
    const { ws, transport } = make();
    const rejects: string[] = [];
    const ws2 = new FakeWebSocket();
    const t2 = new RelayTransport({
      url: "wss://relay.example.com",
      hostId: "host-1",
      deviceId: "dev-1",
      e2eKey: KEY_B64,
      webSocketFactory: () => ws2,
      timers: noopTimers,
      onFatalReject: (r) => rejects.push(r),
    });
    ws2.open();
    ws2.deliver({ type: "hello_error", reason: "token rejected" });
    expect(rejects).toContain("token rejected");
    expect(t2.status().state).not.toBe("connected");
    transport.close();
    t2.close();
  });
});
