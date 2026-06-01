import { describe, expect, it } from "vitest";
import { parseEnvelope } from "@blackcrab/remote-protocol";

import type { StoredPairedHost } from "../pairingStore";
import type { MinimalWebSocket, TimerProvider } from "./lanWebSocketTransport";
import {
  canReconnect,
  canUseRelay,
  connectStoredHost,
  connectViaRelay,
  firstReconnectableHost,
} from "./reconnect";

const KEY_B64 = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA="; // 32 bytes 1..32

function host(overrides: Partial<StoredPairedHost> = {}): StoredPairedHost {
  return {
    hostId: "host-1",
    displayName: "Studio Mac",
    platform: "macos",
    appVersion: "0.2.0",
    lastSeenAt: "2026-05-31T16:00:00.000Z",
    online: false,
    pairedAt: "2026-05-31T16:00:00.000Z",
    pairingSource: "desktop_payload",
    remoteToken: "TOK123",
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
  close(): void {}
  open(): void {
    this.onopen?.({});
  }
}

const noopTimers: TimerProvider = {
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  now: () => 0,
};

describe("reconnect", () => {
  it("treats hosts with a token and LAN endpoint as reconnectable", () => {
    expect(canReconnect(host())).toBe(true);
    expect(canReconnect(host({ remoteToken: undefined }))).toBe(false);
    expect(canReconnect(host({ lanHost: undefined }))).toBe(false);
    expect(canReconnect(host({ lanPort: undefined }))).toBe(false);
  });

  it("picks the first reconnectable host", () => {
    const manual = host({
      hostId: "manual",
      remoteToken: undefined,
      lanHost: undefined,
      lanPort: undefined,
      pairingSource: "manual_code",
    });
    expect(firstReconnectableHost([manual])).toBeUndefined();
    const lan = host({ hostId: "lan" });
    expect(firstReconnectableHost([manual, lan])?.hostId).toBe("lan");
  });

  it("returns null for a host that cannot reconnect", () => {
    const transport = connectStoredHost(host({ remoteToken: undefined }));
    expect(transport).toBeNull();
  });

  it("opens a token-authenticated transport for a reconnectable host", () => {
    const ws = new FakeWebSocket();
    const transport = connectStoredHost(host(), {
      webSocketFactory: () => ws,
      timers: noopTimers,
    });
    expect(transport).not.toBeNull();
    ws.open();
    const envelope = parseEnvelope(ws.sent[0]);
    expect(envelope?.msg).toEqual({ type: "auth", remoteToken: "TOK123" });
    transport?.close();
  });

  it("treats hosts with relay url, key, and device id as relay-capable", () => {
    const relayHost = host({
      relayUrl: "wss://relay.example.com",
      e2eKey: KEY_B64,
      deviceId: "dev-1",
    });
    expect(canUseRelay(relayHost)).toBe(true);
    expect(canUseRelay(host())).toBe(false); // no relay fields
    expect(canUseRelay(host({ relayUrl: "wss://r", e2eKey: KEY_B64 }))).toBe(
      false,
    ); // missing deviceId
  });

  it("opens a relay transport that sends a device hello", () => {
    const ws = new FakeWebSocket();
    const transport = connectViaRelay(
      host({
        relayUrl: "wss://relay.example.com",
        e2eKey: KEY_B64,
        deviceId: "dev-1",
      }),
      { webSocketFactory: () => ws, timers: noopTimers },
    );
    expect(transport).not.toBeNull();
    ws.open();
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: "hello",
      role: "device",
      hostId: "host-1",
      deviceId: "dev-1",
    });
    transport?.close();
  });

  it("returns null from connectViaRelay without relay essentials", () => {
    expect(connectViaRelay(host())).toBeNull();
  });
});
