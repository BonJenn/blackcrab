import { describe, expect, it, vi } from "vitest";
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///native/" }));
import { EnvironmentId } from "@t3tools/contracts";
import { Persistence } from "@t3tools/client-runtime/platform";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import { managedCacheKey, makeFileSystemCacheBackend, makeManagedCacheLayer, type ManagedCacheBackend, type ManagedCacheFileSystem } from "./cache";

function filesystem() {
  const files = new Map<string, string>(), directories = new Set<string>();
  let failMove = false;
  const fs: ManagedCacheFileSystem = {
    documentDirectory: "file:///sandbox/",
    getInfoAsync: async uri => ({ exists: directories.has(uri) || files.has(uri), isDirectory: directories.has(uri) }),
    makeDirectoryAsync: async uri => { directories.add(uri); },
    readDirectoryAsync: async uri => [...files.keys()].filter(key => key.startsWith(uri)).map(key => key.slice(uri.length)),
    readAsStringAsync: async uri => { if (!files.has(uri)) throw Error("missing"); return files.get(uri)!; },
    writeAsStringAsync: async (uri, value) => { files.set(uri, value); },
    moveAsync: async ({ from, to }) => { files.delete(to); if (failMove) throw Error("native-secret"); files.set(to, files.get(from)!); files.delete(from); },
    deleteAsync: async uri => { files.delete(uri); },
  };
  return { fs, files, failNextMove: () => { failMove = true; }, allowMove: () => { failMove = false; } };
}
const refs = { refs: [], isRepo: true, hasPrimaryRemote: false, nextCursor: null, totalCount: 0 };
const env = EnvironmentId.make("environment-a");
function memory() {
  const values = new Map<string, string>();
  const backend: ManagedCacheBackend = {
    read: async key => values.get(key) ?? null,
    write: async (key, value) => { values.set(key, value); },
    remove: vi.fn(async key => { values.delete(key); }),
    clear: async prefix => { for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key); },
  };
  return { values, backend };
}

describe("native managed cache", () => {
  it("keeps the last committed generation across native move failure and restart", async () => {
    const native = filesystem(), backend = makeFileSystemCacheBackend(native.fs);
    const key = managedCacheKey("../../private/env", "vcs-refs", "/secret/project");
    await backend.write(key, "first");
    native.failNextMove();
    await expect(backend.write(key, "second")).rejects.toThrow();
    expect(await makeFileSystemCacheBackend(native.fs).read(key)).toBe("first");
    native.allowMove(); await backend.write(key, "third");
    expect(await makeFileSystemCacheBackend(native.fs).read(key)).toBe("third");
    expect([...native.files.keys()].join(" ")).not.toMatch(/private|secret|\.pending/);
  });

  it("isolates environment and resource clears and preserves unrelated native files", async () => {
    const native = filesystem(), backend = makeFileSystemCacheBackend(native.fs);
    const a = managedCacheKey("a", "vcs-refs", "cwd"), thread = managedCacheKey("a", "thread", "thread"), b = managedCacheKey("b", "vcs-refs", "cwd");
    await Promise.all([backend.write(a, "a"), backend.write(thread, "thread"), backend.write(b, "b")]);
    const directory = [...native.files.keys()][0]!.replace(/[^/]+$/, "");
    native.files.set(directory + "legacy.json", "untouched");
    await backend.clear(a.split("/")[0] + "/vcs-refs-");
    expect(await backend.read(a)).toBeNull(); expect(await backend.read(thread)).toBe("thread"); expect(await backend.read(b)).toBe("b");
    expect(native.files.get(directory + "legacy.json")).toBe("untouched");
    await expect(backend.read("../../legacy")).rejects.toThrow("Invalid managed cache key");
  });

  it("round trips source shell and refs codecs while excluding unknown credential fields", async () => {
    const { values, backend } = memory(), runtime = ManagedRuntime.make(makeManagedCacheLayer(backend));
    try {
      await runtime.runPromise(Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        const shell = { schemaVersion: 1, snapshotSequence: 0, threads: [], archivedThreads: [], projects: [] };
        yield* cache.saveShell(env, shell);
        const loaded = Option.getOrThrow(yield* cache.loadShell(env));
        expect(loaded).toMatchObject(shell);
        expect(loaded.loadPullRequests).toBeDefined();
        if (loaded.loadPullRequests) expect((yield* loaded.loadPullRequests).size).toBe(0);
        yield* cache.saveVcsRefs(env, "/project", { ...refs, access_token: "secret-bearer" } as typeof refs);
        expect(Option.getOrThrow(yield* cache.loadVcsRefs(env, "/project"))).toEqual(refs);
      }));
      expect([...values.values()].join(" ")).not.toContain("secret-bearer");
    } finally { await runtime.dispose(); }
  });

  it("preserves corrupt and cross-environment records and sanitizes failures with retry", async () => {
    const { values, backend } = memory(), runtime = ManagedRuntime.make(makeManagedCacheLayer(backend));
    const key = managedCacheKey(env, "vcs-refs", "cwd");
    try {
      await runtime.runPromise(Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        yield* cache.saveVcsRefs(env, "cwd", refs);
        const valid = values.get(key)!;
        for (const raw of ["token-secret invalid-json", valid.replace(env, "other-environment")]) {
          values.set(key, raw);
          const failure = yield* Effect.flip(cache.loadVcsRefs(env, "cwd"));
          expect(String(failure)).not.toContain("token-secret"); expect(values.get(key)).toBe(raw);
        }
        values.set(key, valid);
        expect(Option.isSome(yield* cache.loadVcsRefs(env, "cwd"))).toBe(true);
        const write = backend.write;
        backend.write = async () => { throw Error("native bearer secret"); };
        const failure = yield* Effect.flip(cache.saveVcsRefs(env, "cwd", refs));
        expect(JSON.stringify(failure)).not.toContain("native bearer secret"); expect(values.get(key)).toBe(valid);
        backend.write = write; yield* cache.saveVcsRefs(env, "cwd", refs);
      }));
      expect(backend.remove).not.toHaveBeenCalled();
    } finally { await runtime.dispose(); }
  });
});
