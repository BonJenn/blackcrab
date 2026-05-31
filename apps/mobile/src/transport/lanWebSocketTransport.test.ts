import { describe, expect, it } from "vitest";
import {
  parseEnvelope,
  REMOTE_PROTOCOL_VERSION,
} from "@blackcrab/remote-protocol";

import {
  LanWebSocketTransport,
  type MinimalWebSocket,
  type TimerProvider,
} from "./lanWebSocketTransport";
import type { TransportStatus } from "./types";

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

  close(_code?: number, _reason?: string): void {
    this.closed = true;
    this.onclose?.({ code: 1000, reason: "test-close" });
  }

  openConnection(): void {
    this.onopen?.({});
  }

  deliver(text: string): void {
    this.onmessage?.({ data: text });
  }
}

function fakeTimers(): TimerProvider & {
  pendingIntervals: number;
  pendingTimeouts: number;
} {
  let intervalId = 0;
  let timeoutId = 0;
  const intervals = new Set<number>();
  const timeouts = new Set<number>();
  return {
    pendingIntervals: 0,
    pendingTimeouts: 0,
    setTimeout: (_h) => {
      timeoutId += 1;
      timeouts.add(timeoutId);
      return timeoutId;
    },
    clearTimeout: (id) => {
      timeouts.delete(id as number);
    },
    setInterval: (_h) => {
      intervalId += 1;
      intervals.add(intervalId);
      return intervalId;
    },
    clearInterval: (id) => {
      intervals.delete(id as number);
    },
    now: () => 1000,
    get pendingIntervals_(): number {
      return intervals.size;
    },
    get pendingTimeouts_(): number {
      return timeouts.size;
    },
  } as TimerProvider & { pendingIntervals: number; pendingTimeouts: number };
}

function lastEnvelope(ws: FakeWebSocket) {
  const last = ws.sent[ws.sent.length - 1];
  expect(last).toBeDefined();
  return parseEnvelope(last);
}

describe("LanWebSocketTransport", () => {
  it("sends pairing_request on open and surfaces connected on acceptance", () => {
    const ws = new FakeWebSocket();
    const statuses: TransportStatus[] = [];
    let pairedWith: { remoteToken: string; hostId: string } | null = null;
    const transport = new LanWebSocketTransport({
      url: "ws://desktop.local:8124",
      pairingCode: "ABCDEFGH",
      deviceName: "Phone",
      webSocketFactory: () => ws,
      timers: fakeTimers(),
      onPaired: (info) => {
        pairedWith = info;
      },
    });
    transport.subscribe((s) => statuses.push(s));

    ws.openConnection();

    const envelope = parseEnvelope(ws.sent[0]);
    expect(envelope?.v).toBe(REMOTE_PROTOCOL_VERSION);
    expect(envelope?.msg).toMatchObject({
      type: "pairing_request",
      code: "ABCDEFGH",
      deviceName: "Phone",
    });

    ws.deliver(
      JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        msg: {
          type: "pairing_response",
          code: "ABCDEFGH",
          status: "accepted",
          hostId: "desktop-studio",
          remoteToken: "TOK123",
        },
      }),
    );

    expect(pairedWith).toEqual({ remoteToken: "TOK123", hostId: "desktop-studio" });
    expect(statuses.at(-1)?.state).toBe("connected");
    expect(statuses.at(-1)?.hostId).toBe("desktop-studio");

    transport.close();
  });

  it("sends auth on open when a remote token is provided", () => {
    const ws = new FakeWebSocket();
    const transport = new LanWebSocketTransport({
      url: "ws://desktop.local:8124",
      remoteToken: "TOKEN_X",
      deviceName: "Phone",
      hostId: "desktop-studio",
      webSocketFactory: () => ws,
      timers: fakeTimers(),
    });
    ws.openConnection();
    expect(parseEnvelope(ws.sent[0])?.msg).toEqual({
      type: "auth",
      remoteToken: "TOKEN_X",
    });
    transport.close();
  });

  it("transitions to error and stops on a rejected pairing_response", () => {
    const ws = new FakeWebSocket();
    const rejects: string[] = [];
    const statuses: TransportStatus[] = [];
    const transport = new LanWebSocketTransport({
      url: "ws://desktop.local:8124",
      pairingCode: "ABCDEFGH",
      deviceName: "Phone",
      webSocketFactory: () => ws,
      timers: fakeTimers(),
      onFatalReject: (r) => rejects.push(r),
    });
    transport.subscribe((s) => statuses.push(s));

    ws.openConnection();
    ws.deliver(
      JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        msg: {
          type: "pairing_response",
          code: "ABCDEFGH",
          status: "rejected",
          rejectedReason: "code unknown",
        },
      }),
    );

    expect(rejects).toContain("code unknown");
    expect(statuses.map((s) => s.state)).toContain("error");
    expect(ws.closed).toBe(true);
    transport.close();
  });

  it("replies to ping with pong containing the same seq", () => {
    const ws = new FakeWebSocket();
    const transport = new LanWebSocketTransport({
      url: "ws://desktop.local:8124",
      pairingCode: "ABCDEFGH",
      deviceName: "Phone",
      webSocketFactory: () => ws,
      timers: fakeTimers(),
    });
    ws.openConnection();
    ws.deliver(
      JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        msg: {
          type: "pairing_response",
          code: "ABCDEFGH",
          status: "accepted",
          hostId: "desktop-studio",
          remoteToken: "TOK",
        },
      }),
    );

    ws.deliver(
      JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        msg: { type: "ping", seq: 42 },
      }),
    );

    const env = lastEnvelope(ws);
    expect(env?.msg).toEqual({ type: "pong", seq: 42 });
    transport.close();
  });

  it("sends an action over the socket once connected", () => {
    const ws = new FakeWebSocket();
    const transport = new LanWebSocketTransport({
      url: "ws://desktop.local:8124",
      pairingCode: "ABCDEFGH",
      deviceName: "Phone",
      webSocketFactory: () => ws,
      timers: fakeTimers(),
    });
    ws.openConnection();
    ws.deliver(
      JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        msg: {
          type: "pairing_response",
          code: "ABCDEFGH",
          status: "accepted",
          hostId: "desktop-studio",
          remoteToken: "TOK",
        },
      }),
    );

    const ok = transport.sendAction({
      type: "send_message",
      hostId: "desktop-studio",
      sessionId: "sess-abc",
      body: "ship it",
    });

    expect(ok).toBe(true);
    expect(lastEnvelope(ws)?.msg).toEqual({
      type: "send_message",
      hostId: "desktop-studio",
      sessionId: "sess-abc",
      body: "ship it",
    });
    transport.close();
  });

  it("drops actions and reports false when not connected", () => {
    const ws = new FakeWebSocket();
    const transport = new LanWebSocketTransport({
      url: "ws://desktop.local:8124",
      pairingCode: "ABCDEFGH",
      deviceName: "Phone",
      webSocketFactory: () => ws,
      timers: fakeTimers(),
    });
    ws.openConnection(); // handshake sent, but not yet accepted -> "connecting"

    const sentBefore = ws.sent.length;
    const ok = transport.sendAction({
      type: "stop_session",
      hostId: "desktop-studio",
      sessionId: "sess-abc",
    });

    expect(ok).toBe(false);
    expect(ws.sent.length).toBe(sentBefore);
    transport.close();
  });

  it("reconnects after the socket closes", () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new LanWebSocketTransport({
      url: "ws://desktop.local:8124",
      pairingCode: "ABCDEFGH",
      deviceName: "Phone",
      webSocketFactory: () => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
      timers: {
        setTimeout: (handler) => {
          // Reconnect immediately to keep tests synchronous.
          handler();
          return 0;
        },
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        now: () => 0,
      },
    });

    sockets[0]!.onclose?.({ code: 1006 });
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    transport.close();
  });
});
