import * as Option from "effect/Option";
import type { ManagedRuntimeAdapter, ManagedRuntimeEvents } from "./runtime";
import type { ManagedSecureStorage } from "./catalog";
import type { ManagedEnvironmentView, ManagedEnvironmentsClient, ManagedEnvironmentsSnapshot } from "./types";

type Catalog = Parameters<ManagedRuntimeEvents["catalog"]>[0];
type Entry = Catalog extends ReadonlyMap<infer _K, infer V> ? V : never;
type Connection = Parameters<ManagedRuntimeEvents["connection"]>[1];
type Shell = Parameters<ManagedRuntimeEvents["shell"]>[1];
type Action = "pair" | "connect" | "disconnect" | "forget" | "select";
export const MANAGED_SELECTION_KEY = "blackcrab.mobile.managedSelection.v1";
const START_ERROR = "Managed workspaces could not start. Retry loading workspaces.";
const CLOSE_ERROR = "The previous workspace connection could not close. Retry loading workspaces before connecting again.";
const NOT_READY = "Managed workspaces are not ready. Retry loading workspaces.";
const SAVE_ERROR = "Workspace selection could not be saved. The previous selection was preserved.";
const RELOAD_ERROR = "Workspace data could not be refreshed. Retry loading workspaces.";
const ACTION_ERRORS: Record<Action, string> = {
  pair: "Could not pair this workspace. Check its address and pairing code.",
  connect: "Could not connect to this workspace. Check its address and network connection.",
  disconnect: "Could not disconnect this phone from the workspace. Try again.",
  forget: "Could not forget this workspace. Try again.",
  select: SAVE_ERROR,
};
class SelectionSaveError extends Error { constructor() { super(SAVE_ERROR); } }
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Completion = ReturnType<typeof deferred>;
interface Owner {
  generation: number;
  adapter: ManagedRuntimeAdapter;
  completion: Completion;
  retired: boolean;
  ready: boolean;
  pending: number;
  entries: Map<string, Entry>;
  connections: Map<string, Connection>;
  shells: Map<string, Shell>;
  unavailable: Set<string>;
  unavailableAll: boolean;
  catalogSeen: boolean;
  selected: string | null | undefined;
  selectionError?: string;
  actionError?: string;
  disposal?: Promise<void>;
}
export interface ManagedEnvironmentsController extends ManagedEnvironmentsClient {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly retry: () => Promise<void>;
}
export interface ManagedClientOptions {
  readonly makeAdapter: () => ManagedRuntimeAdapter;
  readonly selectionStorage: ManagedSecureStorage;
}

/** Native controller: one scoped owner, canonical events and durable focus intent. */
export function createManagedEnvironmentsClient(options: ManagedClientOptions): ManagedEnvironmentsController {
  return new ManagedClient(options);
}

class ManagedClient implements ManagedEnvironmentsController {
  private value: ManagedEnvironmentsSnapshot = Object.freeze({ loading: false, busy: false, environments: Object.freeze([]) });
  private listeners = new Set<() => void>();
  private generation = 0;
  private desired = false;
  private active: Owner | null = null;
  private lifecycle: Promise<void> = Promise.resolve();
  private mutations: Promise<void> = Promise.resolve();
  private starting: Promise<void> | null = null;
  private retrying: Promise<void> | null = null;
  constructor(private readonly options: ManagedClientOptions) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: ManagedEnvironmentsSnapshot) {
    this.value = Object.freeze(value);
    for (const listener of this.listeners) { try { listener(); } catch { /* A view listener cannot tear down the authoritative stream. */ } }
  }
  private current(owner: Owner) { return this.desired && !owner.retired && this.active === owner && owner.generation === this.generation; }
  private transition(operation: () => Promise<void>) {
    const result = this.lifecycle.then(operation);
    this.lifecycle = result.then(() => undefined, () => undefined);
    return result;
  }
  private retire(owner: Owner, cancelStartup = true) { owner.retired = true; owner.ready = false; if (cancelStartup) owner.completion.resolve(); }
  private async dispose(owner: Owner) {
    if (!owner.disposal) {
      const disposal = Promise.resolve().then(() => owner.adapter.dispose());
      owner.disposal = disposal;
      // Failed cleanup never authorizes a new owner; an explicit retry may retry disposal.
      void disposal.catch(() => { if (owner.disposal === disposal) owner.disposal = undefined; });
    }
    await owner.disposal;
    if (this.active === owner) this.active = null;
  }
  start = (): Promise<void> => {
    if (this.desired) return this.starting ?? Promise.resolve();
    this.desired = true;
    const generation = ++this.generation, completion = deferred();
    this.starting = completion.promise;
    this.publish({ loading: true, busy: false, environments: Object.freeze([]) });
    void this.transition(async () => {
      if (this.active) { this.retire(this.active); await this.dispose(this.active); }
      await this.mutations;
      if (!this.desired || generation !== this.generation) { completion.resolve(); return; }
      const owner: Owner = {
        generation, completion, adapter: this.options.makeAdapter(), retired: false, ready: false, pending: 0,
        entries: new Map(), connections: new Map(), shells: new Map(), unavailable: new Set(), unavailableAll: false,
        catalogSeen: false, selected: undefined,
      };
      this.active = owner;
      // Do not hold the lifecycle queue while startup waits on native storage/network.
      void this.boot(owner);
    }).catch(() => {
      if (this.desired && generation === this.generation) {
        this.publish({ loading: false, busy: false, environments: Object.freeze([]), error: this.active ? CLOSE_ERROR : START_ERROR });
        completion.reject(new Error(this.active ? CLOSE_ERROR : START_ERROR));
      } else completion.resolve();
    });
    return completion.promise;
  };
  stop = (): Promise<void> => {
    this.desired = false;
    const generation = ++this.generation;
    if (this.active) this.retire(this.active);
    this.publish({ loading: false, busy: true, environments: Object.freeze([]) });
    return this.transition(async () => {
      if (this.active) { this.retire(this.active); await this.dispose(this.active); }
      // Complete any in-flight native selection write before a later owner reads it.
      await this.mutations;
      if (!this.desired && generation === this.generation) this.publish({ loading: false, busy: false, environments: Object.freeze([]) });
    }).catch(() => {
      if (!this.desired && generation === this.generation) this.publish({ loading: false, busy: false, environments: Object.freeze([]), error: CLOSE_ERROR });
      throw new Error(CLOSE_ERROR);
    });
  };
  retry = (): Promise<void> => {
    if (this.retrying) return this.retrying;
    const retry = this.stop().then(() => this.start());
    this.retrying = retry;
    const clear = () => { if (this.retrying === retry) this.retrying = null; };
    void retry.then(clear, clear);
    return retry;
  };
  private async boot(owner: Owner) {
    const events: ManagedRuntimeEvents = {
      catalog: entries => {
        if (!this.current(owner) || owner.unavailableAll) return;
        owner.entries = new Map([...entries].map(([id, entry]) => [String(id), entry])); owner.catalogSeen = true;
        for (const id of owner.connections.keys()) if (!owner.entries.has(id)) owner.connections.delete(id);
        for (const id of owner.shells.keys()) if (!owner.entries.has(id)) owner.shells.delete(id);
        for (const id of owner.unavailable) if (!owner.entries.has(id)) owner.unavailable.delete(id);
        this.refresh(owner);
      },
      connection: (id, state) => {
        if (!this.current(owner) || owner.unavailableAll || owner.unavailable.has(id) || !owner.entries.has(id)) return;
        owner.connections.set(id, state); this.refresh(owner);
      },
      shell: (id, state) => {
        if (!this.current(owner) || owner.unavailableAll || owner.unavailable.has(id) || !owner.entries.has(id)) return;
        owner.shells.set(id, state); this.refresh(owner);
      },
      unavailable: id => {
        if (!this.current(owner)) return;
        if (id === undefined) owner.unavailableAll = true;
        else if (owner.entries.has(id)) owner.unavailable.add(id);
        else return;
        owner.actionError = RELOAD_ERROR; this.refresh(owner);
      },
    };
    try {
      await Promise.all([this.loadSelection(owner), owner.adapter.start(events)]);
      if (!this.current(owner)) { owner.completion.resolve(); return; }
      owner.ready = true; this.refresh(owner); owner.completion.resolve();
    } catch {
      if (!this.current(owner)) { owner.completion.resolve(); return; }
      this.retire(owner, false);
      this.publish({ ...this.value, loading: false, busy: false, error: START_ERROR });
      // Queue cleanup before a caller's explicit retry can create another owner.
      void this.transition(() => this.dispose(owner)).catch(() => {
        if (this.active === owner && owner.generation === this.generation) this.publish({ ...this.value, error: CLOSE_ERROR });
      });
      owner.completion.reject(new Error(START_ERROR));
    }
  }
  private async loadSelection(owner: Owner) {
    try {
      const raw = await this.options.selectionStorage.getItem(MANAGED_SELECTION_KEY);
      let selected: string | null | undefined;
      if (raw !== null) {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("environmentId" in value)
          || !(value.environmentId === null || (typeof value.environmentId === "string" && value.environmentId.trim().length > 0))) throw new Error("invalid selection");
        selected = value.environmentId;
      }
      if (this.current(owner)) { owner.selected = selected; owner.selectionError = undefined; this.refresh(owner); }
    } catch {
      if (this.current(owner)) { owner.selectionError = "Saved workspace selection could not be read. It was preserved. Select a workspace to replace it."; this.refresh(owner); }
    }
  }
  private async saveSelection(owner: Owner, id: string | null) {
    try { await this.options.selectionStorage.setItem(MANAGED_SELECTION_KEY, JSON.stringify({ schemaVersion: 1, environmentId: id })); }
    catch { throw new SelectionSaveError(); }
    if (this.current(owner)) { owner.selected = id; owner.selectionError = undefined; this.refresh(owner); }
  }
  private requireEntry(owner: Owner, id: string, requireObserver = true) {
    if (!owner.entries.has(id)) throw new Error("unknown workspace");
    if (requireObserver && (owner.unavailableAll || owner.unavailable.has(id))) throw new UnavailableOwnerError();
  }
  private mutate(action: Action, operation: (owner: Owner) => Promise<void>): Promise<void> {
    const owner = this.active;
    if (!owner || !this.current(owner) || !owner.ready) return Promise.reject(new Error(NOT_READY));
    owner.pending++; this.refresh(owner);
    const result = this.mutations.then(async () => {
      if (!this.current(owner) || !owner.ready) return;
      owner.actionError = undefined; this.refresh(owner);
      try { await operation(owner); }
      catch (error) {
        if (!this.current(owner)) return;
        const message = error instanceof SelectionSaveError ? SAVE_ERROR : error instanceof UnavailableOwnerError ? RELOAD_ERROR : ACTION_ERRORS[action];
        owner.actionError = message; this.refresh(owner); throw new Error(message);
      }
    }).finally(() => { owner.pending--; if (this.current(owner)) this.refresh(owner); });
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }
  pair = (input: { address: string; pairingCode: string }) => this.mutate("pair", async owner => {
    const id = await owner.adapter.pair({ address: input.address, pairingCode: input.pairingCode });
    if (!this.current(owner)) return;
    try { await this.saveSelection(owner, id); }
    catch { owner.actionError = "Workspace paired, but its selection could not be saved. Select the saved workspace again."; }
  });
  connect = (id: string) => this.mutate("connect", async owner => {
    this.requireEntry(owner, id); await this.saveSelection(owner, id);
    if (!this.current(owner)) return;
    await owner.adapter.setEnabled(id, true);
    if (this.current(owner)) await owner.adapter.retry(id);
  });
  disconnect = (id: string) => this.mutate("disconnect", async owner => { this.requireEntry(owner, id); await owner.adapter.setEnabled(id, false); });
  forget = (id: string) => this.mutate("forget", async owner => {
    this.requireEntry(owner, id); const wasSelected = owner.selected === id;
    await owner.adapter.remove(id);
    if (wasSelected && this.current(owner)) {
      try { await this.saveSelection(owner, null); }
      catch { owner.actionError = "Workspace forgotten, but its saved selection could not be cleared. Select another workspace to replace it."; }
    }
  });
  select = (id: string) => this.mutate("select", async owner => { this.requireEntry(owner, id, false); await this.saveSelection(owner, id); });
  private refresh(owner: Owner) {
    if (!this.current(owner)) return;
    const environments = Object.freeze([...owner.entries].map(([id, entry]) => projectEnvironment(id, entry, owner.connections.get(id), owner.shells.get(id), owner.unavailableAll || owner.unavailable.has(id))));
    const selectedEnvironmentId = owner.selected && owner.entries.has(owner.selected) ? owner.selected : undefined;
    const missing = owner.ready && owner.catalogSeen && owner.selected && !owner.entries.has(owner.selected);
    const error = owner.actionError ?? owner.selectionError ?? (missing ? "The saved workspace is unavailable. Select a workspace; another was not selected automatically." : undefined);
    this.publish({ loading: !owner.ready, busy: owner.pending > 0, environments, ...(selectedEnvironmentId ? { selectedEnvironmentId } : {}), ...(error ? { error } : {}) });
  }
}
class UnavailableOwnerError extends Error {}
function safeAddress(entry: Entry): string {
  const profile = Option.getOrNull(entry.profile);
  const raw = profile?._tag === "BearerConnectionProfile" ? profile.httpBaseUrl : entry.target._tag === "PrimaryConnectionTarget" ? entry.target.httpBaseUrl : "";
  try { const url = new URL(raw); return url.protocol === "http:" || url.protocol === "https:" ? url.origin : ""; } catch { return ""; }
}
function connectionError(state: Connection | undefined): string | undefined {
  const failure = state?.lastFailure;
  if (!failure) return undefined;
  switch (failure.reason) {
    case "authentication": return "Workspace authorization expired or was revoked. Pair the workspace again.";
    case "configuration": return failure.serverUpdateRequired ? "Update this workspace host before connecting." : "Workspace identity or configuration needs attention. Confirm its address before pairing again.";
    case "permission": return "This connection does not have permission for the requested workspace data.";
    case "unsupported": return "This connection is not supported on this device.";
    default: return "Could not reach this workspace. Check its address and network connection.";
  }
}
function projectEnvironment(id: string, entry: Entry, connection: Connection | undefined, shell: Shell | undefined, unavailable: boolean): ManagedEnvironmentView {
  const snapshot = shell ? Option.getOrNull(shell.snapshot) : null;
  let phase: ManagedEnvironmentView["phase"];
  if (unavailable) phase = "blocked";
  else if (!entry.enabled || (connection && !connection.desired)) phase = "disconnected";
  else if (entry.unsupportedReason || entry.serverUpdateRequired) phase = "blocked";
  else if (!connection) phase = "connecting";
  else switch (connection.phase) {
    case "connected": phase = "connected"; break;
    case "connecting": phase = "connecting"; break;
    case "offline": case "backoff": phase = "offline"; break;
    case "blocked": phase = "blocked"; break;
    default: phase = "disconnected";
  }
  const error = unavailable ? RELOAD_ERROR : entry.serverUpdateRequired ? "Update this workspace host before connecting." : entry.unsupportedReason ? "This workspace connection is not supported by this app." : connectionError(connection);
  const seen = new Set<string>();
  const threads = snapshot ? [...snapshot.threads, ...snapshot.archivedThreads].flatMap(thread => {
    if (seen.has(thread.id)) return [];
    seen.add(thread.id);
    return [Object.freeze({ id: String(thread.id), title: thread.title || "Untitled thread", projectId: String(thread.projectId), status: thread.archivedAt ? `archived · ${thread.status}` : thread.status })];
  }) : [];
  return Object.freeze({
    environmentId: id, label: entry.target.label, address: safeAddress(entry), phase, dataStatus: shell?.status ?? "empty",
    ...(error ? { error } : {}),
    projects: Object.freeze(snapshot?.projects.map(project => Object.freeze({ id: String(project.id), title: project.title, path: project.workspaceRoot })) ?? []),
    threads: Object.freeze(threads),
  });
}
