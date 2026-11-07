// Cache services adapted from BonJenn/t3code 7f02de2 environment-cache-store.ts.
// Upstream MIT attribution: vendor/t3/LICENSE.upstream.
import { EnvironmentId, ServerConfig, VcsListRefsResult } from "@t3tools/contracts";
import {
  ORCHESTRATION_CACHE_SCHEMA_VERSION, StoredOrchestrationShellSnapshot,
  decodeStoredThreadSnapshot, encodeStoredThreadSnapshot,
  makeStoredShellSnapshotEncoder, Persistence,
} from "@t3tools/client-runtime/platform";
import { deferPullRequests, detachPullRequests } from "@t3tools/client-runtime/state/shell";
import { sha256 } from "@noble/hashes/sha256";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as FileSystem from "expo-file-system/legacy";

export interface ManagedCacheBackend {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(prefix: string): Promise<void>;
}
export interface ManagedCacheFileSystem {
  readonly documentDirectory: string | null;
  getInfoAsync(uri: string): Promise<{ exists: boolean; isDirectory?: boolean }>;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  readDirectoryAsync(uri: string): Promise<string[]>;
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, value: string): Promise<void>;
  moveAsync(options: { from: string; to: string }): Promise<void>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const digest = (value: string) => hex(sha256(new TextEncoder().encode(value)));
const environmentPrefix = (environmentId: string) => `${digest(environmentId)}/`;
export const managedCacheKey = (environmentId: string, kind: "shell" | "thread" | "server-config" | "vcs-refs", id: string) => `${environmentPrefix(environmentId)}${kind}-${digest(id)}`;
const keyPattern = /^([a-f0-9]{64})\/((?:shell|thread|server-config|vcs-refs)-[a-f0-9]{64})$/;
const prefixPattern = /^([a-f0-9]{64})\/(vcs-refs-)?$/;
const filePattern = /^((?:shell|thread|server-config|vcs-refs)-[a-f0-9]{64})\.(\d{16})-([a-f0-9]{32})\.(json|pending)$/;

/** Completed immutable generations avoid native moveAsync's overwrite/remove-old gap. */
export function makeFileSystemCacheBackend(fileSystem: ManagedCacheFileSystem = FileSystem): ManagedCacheBackend {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <A>(operation: () => Promise<A>): Promise<A> => {
    const next = queue.then(operation); queue = next.then(() => undefined, () => undefined); return next;
  };
  function root() {
    const directory = fileSystem.documentDirectory;
    if (!directory || !directory.startsWith("file://")) throw new Error("Native managed cache storage is unavailable.");
    return directory.replace(/\/?$/, "/") + "blackcrab-managed-cache-v1/";
  }
  function location(key: string) {
    const match = keyPattern.exec(key);
    if (!match) throw new Error("Invalid managed cache key.");
    return { directory: root() + match[1] + "/", resource: match[2] };
  }
  async function names(directory: string) {
    const info = await fileSystem.getInfoAsync(directory);
    if (!info.exists) return [];
    if (!info.isDirectory) throw new Error("Managed cache path is not a directory.");
    return fileSystem.readDirectoryAsync(directory);
  }
  function generations(entries: string[], resource: string) {
    return entries.filter(name => {
      const match = filePattern.exec(name);
      return match?.[1] === resource && match[4] === "json";
    }).sort();
  }
  async function removeKey(key: string) {
    const { directory, resource } = location(key);
    for (const name of await names(directory)) if (filePattern.exec(name)?.[1] === resource) await fileSystem.deleteAsync(directory + name, { idempotent: true });
  }
  return {
    read: key => serialized(async () => {
      const { directory, resource } = location(key), files = generations(await names(directory), resource);
      if (!files.length) return null;
      const raw = await fileSystem.readAsStringAsync(directory + files[files.length - 1]);
      if (new TextEncoder().encode(raw).length > MAX_CACHE_BYTES) throw new Error("Managed cache record exceeds its size limit.");
      return raw;
    }),
    write: (key, value) => serialized(async () => {
      if (new TextEncoder().encode(value).length > MAX_CACHE_BYTES) throw new Error("Managed cache record exceeds its size limit.");
      const { directory, resource } = location(key);
      await fileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const files = generations(await names(directory), resource);
      const previous = files.length ? Number(filePattern.exec(files[files.length - 1])![2]) : 0;
      const next = previous + 1;
      if (!Number.isSafeInteger(next)) throw new Error("Managed cache generation limit reached.");
      const random = new Uint8Array(16); globalThis.crypto.getRandomValues(random);
      const name = `${resource}.${String(next).padStart(16, "0")}-${hex(random)}`;
      const pending = directory + name + ".pending", completed = directory + name + ".json";
      try { await fileSystem.writeAsStringAsync(pending, value); await fileSystem.moveAsync({ from: pending, to: completed }); }
      catch (error) { await fileSystem.deleteAsync(pending, { idempotent: true }).catch(() => undefined); throw error; }
      // A committed generation stays valid if best-effort old-generation cleanup fails.
      for (const old of files.slice(0, -1)) await fileSystem.deleteAsync(directory + old, { idempotent: true }).catch(() => undefined);
    }),
    remove: key => serialized(() => removeKey(key)),
    clear: prefix => serialized(async () => {
      const match = prefixPattern.exec(prefix);
      if (!match) throw new Error("Invalid managed cache prefix.");
      const directory = root() + match[1] + "/", kind = match[2] ?? "";
      for (const name of await names(directory)) {
        const record = filePattern.exec(name);
        if (record && record[1].startsWith(kind)) await fileSystem.deleteAsync(directory + name, { idempotent: true });
      }
    }),
  };
}
const nativeManagedCacheBackend = makeFileSystemCacheBackend();
const StoredServerConfig = Schema.Struct({ schemaVersion: Schema.Literal(1), environmentId: EnvironmentId, config: ServerConfig });
const StoredVcsRefs = Schema.Struct({ schemaVersion: Schema.Literal(1), environmentId: EnvironmentId, cwd: Schema.String, refs: VcsListRefsResult });
const decodeShellJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeShell = Schema.decodeUnknownEffect(StoredOrchestrationShellSnapshot);
const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredServerConfig));
const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(StoredServerConfig));
const decodeRefs = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredVcsRefs));
const encodeRefs = Schema.encodeEffect(Schema.fromJsonString(StoredVcsRefs));
type Operation = Persistence.ConnectionPersistenceError["operation"];
const persistenceError = (operation: Operation) => new Persistence.ConnectionPersistenceError({ operation, message: `Could not ${operation.replaceAll("-", " ")} in the managed cache. Cached data was preserved.` });
const backendEffect = <A>(operation: Operation, run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => persistenceError(operation) });
const decodeStoredShell = Effect.fnUntraced(function* (raw: string) {
  const parsed = yield* decodeShellJson(raw);
  const links = Predicate.isObject(parsed) ? detachPullRequests(parsed.snapshot) : [];
  const stored = yield* decodeShell(parsed);
  return { ...stored, snapshot: deferPullRequests(stored.snapshot, links) };
});

export function makeManagedCacheLayer(backend: ManagedCacheBackend = nativeManagedCacheBackend) {
  const encodeShell = makeStoredShellSnapshotEncoder();
  function load<A, E, B>(environmentId: string, kind: "shell" | "thread" | "server-config" | "vcs-refs", id: string, operation: Operation, decode: (raw: string) => Effect.Effect<A, E>, select: (value: A) => B | null) {
    return backendEffect(operation, () => backend.read(managedCacheKey(environmentId, kind, id))).pipe(Effect.flatMap(raw => {
      if (raw === null) return Effect.succeed(Option.none<B>());
      return decode(raw).pipe(Effect.mapError(() => persistenceError(operation)), Effect.flatMap(value => {
        const result = select(value);
        return result === null ? Effect.fail(persistenceError(operation)) : Effect.succeed(Option.some(result));
      }));
    }));
  }
  function save<E>(key: string, operation: Operation, encode: Effect.Effect<string, E>) {
    return encode.pipe(Effect.mapError(() => persistenceError(operation)), Effect.flatMap(raw => backendEffect(operation, () => backend.write(key, raw))));
  }
  return Layer.succeed(Persistence.EnvironmentCacheStore, Persistence.EnvironmentCacheStore.of({
    loadShell: environmentId => load(environmentId, "shell", "snapshot", "load-shell", decodeStoredShell, value => value.environmentId === environmentId ? value.snapshot : null),
    saveShell: (environmentId, snapshot) => save(managedCacheKey(environmentId, "shell", "snapshot"), "save-shell", encodeShell({ schemaVersion: ORCHESTRATION_CACHE_SCHEMA_VERSION, environmentId, snapshot })),
    loadThread: (environmentId, threadId) => load(environmentId, "thread", threadId, "load-thread", decodeStoredThreadSnapshot, value => value.environmentId === environmentId && value.threadId === threadId && value.snapshot.projection.thread.id === threadId ? value.snapshot : null),
    saveThread: (environmentId, snapshot) => save(managedCacheKey(environmentId, "thread", snapshot.projection.thread.id), "save-thread", encodeStoredThreadSnapshot({ environmentId, threadId: snapshot.projection.thread.id, snapshot })),
    removeThread: (environmentId, threadId) => backendEffect("remove-thread", () => backend.remove(managedCacheKey(environmentId, "thread", threadId))),
    loadServerConfig: environmentId => load(environmentId, "server-config", "config", "load-server-config", decodeConfig, value => value.environmentId === environmentId && value.config.environment.environmentId === environmentId ? value.config : null),
    saveServerConfig: (environmentId, config) => config.environment.environmentId !== environmentId ? Effect.fail(persistenceError("save-server-config")) : save(managedCacheKey(environmentId, "server-config", "config"), "save-server-config", encodeConfig({ schemaVersion: 1, environmentId, config })),
    loadVcsRefs: (environmentId, cwd) => load(environmentId, "vcs-refs", cwd, "load-vcs-refs", decodeRefs, value => value.environmentId === environmentId && value.cwd === cwd ? value.refs : null),
    saveVcsRefs: (environmentId, cwd, refs) => save(managedCacheKey(environmentId, "vcs-refs", cwd), "save-vcs-refs", encodeRefs({ schemaVersion: 1, environmentId, cwd, refs })),
    removeVcsRefs: (environmentId, cwd) => backendEffect("remove-vcs-refs", () => backend.remove(managedCacheKey(environmentId, "vcs-refs", cwd))),
    clearVcsRefs: environmentId => backendEffect("clear-vcs-refs", () => backend.clear(environmentPrefix(environmentId) + "vcs-refs-")),
    clear: environmentId => backendEffect("clear-environment", () => backend.clear(environmentPrefix(environmentId))),
  }));
}
