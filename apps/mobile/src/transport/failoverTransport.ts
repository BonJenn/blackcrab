/**
 * LAN↔relay failover. Wraps the LAN and relay transports behind one `Transport`
 * so the app stays agnostic. Policy: prefer LAN (lower latency, no relay
 * dependency); if it doesn't connect within a grace window — or fatally fails —
 * switch to the relay, which reaches the desktop on *or* off LAN. Once on the
 * relay we stay there (it works everywhere); its own backoff handles drops.
 */

import type { StoredPairedHost } from "../pairingStore";
import type { MinimalWebSocket, TimerProvider } from "./lanWebSocketTransport";
import {
  canReconnect,
  canUseRelay,
  connectStoredHost,
  connectViaRelay,
} from "./reconnect";
import type {
  Transport,
  TransportEventListener,
  TransportListener,
  TransportStatus,
} from "./types";

const DEFAULT_TIMERS: TimerProvider = {
  setTimeout: (h, ms) => globalThis.setTimeout(h, ms),
  clearTimeout: (id) =>
    globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
  setInterval: (h, ms) => globalThis.setInterval(h, ms),
  clearInterval: (id) =>
    globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
  now: () => Date.now(),
};

/** How long LAN may stay un-connected before we fall back to the relay. */
const LAN_GRACE_MS = 6_000;

type Mode = "lan" | "relay";

export interface FailoverOptions {
  onFatalReject?: (reason: string) => void;
  webSocketFactory?: (url: string) => MinimalWebSocket;
  timers?: TimerProvider;
}

export class FailoverTransport implements Transport {
  private readonly host: StoredPairedHost;
  private readonly options: FailoverOptions;
  private readonly timers: TimerProvider;
  private readonly listeners = new Set<TransportListener>();
  private readonly eventListeners = new Set<TransportEventListener>();
  private inner: Transport | null = null;
  private mode: Mode | null = null;
  private unsubStatus: (() => void) | null = null;
  private unsubEvents: (() => void) | null = null;
  private graceHandle: unknown = null;
  private triedRelay = false;
  private stopped = false;
  private statusValue: TransportStatus;

  constructor(host: StoredPairedHost, options: FailoverOptions = {}) {
    this.host = host;
    this.options = options;
    this.timers = options.timers ?? DEFAULT_TIMERS;
    this.statusValue = {
      state: "disconnected",
      hostId: host.hostId,
      sinceMs: this.timers.now(),
    };
    if (canReconnect(host)) {
      this.start("lan");
    } else if (canUseRelay(host)) {
      this.start("relay");
    }
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

  send(msg: Parameters<Transport["send"]>[0]): void {
    this.inner?.send(msg);
  }

  sendAction(action: Parameters<Transport["sendAction"]>[0]): boolean {
    return this.inner?.sendAction(action) ?? false;
  }

  close(): void {
    this.stopped = true;
    this.clearGrace();
    this.teardownInner();
    this.transition({ state: "disconnected" });
  }

  private start(mode: Mode): void {
    if (this.stopped) return;
    const built =
      mode === "lan"
        ? connectStoredHost(this.host, this.innerOptions(mode))
        : connectViaRelay(this.host, this.innerOptions(mode));
    if (!built) {
      // Can't build this mode; fall through to relay if we haven't yet.
      if (mode === "lan" && canUseRelay(this.host)) this.start("relay");
      return;
    }
    this.mode = mode;
    this.inner = built;
    this.unsubStatus = built.subscribe((s) => this.onInnerStatus(s));
    this.unsubEvents = built.subscribeEvents((e) => this.emitEvent(e));
  }

  private innerOptions(mode: Mode): FailoverOptions {
    return {
      webSocketFactory: this.options.webSocketFactory,
      timers: this.options.timers,
      onFatalReject: (reason) => {
        // A fatal LAN reject (e.g. unreachable build) → try the relay once.
        if (mode === "lan" && !this.triedRelay && canUseRelay(this.host)) {
          this.switchToRelay();
        } else {
          this.options.onFatalReject?.(reason);
        }
      },
    };
  }

  private onInnerStatus(status: TransportStatus): void {
    this.transition(status);
    if (status.state === "connected") {
      this.clearGrace();
      return;
    }
    // Not connected over LAN: arm a one-shot fallback to the relay.
    if (
      this.mode === "lan" &&
      !this.triedRelay &&
      this.graceHandle === null &&
      canUseRelay(this.host)
    ) {
      this.graceHandle = this.timers.setTimeout(() => {
        this.graceHandle = null;
        if (this.statusValue.state !== "connected" && this.mode === "lan") {
          this.switchToRelay();
        }
      }, LAN_GRACE_MS);
    }
  }

  private switchToRelay(): void {
    if (this.stopped || this.triedRelay) return;
    this.triedRelay = true;
    this.clearGrace();
    this.teardownInner();
    this.start("relay");
  }

  private teardownInner(): void {
    this.unsubStatus?.();
    this.unsubEvents?.();
    this.unsubStatus = null;
    this.unsubEvents = null;
    this.inner?.close();
    this.inner = null;
  }

  private clearGrace(): void {
    if (this.graceHandle !== null) {
      this.timers.clearTimeout(this.graceHandle);
      this.graceHandle = null;
    }
  }

  private emitEvent(event: Parameters<TransportEventListener>[0]): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private transition(next: Partial<TransportStatus>): void {
    this.statusValue = {
      ...this.statusValue,
      ...next,
      hostId: this.host.hostId,
      sinceMs: this.timers.now(),
    };
    for (const listener of this.listeners) listener(this.statusValue);
  }
}

/**
 * Build a failover transport for a stored host, or `null` if the host can use
 * neither LAN nor relay (e.g. a manual-code pairing).
 */
export function connectWithFailover(
  host: StoredPairedHost,
  options: FailoverOptions = {},
): FailoverTransport | null {
  if (!canReconnect(host) && !canUseRelay(host)) return null;
  return new FailoverTransport(host, options);
}
