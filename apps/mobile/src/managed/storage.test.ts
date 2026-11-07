import { describe, expect, it, vi } from "vitest";
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));
import { EnvironmentId } from "@t3tools/contracts";
import {
  BearerConnectionCredential, BearerConnectionProfile, BearerConnectionRegistration, BearerConnectionTarget,
  CredentialStore, ProfileStore, PullRequestRoutingPermissions, RelayConnectionRegistration, RelayConnectionTarget,
  connectionRegistrationCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import { Persistence } from "@t3tools/client-runtime/platform";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as SecureStore from "expo-secure-store";
import { MANAGED_CATALOG_KEY, type ManagedSecureStorage } from "./catalog";
import { makeManagedStorageLayer, nativeManagedSecureStorage } from "./storage";

function backing() {
  const values = new Map<string, string>(); let failed = false;
  const storage: ManagedSecureStorage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { if (failed) throw new Error("private-bearer-secret"); values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  return { storage, values, fail: (value: boolean) => { failed = value; } };
}
function registration(id = "fixture") {
  const environmentId = EnvironmentId.make(id), connectionId = `bearer:${id}:https://host.test`;
  return new BearerConnectionRegistration({
    target: new BearerConnectionTarget({ environmentId, label: id, connectionId }),
    profile: new BearerConnectionProfile({ environmentId, label: id, connectionId, httpBaseUrl: "https://host.test", wsBaseUrl: "wss://host.test/ws" }),
    credential: new BearerConnectionCredential({ token: "first-token" }),
  });
}

describe("managed storage services", () => {
  it("persists registration, credential replacement, profiles and enabled state across runtimes", async () => {
    const { storage } = backing(); const runtime = ManagedRuntime.make(makeManagedStorageLayer(storage)); const reg = registration();
    try {
      await runtime.runPromise(Effect.gen(function* () {
        const registrations = yield* Persistence.ConnectionRegistrationStore;
        yield* registrations.register(reg, [reg.target]);
        yield* registrations.setEnabled(reg.target.environmentId, false);
        yield* (yield* CredentialStore.ConnectionCredentialStore).put(reg.target.connectionId, new BearerConnectionCredential({ token: "replacement" }));
        yield* (yield* ProfileStore.ConnectionProfileStore).put(new BearerConnectionProfile({ ...reg.profile, label: "renamed" }));
      }));
    } finally { await runtime.dispose(); }
    const fresh = ManagedRuntime.make(makeManagedStorageLayer(storage));
    try {
      await fresh.runPromise(Effect.gen(function* () {
        const targets = yield* Persistence.ConnectionTargetStore;
        expect((yield* targets.list).map(value => value.environmentId)).toEqual([reg.target.environmentId]);
        expect(yield* targets.listDisabled).toEqual([reg.target.environmentId]);
        expect(Option.getOrThrow(yield* (yield* CredentialStore.ConnectionCredentialStore).get(reg.target.connectionId)).token).toBe("replacement");
        expect(Option.getOrThrow(yield* (yield* ProfileStore.ConnectionProfileStore).get(reg.target.connectionId)).label).toBe("renamed");
        yield* (yield* Persistence.ConnectionRegistrationStore).remove(reg.target.environmentId);
        expect(yield* targets.list).toEqual([]); expect(yield* targets.listDisabled).toEqual([]);
        expect(Option.isNone(yield* (yield* CredentialStore.ConnectionCredentialStore).get(reg.target.connectionId))).toBe(true);
        expect(Option.isNone(yield* (yield* ProfileStore.ConnectionProfileStore).get(reg.target.connectionId))).toBe(true);
      }));
    } finally { await fresh.dispose(); }
  });

  it("failed routing/registration writes leave grants and prior credentials intact", async () => {
    const store = backing(), runtime = ManagedRuntime.make(makeManagedStorageLayer(store.storage)), reg = registration();
    try {
      await runtime.runPromise(Effect.gen(function* () {
        const registrations = yield* Persistence.ConnectionRegistrationStore;
        yield* registrations.register(reg, [reg.target]); const saved = store.values.get(MANAGED_CATALOG_KEY);
        const routing = yield* PullRequestRoutingPermissions, entry = connectionRegistrationCatalogEntry(reg);
        store.fail(true);
        const denied = yield* Effect.flip(routing.set(entry, "read-write"));
        expect(JSON.stringify(denied) + String(denied)).not.toContain("private-bearer-secret");
        expect(yield* routing.get(entry)).toBe("off");
        yield* Effect.flip(registrations.register(new BearerConnectionRegistration({ ...reg, credential: new BearerConnectionCredential({ token: "failed-replacement" }) }), [reg.target]));
        expect(Option.getOrThrow(yield* (yield* CredentialStore.ConnectionCredentialStore).get(reg.target.connectionId)).token).toBe("first-token");
        expect(store.values.get(MANAGED_CATALOG_KEY)).toBe(saved);
        store.fail(false); yield* routing.set(entry, "read"); expect(yield* routing.get(entry)).toBe("read");
        yield* routing.forget(reg.target.environmentId); expect(yield* routing.get(entry)).toBe("off");
      }));
    } finally { await runtime.dispose(); }
  });

  it("retains DPoP access only for registered relay routes and clears it when forgotten", async () => {
    const { storage } = backing(), runtime = ManagedRuntime.make(makeManagedStorageLayer(storage)), environmentId = EnvironmentId.make("relay-fixture");
    const token = new TokenStore.RemoteDpopAccessToken({ environmentId, label: "relay", endpoint: { httpBaseUrl: "https://host.test", wsBaseUrl: "wss://host.test/ws", providerKind: "manual" }, accessToken: "dpop-secret", expiresAtEpochMs: 123456, dpopThumbprint: "thumbprint" });
    try {
      await runtime.runPromise(Effect.gen(function* () {
        const tokens = yield* TokenStore.RemoteDpopAccessTokenStore;
        yield* tokens.put(token); expect(Option.isNone(yield* tokens.get(environmentId))).toBe(true);
        const registrations = yield* Persistence.ConnectionRegistrationStore, target = new RelayConnectionTarget({ environmentId, label: "relay" });
        yield* registrations.register(new RelayConnectionRegistration({ target }), [target]);
        yield* tokens.put(token); expect(Option.getOrThrow(yield* tokens.get(environmentId)).accessToken).toBe("dpop-secret");
        yield* tokens.remove(environmentId); expect(Option.isNone(yield* tokens.get(environmentId))).toBe(true);
        yield* tokens.put(token); yield* registrations.remove(environmentId); expect(Option.isNone(yield* tokens.get(environmentId))).toBe(true);
      }));
    } finally { await runtime.dispose(); }
  });

  it("uses native keychain storage without web/local-memory credential fallback", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("saved");
    expect(await nativeManagedSecureStorage.getItem(MANAGED_CATALOG_KEY)).toBe("saved");
    await nativeManagedSecureStorage.setItem(MANAGED_CATALOG_KEY, "encoded");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(MANAGED_CATALOG_KEY, "encoded", { keychainAccessible: 1 });
    await nativeManagedSecureStorage.removeItem(MANAGED_CATALOG_KEY);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(MANAGED_CATALOG_KEY);
    vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("locked"));
    await expect(nativeManagedSecureStorage.getItem(MANAGED_CATALOG_KEY)).rejects.toThrow("locked");
  });
});
