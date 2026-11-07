import { isRemoteEvent, type RemoteProviderInfo } from "@blackcrab/remote-protocol";
import type { Transport } from "../transport/types";

export type ProvidersState = { hostId: string | null; connected: boolean; loading: boolean; providers: RemoteProviderInfo[] | null; error: string | null };
/** Read-only host discovery. Results never survive a connection generation. */
export class MobileProvidersClient {
  private value: ProvidersState = { hostId: null, connected: false, loading: false, providers: null, error: null };
  private listeners = new Set<() => void>();
  private unlisten: Array<() => void> = [];
  private transport: Transport | null = null;
  private generation = 0;
  private pending: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  constructor(private id: () => string, private timeoutMs = 10000) {}
  state = () => this.value;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private update(patch: Partial<ProvidersState>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(callback => callback()); }
  private retire() { if (this.pending) clearTimeout(this.pending.timer); this.pending = null; }
  bind(transport: Transport | null, hostId: string | null) {
    this.unlisten.splice(0).forEach(off => off()); this.retire();
    const generation = ++this.generation;
    this.transport = transport;
    this.update({ hostId, connected: false, loading: false, providers: null, error: null });
    if (!transport || !hostId) return;
    const status = () => {
      if (generation !== this.generation) return;
      const value = transport.status();
      const connected = value.state === "connected" && value.hostId === hostId;
      if (connected === this.value.connected) return;
      this.retire(); this.update({ connected, loading: false, providers: null, error: null });
      if (connected) this.refresh();
    };
    this.unlisten.push(transport.subscribe(status), transport.subscribeEvents(event => {
      if (generation !== this.generation || !isRemoteEvent(event) || event.type !== "providers_result" ||
        !this.value.connected || event.hostId !== hostId || event.requestId !== this.pending?.id) return;
      // Read status at delivery too: a late event must not survive an unannounced disconnect.
      if (transport.status().state !== "connected" || transport.status().hostId !== hostId) { status(); return; }
      this.retire(); this.update({ loading: false, providers: event.ok ? event.providers : null, error: event.error });
    }));
    status();
  }
  refresh = () => {
    const transport = this.transport, hostId = this.value.hostId;
    if (!transport || !hostId || this.value.loading) return;
    if (transport.status().state !== "connected" || transport.status().hostId !== hostId) {
      this.retire(); this.update({ connected: false, loading: false, providers: null, error: "Connect to this host to discover its providers." }); return;
    }
    const id = this.id();
    const timer = setTimeout(() => {
      if (this.pending?.id !== id) return;
      this.pending = null; this.update({ loading: false, providers: null, error: "Provider discovery is unavailable. Update the host or retry after checking its connection." });
    }, this.timeoutMs);
    this.pending = { id, timer }; this.update({ loading: true, providers: null, error: null });
    try {
      if (transport.sendAction({ type: "providers_request", hostId, requestId: id })) return;
    } catch { /* Surface transport failure without exposing diagnostics. */ }
    this.retire(); this.update({ loading: false, error: "Provider discovery could not be requested. Reconnect and retry." });
  };
  dispose() { this.bind(null, null); this.listeners.clear(); }
}
