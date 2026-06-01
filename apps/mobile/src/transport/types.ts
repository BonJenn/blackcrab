/**
 * Transport interface and connection-state types for the Blackcrab mobile
 * companion. A future relay implementation should slot in by satisfying the
 * `Transport` shape — the LAN WebSocket transport is the first concrete one.
 */

import type {
  ConnectionStatusState,
  HostId,
  RemoteAction,
  RemoteEvent,
  RemoteWireMessage,
} from "@blackcrab/remote-protocol";

export type TransportState = ConnectionStatusState;

/** Listener for host->mobile events (sessions, transcript tail, approvals). */
export type TransportEventListener = (event: RemoteEvent) => void;

export interface TransportStatus {
  state: TransportState;
  hostId?: HostId;
  detail?: string;
  sinceMs: number;
}

export type TransportListener = (status: TransportStatus) => void;

export interface Transport {
  status(): TransportStatus;
  subscribe(listener: TransportListener): () => void;
  /** Subscribe to host->mobile events. Returns an unsubscribe function. */
  subscribeEvents(listener: TransportEventListener): () => void;
  send(msg: RemoteWireMessage): void;
  /**
   * Send an action to the paired host. Only delivered when the connection is
   * authenticated; returns `true` if it was handed to the socket, `false` if
   * dropped because the transport was not connected.
   */
  sendAction(action: RemoteAction): boolean;
  close(): void;
}
