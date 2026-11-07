import { describe, expect, it, vi } from "vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { BearerConnectionTarget } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import { MANAGED_CATALOG_KEY, makeManagedCatalog, type ManagedSecureStorage } from "./catalog";

function backing(initial: string | null = null) {
  const values = new Map<string, string>(initial === null ? [] : [[MANAGED_CATALOG_KEY, initial]]);
  const storage: ManagedSecureStorage = {
    getItem: vi.fn(async key => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async key => { values.delete(key); }),
  };
  return { storage, values };
}
const target = (id: string) => new BearerConnectionTarget({ environmentId: EnvironmentId.make(id), label: id, connectionId: `bearer:${id}` });

describe("managed secure catalog", () => {
  it("serializes overlapping commits and reads behind native persistence", async () => {
    const { storage, values } = backing();
    let release!: () => void;
    const firstWrite = new Promise<void>(resolve => { release = resolve; });
    let writes = 0;
    storage.setItem = vi.fn(async (key, value) => {
      if (++writes === 1) await firstWrite;
      values.set(key, value);
    });
    const store = await Effect.runPromise(makeManagedCatalog(storage));
    const first = Effect.runPromise(store.update(current => ({ ...current, targets: [...current.targets, target("one")] })));
    await vi.waitFor(() => expect(writes).toBe(1));
    const second = Effect.runPromise(store.update(current => ({ ...current, targets: [...current.targets, target("two")] })));
    let observed = false;
    const read = Effect.runPromise(store.read).then(value => { observed = true; return value; });
    await Promise.resolve();
    expect(writes).toBe(1); expect(observed).toBe(false); expect(values.size).toBe(0);
    release(); await Promise.all([first, second]);
    expect((await read).targets.map(item => item.environmentId)).toEqual(["one", "two"]);
    const fresh = await Effect.runPromise(makeManagedCatalog(storage));
    expect((await Effect.runPromise(fresh.read)).targets.map(item => item.environmentId)).toEqual(["one", "two"]);
  });

  it("does not publish a failed save and can retry without losing the prior catalog", async () => {
    const { storage, values } = backing();
    const store = await Effect.runPromise(makeManagedCatalog(storage));
    await Effect.runPromise(store.update(current => ({ ...current, targets: [target("saved")] })));
    const before = values.get(MANAGED_CATALOG_KEY);
    vi.mocked(storage.setItem).mockRejectedValueOnce(new Error("native failure secret-token"));
    const error = await Effect.runPromise(Effect.flip(store.update(current => ({ ...current, targets: [target("failed")] }))));
    expect(error.detail).toContain("saved data was preserved");
    expect(JSON.stringify(error) + String(error)).not.toContain("secret-token");
    expect((await Effect.runPromise(store.read)).targets[0].environmentId).toBe("saved");
    expect(values.get(MANAGED_CATALOG_KEY)).toBe(before);
    await Effect.runPromise(store.update(current => ({ ...current, targets: [target("retried")] })));
    expect((await Effect.runPromise(store.read)).targets[0].environmentId).toBe("retried");
  });

  it.each(["", "not JSON secret-token", JSON.stringify({ schemaVersion: 99, token: "secret-token" })])("preserves unreadable content and never includes it in errors", async raw => {
    const { storage, values } = backing(raw);
    const store = await Effect.runPromise(makeManagedCatalog(storage));
    const error = await Effect.runPromise(Effect.flip(store.read));
    expect(error.detail).toContain("decode");
    expect(JSON.stringify(error) + String(error)).not.toContain("secret-token");
    expect(values.get(MANAGED_CATALOG_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    values.delete(MANAGED_CATALOG_KEY);
    expect((await Effect.runPromise(store.read)).targets).toEqual([]);
  });

  it("retries keychain-locked reads and touches only its own namespace", async () => {
    const { storage, values } = backing();
    values.set("blackcrab.mobile.pairedHosts.v1", "legacy untouched");
    values.set("t3code.connection-catalog.v1", "other app untouched");
    vi.mocked(storage.getItem).mockRejectedValueOnce(new Error("locked bearer-secret"));
    const store = await Effect.runPromise(makeManagedCatalog(storage));
    const error = await Effect.runPromise(Effect.flip(store.read));
    expect(String(error)).not.toContain("bearer-secret");
    await Effect.runPromise(store.update(current => ({ ...current, targets: [target("own")] })));
    expect(values.get("blackcrab.mobile.pairedHosts.v1")).toBe("legacy untouched");
    expect(values.get("t3code.connection-catalog.v1")).toBe("other app untouched");
    expect(vi.mocked(storage.getItem).mock.calls.every(([key]) => key === MANAGED_CATALOG_KEY)).toBe(true);
    expect(vi.mocked(storage.setItem).mock.calls.every(([key]) => key === MANAGED_CATALOG_KEY)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
