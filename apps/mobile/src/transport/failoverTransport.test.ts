import { describe, expect, it } from "vitest";

import type { StoredPairedHost } from "../pairingStore";
import { toBase64 } from "../crypto/secretbox";
import { connectWithFailover } from "./failoverTransport";
import type { MinimalWebSocket, TimerProvider } from "./lanWebSocketTransport";
import type { TransportStatus } from "./types";

const KEY_B64 = toBase64(
  Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1)),
);

function host(overrides: Partial<StoredPairedHost> = {}): StoredPairedHost {
  return {
    hostId: "host-1",
    displayName: "Studio",
    platform: "macos",
    appVersion: "0.2.0",
    lastSeenAt: "2026-05-31T16:00:00.000Z",
    online: false,
    pairedAt: "2026-05-31T16:00:00.000Z",
    pairingSource: "desktop_payload",
    remoteToken: "TOK",
    e2eKey: KEY_B64,
    deviceId: "dev-1",
    relayUrl: "wss://relay.example.com",
    lanHost: "192.168.1.5",
    lanPort: 8124,
    ...overrides,
  };
}

class FakeWebSocket implements MinimalWebSocket {
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: "closed" });
  }
  open(): void {
    this.onopen?.({});
  }
  deliver(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

/** A timer provider whose single setTimeout callback can be fired on demand. */
function controllableTimers(): TimerProvider & { fire: () => void } {
  let pending: (() => void) | null = null;
  return {
    setTimeout: (h: () => void) => {
      pending = h;
      return 1;
    },
    clearTimeout: () => {
      pending = null;
    },
    setInterval: () => 0,
    clearInterval: () => {},
    now: () => 0,
    fire: () => {
      const h = pending;
      pending = null;
      h?.();
    },
  };
}

describe("FailoverTransport", () => {
  it("stays on LAN when it connects", () => {
    const lan = new FakeWebSocket();
    const relaySockets: FakeWebSocket[] = [];
    const timers = controllableTimers();
    const transport = connectWithFailover(host(), {
      timers,
      webSocketFactory: (url) => {
        if (url.startsWith("wss://")) {
          const ws = new FakeWebSocket();
          relaySockets.push(ws);
          return ws;
        }
        return lan;
      },
    });
    const statuses: TransportStatus[] = [];
    transport!.subscribe((s) => statuses.push(s));

    lan.open();
    // LAN auth handshake; ack it → connected.
    lan.deliver({
      v: 1,
      msg: {
        type: "pairing_response",
        code: "ABCDEFGH",
        status: "accepted",
        hostId: "host-1",
        remoteToken: "TOK",
      },
    });

    // It connected over LAN and never opened a relay socket.
    expect(statuses.at(-1)?.state).toBe("connected");
    timers.fire(); // grace (if any) — must not switch after a clean connect
    expect(relaySockets.length).toBe(0);
    transport!.close();
  });

  it("falls back to the relay when LAN does not connect in time", () => {
    const lan = new FakeWebSocket();
    const relaySockets: FakeWebSocket[] = [];
    const timers = controllableTimers();
    const transport = connectWithFailover(host(), {
      timers,
      webSocketFactory: (url) => {
        if (url.startsWith("wss://")) {
          const ws = new FakeWebSocket();
          relaySockets.push(ws);
          return ws;
        }
        return lan;
      },
    });

    // LAN opens but never acks (simulating off-network / unreachable host),
    // which arms the grace timer. Firing it triggers the relay fallback.
    lan.open();
    timers.fire();

    expect(relaySockets.length).toBe(1);
    // The relay socket performs the device hello on open.
    relaySockets[0]!.open();
    expect(JSON.parse(relaySockets[0]!.sent[0]!)).toEqual({
      type: "hello",
      role: "device",
      hostId: "host-1",
      deviceId: "dev-1",
    });
    transport!.close();
  });

  it("uses the relay directly when there is no LAN endpoint", () => {
    const relaySockets: FakeWebSocket[] = [];
    const timers = controllableTimers();
    const transport = connectWithFailover(
      host({ lanHost: undefined, lanPort: undefined }),
      {
        timers,
        webSocketFactory: (url) => {
          expect(url.startsWith("wss://")).toBe(true);
          const ws = new FakeWebSocket();
          relaySockets.push(ws);
          return ws;
        },
      },
    );
    expect(relaySockets.length).toBe(1);
    transport!.close();
  });

  it("returns null for a host that can use neither LAN nor relay", () => {
    const manual = host({
      remoteToken: undefined,
      lanHost: undefined,
      lanPort: undefined,
      relayUrl: undefined,
      e2eKey: undefined,
      deviceId: undefined,
    });
    expect(connectWithFailover(manual)).toBeNull();
  });
});
