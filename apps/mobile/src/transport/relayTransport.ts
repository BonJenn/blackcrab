/**
 * Relay-backed transport: reaches a paired desktop **off-LAN** through the
 * encrypted relay. It implements the same `Transport` interface as the LAN
 * transport, so the app uses either interchangeably.
 *
 * Framing: an outer cleartext relay frame (`hello` / `data`) wraps an inner
 * NaCl secretbox sealed `RemoteEnvelope`. The relay routes by `hostId` +
 * `deviceId` and never sees plaintext; only the desktop, holding the shared
 * `e2eKey`, can open the payload (and vice versa).
 */

import {
  isRemoteWireMessage,
  REMOTE_PROTOCOL_VERSION,
  type HostId,
  type RemoteAction,
  type RemoteEvent,
  type RemoteWireMessage,
} from "@blackcrab/remote-protocol";

import {
  open as openSealed,
  seal as sealRaw,
  type SealedFrame,
} from "../crypto/secretbox";
import type { MinimalWebSocket, TimerProvider } from "./lanWebSocketTransport";
import type {
  Transport,
  TransportEventListener,
  TransportListener,
  TransportStatus,
} from "./types";

export interface RelayTransportConfig {
  /** Relay WebSocket URL, e.g. `wss://relay.example.com`. */
  url: string;
  hostId: HostId;
  /** This device's id (from pairing), used to address it in the room. */
  deviceId: string;
  /** base64 32-byte shared key for sealing/opening relay payloads. */
  e2eKey: string;
  /**
   * Optional per-device relay auth token, minted by the host at pairing. Sent
   * in the hello frame when present. The relay does not yet require or validate
   * it; this lays groundwork for a future device-auth gate.
   */
  deviceToken?: string;
  /** Fired when the relay refuses the connection. Transport stops. */
  onFatalReject?: (reason: string) => void;
  webSocketFactory?: (url: string) => MinimalWebSocket;
  timers?: TimerProvider;
}

const DEFAULT_TIMERS: TimerProvider = {
  setTimeout: (h, ms) => globalThis.setTimeout(h, ms),
  clearTimeout: (id) =>
    globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
  setInterval: (h, ms) => globalThis.setInterval(h, ms),
  clearInterval: (id) =>
    globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
  now: () => Date.now(),
};

const DEFAULT_WS_FACTORY = (url: string): MinimalWebSocket =>
  new WebSocket(url) as unknown as MinimalWebSocket;

const HEARTBEAT_INTERVAL_MS = 15_000;
/** How long to wait for a pong before treating the socket as silently dead. */
const PONG_TIMEOUT_MS = 5_000;
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 5_000, 15_000, 30_000];

const RELAY_EVENT_TYPES = new Set([
  "sessions",
  "transcript_tail",
  "approval_requested",
  "approval_resolved",
  "read_cursor",
  "project_dirs",
  "session_started",
  "action_failed",
  "assistant_streaming",
]);

export class RelayTransport implements Transport {
  private readonly config: RelayTransportConfig;
  private readonly timers: TimerProvider;
  private readonly wsFactory: (url: string) => MinimalWebSocket;
  private readonly listeners = new Set<TransportListener>();
  private readonly eventListeners = new Set<TransportEventListener>();
  private ws: MinimalWebSocket | null = null;
  private statusValue: TransportStatus;
  private retryIndex = 0;
  private reconnectHandle: unknown = null;
  private heartbeatHandle: unknown = null;
  private pongTimeoutHandle: unknown = null;
  private pendingPingSeq: number | null = null;
  private nextPingSeq = 1;
  private stopped = false;
  /**
   * Replay protection. `outSeq` is a monotonic counter stamped on every sealed
   * outbound envelope (starts at 1, increments per message). `lastSeq` is the
   * highest inbound seq accepted on the current connection; a frame whose seq
   * is present and `<= lastSeq` is a replay/reorder and is dropped. Both reset
   * to 0 on each (re)connect so a fresh socket starts clean. An absent inbound
   * seq (older peer) is accepted for backward compatibility.
   */
  private outSeq = 0;
  private lastSeq = 0;

  constructor(config: RelayTransportConfig) {
    this.config = config;
    this.timers = config.timers ?? DEFAULT_TIMERS;
    this.wsFactory = config.webSocketFactory ?? DEFAULT_WS_FACTORY;
    this.statusValue = {
      state: "disconnected",
      hostId: config.hostId,
      sinceMs: this.timers.now(),
    };
    this.connect();
  }

  status(): TransportStatus {
    return this.statusValue;
  }

  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    listener(this.statusValue);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeEvents(listener: TransportEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  send(msg: RemoteWireMessage): void {
    this.sealAndSend(msg);
  }

  sendAction(action: RemoteAction): boolean {
    return this.sealAndSend(action);
  }

  /**
   * The network changed. The relay reaches the host on or off LAN, so there is
   * no better path to switch to; a roam can leave the socket silently stale, so
   * force an immediate reconnect rather than waiting for the next heartbeat.
   */
  notifyNetworkChanged(): void {
    if (this.stopped || !this.ws) return;
    const ws = this.ws;
    this.ws = null;
    this.clearTimers();
    try {
      ws.close();
    } catch {
      /* noop */
    }
    this.transition({ state: "reconnecting", detail: "network changed" });
    this.scheduleReconnect();
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    this.transition({ state: "disconnected" });
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }

  private sealAndSend(msg: RemoteWireMessage): boolean {
    if (this.statusValue.state !== "connected" || !this.ws) return false;
    // Stamp a monotonic per-connection sequence so the host drops replayed or
    // reordered frames. The envelope mirrors the desktop shape: { v, seq, msg }.
    this.outSeq += 1;
    const envelope = JSON.stringify({
      v: REMOTE_PROTOCOL_VERSION,
      seq: this.outSeq,
      msg,
    });
    const payload = sealRaw(this.config.e2eKey, envelope);
    if (!payload) return false;
    try {
      this.ws.send(JSON.stringify({ type: "data", payload }));
      return true;
    } catch {
      return false;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    // A fresh socket starts a clean replay window in both directions.
    this.outSeq = 0;
    this.lastSeq = 0;
    this.transition({ state: "connecting" });

    let ws: MinimalWebSocket;
    try {
      ws = this.wsFactory(this.config.url);
    } catch (e) {
      this.transition({ state: "error", detail: String(e) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.stopped || this.ws !== ws) return;
      // Cleartext relay hello — routing only, no secrets. The optional
      // deviceToken is forwarded when present; the relay ignores it for now.
      ws.send(
        JSON.stringify({
          type: "hello",
          role: "device",
          hostId: this.config.hostId,
          deviceId: this.config.deviceId,
          ...(this.config.deviceToken
            ? { deviceToken: this.config.deviceToken }
            : {}),
        }),
      );
    };
    ws.onmessage = (event) => {
      if (this.stopped || this.ws !== ws) return;
      this.handleIncoming(event.data);
    };
    ws.onerror = () => {
      if (this.stopped || this.ws !== ws) return;
      this.transition({ state: "error", detail: "socket error" });
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (this.stopped) return;
      const detail =
        event && typeof event.reason === "string" && event.reason.length > 0
          ? event.reason
          : "disconnected";
      this.transition({ state: "reconnecting", detail });
      this.scheduleReconnect();
    };
  }

  private handleIncoming(text: string): void {
    let frame: { type?: string; payload?: SealedFrame; reason?: string };
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    switch (frame.type) {
      case "hello_ack":
        this.onAuthenticated();
        return;
      case "hello_error":
        this.onFatal(frame.reason ?? "relay rejected connection");
        return;
      case "data": {
        if (!frame.payload) return;
        const msg = this.openWithReplayCheck(frame.payload);
        if (!msg) return;
        if (msg.type === "ping") {
          // Answer the host's keepalive over the same sealed channel.
          this.send({ type: "pong", seq: msg.seq });
          return;
        }
        if (msg.type === "pong") {
          // Matching pong — socket is alive; cancel the death timer.
          if (this.pendingPingSeq !== null && msg.seq === this.pendingPingSeq) {
            this.pendingPingSeq = null;
            this.clearPongTimeout();
          }
          return;
        }
        if (RELAY_EVENT_TYPES.has(msg.type)) {
          this.emitEvent(msg as RemoteEvent);
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Open a sealed relay payload and enforce the inbound replay window. Returns
   * the wire message, or null if the frame can't be opened/parsed or is a
   * replay/reorder. An envelope with an absent `seq` (older peer) is accepted.
   */
  private openWithReplayCheck(
    payload: SealedFrame,
  ): RemoteWireMessage | null {
    const text = openSealed(this.config.e2eKey, payload);
    if (!text) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { v?: unknown }).v !== REMOTE_PROTOCOL_VERSION
    ) {
      return null;
    }
    const rec = parsed as { seq?: unknown; msg?: unknown };
    const seq = typeof rec.seq === "number" ? rec.seq : null;
    if (seq !== null) {
      if (seq <= this.lastSeq) return null; // replay / reorder — drop
      this.lastSeq = seq;
    }
    return isRemoteWireMessage(rec.msg) ? rec.msg : null;
  }

  private onAuthenticated(): void {
    this.retryIndex = 0;
    this.transition({ state: "connected", hostId: this.config.hostId });
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatHandle = this.timers.setInterval(() => {
      if (this.statusValue.state !== "connected" || !this.ws) return;
      // Don't pile up another timer while a ping is still unanswered; the
      // outstanding pong-timeout will fire and force a reconnect.
      if (this.pendingPingSeq !== null) return;
      const seq = this.nextPingSeq++;
      if (!this.sealAndSend({ type: "ping", seq })) return;
      // Arm the dead-socket timer; cleared when the matching pong arrives.
      this.pendingPingSeq = seq;
      this.pongTimeoutHandle = this.timers.setTimeout(() => {
        this.onPongTimeout();
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private onPongTimeout(): void {
    this.pongTimeoutHandle = null;
    this.pendingPingSeq = null;
    if (this.stopped) return;
    // No pong came back: the socket is silently dead. Drop it and reconnect
    // through the normal backoff path.
    const ws = this.ws;
    this.ws = null;
    this.clearTimers();
    if (ws) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
    this.transition({ state: "reconnecting", detail: "heartbeat timeout" });
    this.scheduleReconnect();
  }

  private clearPongTimeout(): void {
    if (this.pongTimeoutHandle !== null) {
      this.timers.clearTimeout(this.pongTimeoutHandle);
      this.pongTimeoutHandle = null;
    }
  }

  private onFatal(detail: string): void {
    this.transition({ state: "error", detail });
    this.config.onFatalReject?.(detail);
    this.stopped = true;
    this.close();
  }

  private emitEvent(event: RemoteEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay =
      BACKOFF_SCHEDULE_MS[
        Math.min(this.retryIndex, BACKOFF_SCHEDULE_MS.length - 1)
      ];
    this.retryIndex += 1;
    this.reconnectHandle = this.timers.setTimeout(() => {
      this.reconnectHandle = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectHandle !== null) {
      this.timers.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.heartbeatHandle !== null) {
      this.timers.clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    this.clearPongTimeout();
    this.pendingPingSeq = null;
  }

  private transition(next: Partial<TransportStatus>): void {
    const merged: TransportStatus = {
      ...this.statusValue,
      ...next,
      sinceMs: this.timers.now(),
    };
    this.statusValue = merged;
    for (const listener of this.listeners) listener(merged);
  }
}
