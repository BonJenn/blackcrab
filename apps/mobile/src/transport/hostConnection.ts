import type { StoredPairedHost } from "../pairingStore";
import type { Transport } from "./types";
type State = { hostId: string | null; transport: Transport | null; error: string | null };
type Factory = (host: StoredPairedHost, rejected: (reason: string) => void) => Transport | null;

/** One phone connection owner. Retired failures cannot close its replacement. */
export class MobileHostConnection {
  private value: State = { hostId: null, transport: null, error: null };
  private listeners = new Set<() => void>();
  private serial = 0;
  private generation = 0;
  private disposed = false;
  constructor(private create: Factory) {}
  state = () => this.value;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private emit() { this.listeners.forEach(callback => callback()); }
  private close(transport: Transport | null) { try { transport?.close(); } catch { /* Owner identity is already retired. */ } }
  private fail(message: string) { this.value = { ...this.value, error: message }; this.emit(); return false; }
  connect(host: StoredPairedHost, force = false): boolean {
    if (this.disposed) return false;
    if (!force && this.value.hostId === host.hostId && this.value.transport) return true;
    const generation = ++this.serial;
    let rejected = false;
    let next: Transport | null = null;
    try {
      next = this.create(host, () => {
        rejected = true;
        if (!this.disposed && this.generation === generation) this.disconnect("The selected host rejected this connection. Re-pair if its device access was revoked.");
      });
      if (next?.status().hostId && next.status().hostId !== host.hostId) rejected = true;
    } catch { this.close(next); return this.fail("Could not open the selected host connection. Your previous connection is retained."); }
    if (!next || rejected) { this.close(next); return this.fail("This host could not connect. Check its address and pairing, or pair it again. Your previous connection is retained."); }
    this.replace(host.hostId, next, generation);
    return true;
  }
  adopt(hostId: string, transport: Transport) {
    if (this.disposed) { this.close(transport); return; }
    if (transport.status().hostId && transport.status().hostId !== hostId) {
      if (transport !== this.value.transport) this.close(transport);
      this.fail("The paired connection belongs to a different host. Your previous connection is retained."); return;
    }
    if (transport === this.value.transport && hostId === this.value.hostId) return;
    this.replace(hostId, transport, ++this.serial);
  }
  private replace(hostId: string, transport: Transport, generation: number) {
    const previous = this.value.transport;
    this.generation = generation;
    this.value = { hostId, transport, error: null };
    this.emit();
    if (previous !== transport) this.close(previous);
  }
  disconnect(error: string | null = null) {
    const previous = this.value.transport;
    this.generation = ++this.serial;
    this.value = { hostId: null, transport: null, error };
    this.emit(); this.close(previous);
  }
  forget(hostId: string) { if (this.value.hostId === hostId) this.disconnect(); }
  dispose() { if (this.disposed) return; this.disposed = true; this.disconnect(); this.listeners.clear(); }
}
