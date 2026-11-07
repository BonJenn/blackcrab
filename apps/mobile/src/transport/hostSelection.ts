import type { StoredPairedHost } from "../pairingStore";
import { MobileHostConnection } from "./hostConnection";
import { firstConnectableHost, isConnectable } from "./reconnect";
import type { Transport } from "./types";

export interface HostSelectionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

/** A saved null is an intentional disconnect; absence alone uses the legacy default. */
export function parseHostSelection(raw: string | null): string | null | undefined {
  if (raw === null) return undefined;
  const saved = JSON.parse(raw);
  if (saved?.version !== 1 || !(saved.hostId === null || (typeof saved.hostId === "string" && saved.hostId.length > 0))) throw new Error("Invalid saved host selection");
  return saved.hostId;
}

/** Persists connection intent, never agent actions. Connection failures retain intent. */
export class MobileHostSelection {
  private value;
  private listeners = new Set<() => void>();
  private intended: string | null | undefined;
  private revision = 0;
  private writeRevision = 0;
  private writes: Promise<void> = Promise.resolve();
  private disposed = false;
  private unsubscribe: () => void;
  constructor(private owner: MobileHostConnection, private storage: HostSelectionStorage) {
    this.value = { ...owner.state(), selectionError: null as string | null, savingSelection: false, selectionRetryable: false };
    this.unsubscribe = owner.subscribe(() => { this.value = { ...this.value, ...owner.state() }; this.emit(); });
  }
  state = () => this.value;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private emit() { if (!this.disposed) this.listeners.forEach(callback => callback()); }
  private preferenceState(selectionError: string | null, savingSelection = false, selectionRetryable = false) {
    this.value = { ...this.value, selectionError, savingSelection, selectionRetryable }; this.emit();
  }
  async restore(hosts: StoredPairedHost[]) {
    if (this.disposed || this.revision !== 0) return;
    const revision = this.revision;
    try {
      const selected = parseHostSelection(await this.storage.read());
      if (this.disposed || revision !== this.revision) return;
      this.intended = selected;
      if (selected === null) return;
      const host = selected === undefined ? firstConnectableHost(hosts) : hosts.find(host => host.hostId === selected);
      if (!host || !isConnectable(host)) {
        if (selected !== undefined) this.preferenceState("The saved host is unavailable or needs pairing. Choose a host to connect; another host was not selected automatically.");
        return;
      }
      this.intended = host.hostId;
      this.owner.connect(host);
    } catch {
      if (!this.disposed && revision === this.revision) this.preferenceState("Saved host selection could not be read. It was preserved. Choose a host or Disconnect on startup to replace it.");
    }
  }
  connect(host: StoredPairedHost, force = false): boolean {
    if (this.disposed) return false;
    ++this.revision;
    if (!this.owner.connect(host, force)) return false;
    this.save(host.hostId); return true;
  }
  adopt(hostId: string, transport: Transport) {
    ++this.revision;
    this.owner.adopt(hostId, transport);
    if (!this.disposed && this.owner.state().transport === transport && this.owner.state().hostId === hostId) this.save(hostId);
  }
  disconnect() {
    if (this.disposed) return;
    ++this.revision; this.owner.disconnect(); this.save(null);
  }
  forget(hostId: string) {
    if (this.disposed) return;
    // A successful pairing-store deletion must never cause a different host to connect.
    if (this.intended === hostId || this.owner.state().hostId === hostId) this.disconnect();
    else ++this.revision;
  }
  private save(hostId: string | null) {
    this.intended = hostId;
    const revision = ++this.writeRevision;
    this.preferenceState(null, true);
    this.writes = this.writes.then(async () => {
      try {
        await this.storage.write(JSON.stringify({ version: 1, hostId }));
        if (!this.disposed && revision === this.writeRevision) this.preferenceState(null);
      } catch {
        if (!this.disposed && revision === this.writeRevision) this.preferenceState("Host selection was not saved. This connection is unchanged, but the previous startup choice may return after restart. Retry saving or choose a host again.", false, true);
      }
    });
  }
  retrySave() {
    if (!this.disposed && this.intended !== undefined) { ++this.revision; this.save(this.intended); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.revision; this.owner.dispose(); this.unsubscribe(); this.listeners.clear();
  }
}
