/**
 * Browser/React-Native WebSocket-backed transport for a single paired host.
 *
 * On open it performs one of two handshakes:
 *   - `pairing_request`: when only a desktop-minted code is known. On accept,
 *     captures the issued remote token via `onPaired`.
 *   - `auth`: when a previously issued remote token is already known.
 *
 * After the handshake the transport keeps a ping/pong heartbeat alive and
 * surfaces connection-state transitions to a listener. Reconnects use
 * exponential backoff bounded to 30 seconds.
 */

import {
  parseEnvelope,
  serializeEnvelope,
  type AuthMessage,
  type AuthResponse,
  type Heartbeat,
  type HostId,
  type PairingRequest,
  type PairingResponse,
  type RemoteAction,
  type RemoteWireMessage,
} from "@blackcrab/remote-protocol";

import type {
  RemoteEvent,
} from "@blackcrab/remote-protocol";

import type {
  Transport,
  TransportEventListener,
  TransportListener,
  TransportStatus,
} from "./types";

export interface LanWebSocketTransportConfig {
  url: string;
  /** Used when bootstrapping a brand-new pairing. */
  pairingCode?: string;
  /** Used to authenticate subsequent connections. */
  remoteToken?: string;
  deviceName: string;
  hostId?: HostId;
  /** Fired once when a pairing handshake succeeds. */
  onPaired?: (info: {
    remoteToken: string;
    hostId: HostId;
    e2eKey?: string;
    deviceId?: string;
  }) => void;
  /** Fired when the desktop rejects either handshake. Transport stops. */
  onFatalReject?: (reason: string) => void;
  /** Override the WebSocket implementation for tests. */
  webSocketFactory?: (url: string) => MinimalWebSocket;
  /** Override the timer source for tests. */
  timers?: TimerProvider;
}

export interface MinimalWebSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
}

export interface TimerProvider {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
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
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 5_000, 15_000, 30_000];

export class LanWebSocketTransport implements Transport {
  private readonly config: LanWebSocketTransportConfig;
  private readonly timers: TimerProvider;
  private readonly wsFactory: (url: string) => MinimalWebSocket;
  private readonly listeners = new Set<TransportListener>();
  private readonly eventListeners = new Set<TransportEventListener>();
  private ws: MinimalWebSocket | null = null;
  private statusValue: TransportStatus;
  private retryIndex = 0;
  private reconnectHandle: unknown = null;
  private heartbeatHandle: unknown = null;
  private nextPingSeq = 1;
  private stopped = false;
  private remoteToken: string | undefined;

  constructor(config: LanWebSocketTransportConfig) {
    this.config = config;
    this.timers = config.timers ?? DEFAULT_TIMERS;
    this.wsFactory = config.webSocketFactory ?? DEFAULT_WS_FACTORY;
    this.remoteToken = config.remoteToken;
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
    const ws = this.ws;
    if (!ws) return;
    try {
      ws.send(serializeEnvelope(msg));
    } catch {
      // Drop send failures — the next message or heartbeat will surface the
      // error via onerror/onclose.
    }
  }

  sendAction(action: RemoteAction): boolean {
    // Guard on the authenticated state — the desktop ignores actions on an
    // unauthenticated socket, so dropping early gives the caller honest
    // feedback instead of silently writing into the void.
    if (this.statusValue.state !== "connected" || !this.ws) return false;
    try {
      this.ws.send(serializeEnvelope(action));
      return true;
    } catch {
      return false;
    }
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

  private connect(): void {
    if (this.stopped) return;
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
      this.sendHandshake();
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

  private sendHandshake(): void {
    const ws = this.ws;
    if (!ws) return;

    if (this.remoteToken) {
      const auth: AuthMessage = {
        type: "auth",
        remoteToken: this.remoteToken,
      };
      ws.send(serializeEnvelope(auth));
      return;
    }

    if (this.config.pairingCode) {
      const req: PairingRequest = {
        type: "pairing_request",
        code: this.config.pairingCode,
        deviceName: this.config.deviceName,
        requestedAt: new Date().toISOString(),
      };
      ws.send(serializeEnvelope(req));
      return;
    }

    this.config.onFatalReject?.("no pairing code or remote token available");
    this.close();
  }

  private handleIncoming(text: string): void {
    const envelope = parseEnvelope(text);
    if (!envelope) return;
    const msg = envelope.msg;
    switch (msg.type) {
      case "pairing_response":
        this.handlePairingResponse(msg);
        return;
      case "auth_response":
        this.handleAuthResponse(msg);
        return;
      case "ping":
        this.send({ type: "pong", seq: msg.seq });
        return;
      case "pong":
        return;
      case "connection_status":
        return;
      case "sessions":
      case "transcript_tail":
      case "approval_requested":
      case "approval_resolved":
      case "read_cursor":
      case "project_dirs":
      case "session_started":
      case "action_failed":
        this.emitEvent(msg);
        return;
      default:
        return;
    }
  }

  private emitEvent(event: RemoteEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private handlePairingResponse(msg: PairingResponse): void {
    if (msg.status === "accepted" && msg.remoteToken && msg.hostId) {
      this.remoteToken = msg.remoteToken;
      this.config.onPaired?.({
        remoteToken: msg.remoteToken,
        hostId: msg.hostId,
        e2eKey: msg.e2eKey,
        deviceId: msg.deviceId,
      });
      this.onAuthenticated(msg.hostId);
      return;
    }
    const detail =
      msg.status === "expired"
        ? "pairing code expired"
        : msg.rejectedReason ?? "pairing rejected";
    this.transition({ state: "error", detail });
    this.config.onFatalReject?.(detail);
    this.stopped = true;
    this.close();
  }

  private handleAuthResponse(msg: AuthResponse): void {
    if (msg.status === "accepted" && msg.hostId) {
      this.onAuthenticated(msg.hostId);
      return;
    }
    const detail = msg.rejectedReason ?? "token rejected";
    this.transition({ state: "error", detail });
    this.config.onFatalReject?.(detail);
    this.stopped = true;
    this.close();
  }

  private onAuthenticated(hostId: HostId): void {
    this.retryIndex = 0;
    this.transition({ state: "connected", hostId });
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatHandle = this.timers.setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      const ping: Heartbeat = { type: "ping", seq: this.nextPingSeq++ };
      try {
        ws.send(serializeEnvelope(ping));
      } catch {
        /* noop */
      }
    }, HEARTBEAT_INTERVAL_MS);
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
    if (this.heartbeatHandle !== null) {
      this.timers.clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    if (this.reconnectHandle !== null) {
      this.timers.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
  }

  private transition(next: Partial<TransportStatus>): void {
    const merged: TransportStatus = {
      ...this.statusValue,
      ...next,
      sinceMs: this.timers.now(),
    };
    this.statusValue = merged;
    for (const listener of this.listeners) {
      listener(merged);
    }
  }
}
