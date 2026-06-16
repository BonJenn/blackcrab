import { describe, expect, it } from "vitest";

import {
  open,
  openEnvelope,
  seal,
  sealEnvelope,
  toBase64,
} from "../crypto/secretbox";
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

  it("sends a sealed ping on the heartbeat and reconnects on pong timeout", () => {
    let intervalCb: (() => void) | null = null;
    let pongCb: (() => void) | null = null;
    const sockets: FakeWebSocket[] = [];
    const transport = new RelayTransport({
      url: "wss://relay.example.com",
      hostId: "host-1",
      deviceId: "dev-1",
      e2eKey: KEY_B64,
      webSocketFactory: () => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
      timers: {
        setTimeout: (h) => {
          // Hold the pong timeout for the test; the reconnect timer fires sync.
          if (pongCb === null) {
            pongCb = h;
            return 5;
          }
          h();
          return 0;
        },
        clearTimeout: () => {
          pongCb = null;
        },
        setInterval: (h) => {
          intervalCb = h;
          return 1;
        },
        clearInterval: () => {
          intervalCb = null;
        },
        now: () => 0,
      },
    });
    const statuses: TransportStatus[] = [];
    transport.subscribe((s) => statuses.push(s));

    sockets[0]!.open();
    sockets[0]!.deliver({ type: "hello_ack" });
    expect(statuses.at(-1)?.state).toBe("connected");

    // Heartbeat fires → a sealed ping goes out and the pong-timeout is armed.
    intervalCb!();
    const frame = JSON.parse(sockets[0]!.sent.at(-1)!);
    expect(frame.type).toBe("data");
    expect(openEnvelope(KEY_B64, frame.payload)?.msg).toMatchObject({
      type: "ping",
    });

    // No pong → firing the timeout tears down and reconnects.
    pongCb!();
    expect(statuses.map((s) => s.state)).toContain("reconnecting");
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    transport.close();
  });

  it("clears the pong timeout when a matching sealed pong arrives", () => {
    let intervalCb: (() => void) | null = null;
    let pongCb: (() => void) | null = null;
    let cleared = false;
    const ws = new FakeWebSocket();
    const transport = new RelayTransport({
      url: "wss://relay.example.com",
      hostId: "host-1",
      deviceId: "dev-1",
      e2eKey: KEY_B64,
      webSocketFactory: () => ws,
      timers: {
        setTimeout: (h) => {
          pongCb = h;
          return 5;
        },
        clearTimeout: () => {
          cleared = true;
          pongCb = null;
        },
        setInterval: (h) => {
          intervalCb = h;
          return 1;
        },
        clearInterval: () => {},
        now: () => 0,
      },
    });
    ws.open();
    ws.deliver({ type: "hello_ack" });

    intervalCb!();
    const ping = openEnvelope(
      KEY_B64,
      JSON.parse(ws.sent.at(-1)!).payload,
    )?.msg as { type: string; seq: number };
    expect(ping.type).toBe("ping");

    // Echo the matching sealed pong back through a data frame.
    const pongPayload = sealEnvelope(KEY_B64, {
      type: "pong",
      seq: ping.seq,
    } as never);
    ws.deliver({ type: "data", payload: pongPayload });
    expect(cleared).toBe(true);
    expect(pongCb).toBeNull();
    transport.close();
  });

  it("answers a sealed ping with a sealed pong", () => {
    const { ws, transport } = make();
    ws.open();
    ws.deliver({ type: "hello_ack" });

    const pingPayload = sealEnvelope(KEY_B64, {
      type: "ping",
      seq: 21,
    } as never);
    ws.deliver({ type: "data", payload: pingPayload });

    const frame = JSON.parse(ws.sent.at(-1)!);
    expect(frame.type).toBe("data");
    expect(openEnvelope(KEY_B64, frame.payload)?.msg).toEqual({
      type: "pong",
      seq: 21,
    });
    transport.close();
  });

  it("stamps a monotonic seq on sealed outbound frames", () => {
    const { ws, transport } = make();
    ws.open();
    ws.deliver({ type: "hello_ack" });

    transport.sendAction({
      type: "stop_session",
      hostId: "host-1",
      sessionId: "s1",
    });
    transport.sendAction({
      type: "stop_session",
      hostId: "host-1",
      sessionId: "s2",
    });

    const seqs = ws.sent
      .map((s) => JSON.parse(s))
      .filter((f) => f.type === "data")
      .map((f) => {
        const opened = open(KEY_B64, f.payload)!;
        return JSON.parse(opened).seq as number;
      });
    expect(seqs).toEqual([1, 2]);
    transport.close();
  });

  it("drops replayed/reordered inbound frames but accepts seqless ones", () => {
    const { ws, transport } = make();
    const events: string[] = [];
    transport.subscribeEvents((e) => events.push(e.type));
    ws.open();
    ws.deliver({ type: "hello_ack" });

    const sealWithSeq = (seq: number | undefined, type: string) => {
      const env: Record<string, unknown> = {
        v: 1,
        msg: { type, hostId: "host-1", sessions: [] },
      };
      if (seq !== undefined) env.seq = seq;
      return seal(KEY_B64, JSON.stringify(env))!;
    };

    // seq=1 accepted.
    ws.deliver({ type: "data", payload: sealWithSeq(1, "sessions") });
    // seq=1 replay dropped; seq=0 reorder dropped.
    ws.deliver({ type: "data", payload: sealWithSeq(1, "project_dirs") });
    ws.deliver({ type: "data", payload: sealWithSeq(0, "project_dirs") });
    // seq=2 accepted.
    ws.deliver({ type: "data", payload: sealWithSeq(2, "transcript_tail") });
    // seqless (older peer) always accepted.
    ws.deliver({ type: "data", payload: sealWithSeq(undefined, "read_cursor") });

    expect(events).toEqual(["sessions", "transcript_tail", "read_cursor"]);
    transport.close();
  });

  it("resets the inbound replay window on reconnect", () => {
    let intervalCb: (() => void) | null = null;
    let pongCb: (() => void) | null = null;
    const sockets: FakeWebSocket[] = [];
    const transport = new RelayTransport({
      url: "wss://relay.example.com",
      hostId: "host-1",
      deviceId: "dev-1",
      e2eKey: KEY_B64,
      webSocketFactory: () => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
      timers: {
        setTimeout: (h) => {
          if (pongCb === null) {
            pongCb = h;
            return 5;
          }
          h();
          return 0;
        },
        clearTimeout: () => {
          pongCb = null;
        },
        setInterval: (h) => {
          intervalCb = h;
          return 1;
        },
        clearInterval: () => {
          intervalCb = null;
        },
        now: () => 0,
      },
    });
    const events: string[] = [];
    transport.subscribeEvents((e) => events.push(e.type));

    const sealSeq = (seq: number) =>
      seal(
        KEY_B64,
        JSON.stringify({ v: 1, seq, msg: { type: "sessions", hostId: "host-1", sessions: [] } }),
      )!;

    sockets[0]!.open();
    sockets[0]!.deliver({ type: "hello_ack" });
    sockets[0]!.deliver({ type: "data", payload: sealSeq(5) });
    expect(events).toEqual(["sessions"]);

    // Force a reconnect via the heartbeat/pong-timeout path.
    intervalCb!();
    pongCb!();
    sockets[1]!.open();
    sockets[1]!.deliver({ type: "hello_ack" });

    // After reconnect, seq=1 must be accepted again (window was reset).
    sockets[1]!.deliver({ type: "data", payload: sealSeq(1) });
    expect(events).toEqual(["sessions", "sessions"]);
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
