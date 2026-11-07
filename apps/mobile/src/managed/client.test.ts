import { describe, expect, it, vi } from "vitest";
import * as Option from "effect/Option";
import { EnvironmentId } from "@t3tools/contracts";
import { BearerConnectionTarget, BearerConnectionProfile, AVAILABLE_CONNECTION_STATE } from "@t3tools/client-runtime/connection";
import { createManagedEnvironmentsClient, MANAGED_SELECTION_KEY } from "./client";
import type { ManagedRuntimeAdapter, ManagedRuntimeEvents } from "./runtime";
import type { ManagedSecureStorage } from "./catalog";

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const values = new Map<string, string>();
  const storage: ManagedSecureStorage = {
    getItem: vi.fn(async key => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async key => { values.delete(key); }),
  };
  const owners: Array<{ adapter: ManagedRuntimeAdapter; events: ManagedRuntimeEvents | undefined }> = [];
  const makeAdapter = vi.fn(() => {
    const owner = { events: undefined as ManagedRuntimeEvents | undefined, adapter: {} as ManagedRuntimeAdapter };
    owner.adapter = {
      start: vi.fn(async events => { owner.events = events; events.catalog(catalog()); }),
      dispose: vi.fn(async () => {}), pair: vi.fn(async () => "one"),
      setEnabled: vi.fn(async () => {}), remove: vi.fn(async () => {}), retry: vi.fn(async () => {}),
    };
    owners.push(owner); return owner.adapter;
  });
  const client = createManagedEnvironmentsClient({ makeAdapter, selectionStorage: storage });
  return { client, makeAdapter, owners, values, storage };
}
function catalog(ids = ["one", "two"]): Parameters<ManagedRuntimeEvents["catalog"]>[0] {
  return new Map(ids.map(id => {
    const environmentId = EnvironmentId.make(id), connectionId = `bearer:${id}`;
    return [environmentId, {
      target: new BearerConnectionTarget({ environmentId, connectionId, label: id }), enabled: true,
      profile: Option.some(new BearerConnectionProfile({ environmentId, connectionId, label: id, httpBaseUrl: "https://user:password@example.com/path?token=secret#secret", wsBaseUrl: "wss://example.com/websocket" })),
    }];
  }));
}
function shell(status: "empty" | "cached" | "synchronizing" | "live", generation = 0): Parameters<ManagedRuntimeEvents["shell"]>[1] {
  return { snapshot: Option.none(), status, error: Option.none(), generation, removedAt: new Map() };
}
const selected = (id: string | null) => JSON.stringify({ schemaVersion: 1, environmentId: id });

describe("managed native controller", () => {
  it("projects canonical states independently and removes address credentials", async () => {
    const f = fixture(); const start = f.client.start(); expect(f.client.start()).toBe(start); await start;
    const events = f.owners[0].events!;
    expect(f.client.getSnapshot()).toBe(f.client.getSnapshot());
    expect(f.client.getSnapshot().selectedEnvironmentId).toBeUndefined();
    events.connection("one", { ...AVAILABLE_CONNECTION_STATE, desired: true, phase: "connected", generation: 5 });
    events.shell("one", shell("live", 5));
    expect(f.client.getSnapshot().environments[0]).toMatchObject({ phase: "connected", dataStatus: "live", address: "https://example.com" });
    events.shell("one", shell("cached", 0));
    expect(f.client.getSnapshot().environments[0].dataStatus).toBe("cached");
    events.shell("one", shell("synchronizing", 1));
    expect(f.client.getSnapshot().environments[0].dataStatus).toBe("synchronizing");
    expect(JSON.stringify(f.client.getSnapshot())).not.toMatch(/password|secret|token/);
    await f.client.stop();
  });

  it("rejects startup failures safely and disposes before retry", async () => {
    const f = fixture(); const start = f.client.start();
    await vi.waitFor(() => expect(f.owners).toHaveLength(1));
    // A separate owner fixture lets startup fail before its initial async completion.
    await start; await f.client.stop();
    const failure = deferred();
    f.makeAdapter.mockImplementationOnce(() => ({ ...f.owners[0].adapter, start: vi.fn(() => failure.promise) }));
    const failedStart = f.client.start(); const rejected = expect(failedStart).rejects.toThrow("Managed workspaces could not start");
    await Promise.resolve(); failure.reject(new Error("bearer-secret")); await rejected;
    expect(f.client.getSnapshot().error).toContain("Retry");
    expect(JSON.stringify(f.client.getSnapshot())).not.toContain("bearer-secret");
    await f.client.retry(); expect(f.client.getSnapshot().loading).toBe(false); await f.client.stop();
  });

  it("retires callbacks immediately and waits for disposal before a new owner", async () => {
    const f = fixture(); await f.client.start(); const old = f.owners[0], close = deferred();
    vi.mocked(old.adapter.dispose).mockImplementationOnce(() => close.promise);
    const stop = f.client.stop(), restart = f.client.start();
    old.events!.catalog(catalog(["stale"])); old.events!.unavailable();
    await vi.waitFor(() => expect(old.adapter.dispose).toHaveBeenCalledTimes(1));
    expect(f.makeAdapter).toHaveBeenCalledTimes(1); expect(f.client.getSnapshot().environments).toEqual([]);
    close.resolve(); await Promise.all([stop, restart]);
    old.events!.catalog(catalog(["stale"]));
    expect(f.client.getSnapshot().environments.map(row => row.environmentId)).toEqual(["one", "two"]);
    await f.client.stop();
  });

  it("can stop a pending startup and ignores its eventual rejection", async () => {
    const f = fixture(); const pending = deferred();
    f.makeAdapter.mockImplementationOnce(() => {
      const adapter: ManagedRuntimeAdapter = { start: vi.fn(() => pending.promise), dispose: vi.fn(async () => {}), pair: vi.fn(async () => "one"), setEnabled: vi.fn(async () => {}), remove: vi.fn(async () => {}), retry: vi.fn(async () => {}) };
      f.owners.push({ adapter, events: undefined }); return adapter;
    });
    const start = f.client.start(); await vi.waitFor(() => expect(f.makeAdapter).toHaveBeenCalledTimes(1));
    await f.client.stop(); await start; await f.client.start();
    pending.reject(new Error("stale private error")); await Promise.resolve(); await Promise.resolve();
    expect(f.client.getSnapshot().loading).toBe(false); expect(f.client.getSnapshot().error).toBeUndefined();
    expect(f.client.getSnapshot().environments).toHaveLength(2); await f.client.stop();
  });

  it("prevents replacement after failed cleanup and supports an explicit retry", async () => {
    const f = fixture(); await f.client.start();
    vi.mocked(f.owners[0].adapter.dispose).mockRejectedValueOnce(new Error("private-token"));
    await expect(f.client.stop()).rejects.toThrow("could not close");
    expect(f.makeAdapter).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.client.getSnapshot())).not.toContain("private-token");
    await f.client.retry(); expect(f.makeAdapter).toHaveBeenCalledTimes(2); await f.client.stop();
  });

  it("keeps durable selection until a successful write and preserves corrupt selection", async () => {
    const f = fixture(); f.values.set(MANAGED_SELECTION_KEY, selected("one")); await f.client.start();
    vi.mocked(f.storage.setItem).mockRejectedValueOnce(new Error("secret"));
    await expect(f.client.select("two")).rejects.toThrow("previous selection was preserved");
    expect(f.client.getSnapshot().selectedEnvironmentId).toBe("one"); expect(f.values.get(MANAGED_SELECTION_KEY)).toBe(selected("one"));
    await f.client.select("two"); expect(f.client.getSnapshot().selectedEnvironmentId).toBe("two"); await f.client.stop();
    f.values.set(MANAGED_SELECTION_KEY, "unreadable-secret"); await f.client.start();
    expect(f.client.getSnapshot().selectedEnvironmentId).toBeUndefined();
    expect(f.values.get(MANAGED_SELECTION_KEY)).toBe("unreadable-secret");
    expect(JSON.stringify(f.client.getSnapshot())).not.toContain("unreadable-secret");
    expect(f.storage.removeItem).not.toHaveBeenCalled(); await f.client.stop();
  });

  it("never replaces a missing saved workspace with the first catalog row", async () => {
    const f = fixture(); f.values.set(MANAGED_SELECTION_KEY, selected("missing")); await f.client.start();
    expect(f.client.getSnapshot().selectedEnvironmentId).toBeUndefined(); expect(f.client.getSnapshot().error).toContain("unavailable");
    expect(f.storage.setItem).not.toHaveBeenCalled(); await f.client.stop();
  });

  it("does not replay consumed pairing codes when selection persistence fails", async () => {
    const f = fixture(); await f.client.start();
    vi.mocked(f.storage.setItem).mockRejectedValueOnce(new Error("secret-code"));
    await expect(f.client.pair({ address: "https://example.com?token=secret", pairingCode: "secret-code" })).resolves.toBeUndefined();
    expect(f.owners[0].adapter.pair).toHaveBeenCalledTimes(1);
    expect(f.client.getSnapshot().error).toContain("Workspace paired");
    expect(JSON.stringify(f.client.getSnapshot())).not.toContain("secret");
    await f.client.select("one"); expect(f.owners[0].adapter.pair).toHaveBeenCalledTimes(1); await f.client.stop();
  });

  it("serializes mutations and skips queued commands after retirement", async () => {
    const f = fixture(); await f.client.start(); const pending = deferred();
    vi.mocked(f.owners[0].adapter.setEnabled).mockImplementationOnce(() => pending.promise);
    const first = f.client.disconnect("one"), second = f.client.disconnect("two");
    await vi.waitFor(() => expect(f.owners[0].adapter.setEnabled).toHaveBeenCalledTimes(1));
    const stop = f.client.stop(); pending.resolve(); await Promise.all([first, second, stop]);
    expect(f.owners[0].adapter.setEnabled).toHaveBeenCalledTimes(1);
  });

  it("waits for a retired selection write before loading a new owner's intent", async () => {
    const f = fixture(); await f.client.start(); const write = deferred();
    vi.mocked(f.storage.setItem).mockImplementationOnce(async (key, value) => { await write.promise; f.values.set(key, value); });
    const selection = f.client.select("two"); await vi.waitFor(() => expect(f.storage.setItem).toHaveBeenCalledTimes(1));
    expect(f.client.getSnapshot().selectedEnvironmentId).toBeUndefined();
    const stop = f.client.stop(), restart = f.client.start(); await Promise.resolve();
    expect(f.makeAdapter).toHaveBeenCalledTimes(1); write.resolve(); await Promise.all([selection, stop, restart]);
    expect(f.client.getSnapshot().selectedEnvironmentId).toBe("two"); await f.client.stop();
  });

  it("rejects unknown commands and contains observer/listener failures", async () => {
    const f = fixture(); await f.client.start(); const owner = f.owners[0];
    f.client.subscribe(() => { throw new Error("view error"); });
    await expect(f.client.connect("unknown")).rejects.toThrow("Could not connect"); expect(owner.adapter.setEnabled).not.toHaveBeenCalled();
    owner.events!.unavailable("one"); expect(f.client.getSnapshot().environments[0].phase).toBe("blocked");
    await expect(f.client.connect("one")).rejects.toThrow("Retry loading"); await f.client.select("one");
    owner.events!.catalog(catalog(["two"])); owner.events!.shell("one", shell("live"));
    expect(f.client.getSnapshot().environments.map(row => row.environmentId)).toEqual(["two"]); await f.client.stop();
  });
});
