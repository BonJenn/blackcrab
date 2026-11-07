import { describe, expect, it, vi } from "vitest";
vi.mock("expo-network", () => ({}));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///native/" }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "ios", Version: "18.3", isPad: false } }));
import { ClientCapabilities } from "@t3tools/client-runtime/platform";
import { Connectivity, Wakeups } from "@t3tools/client-runtime/connection";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { makeManagedConnectionSignals, makeManagedPlatformLayer, type ManagedNetworkState } from "./platform";
import { makeManagedStorageLayer } from "./storage";

function nativeSignals() {
  const networkListeners = new Set<(state: ManagedNetworkState) => void>();
  const appListeners = new Set<(state: string) => void>();
  let time = 0;
  const network = {
    getNetworkStateAsync: vi.fn(async (): Promise<ManagedNetworkState> => ({ isConnected: true, type: "WIFI" })),
    addNetworkStateListener: (listener: (state: ManagedNetworkState) => void) => { networkListeners.add(listener); return { remove: () => { networkListeners.delete(listener); } }; },
  };
  const appState = { currentState: "active", addEventListener: (_event: "change", listener: (state: string) => void) => { appListeners.add(listener); return { remove: () => { appListeners.delete(listener); } }; } };
  return { network, appState, networkListeners, appListeners, now: () => time, advance: (value: number) => { time += value; }, networkEvent: (state: ManagedNetworkState) => { for (const listener of networkListeners) listener(state); }, appEvent: (state: string) => { for (const listener of appListeners) listener(state); } };
}

describe("native managed platform", () => {
  it("receives path and foreground wakeups and removes every scoped listener", async () => {
    const native = nativeSignals(), runtime = ManagedRuntime.make(makeManagedConnectionSignals(native.network, native.appState, native.now));
    const events: string[] = [], statuses: string[] = [];
    const abort = new AbortController();
    const wakeups = runtime.runPromise(Effect.gen(function* () { const service = yield* Wakeups.ConnectionWakeups; yield* Stream.runForEach(service.changes, event => Effect.sync(() => { events.push(event); })); }), { signal: abort.signal }).catch(() => undefined);
    const changes = runtime.runPromise(Effect.gen(function* () { const service = yield* Connectivity.Connectivity; yield* Stream.runForEach(service.changes, event => Effect.sync(() => { statuses.push(event); })); }), { signal: abort.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(native.networkListeners.size).toBe(2));
    native.networkEvent({ isConnected: true, type: "WIFI" });
    native.networkEvent({ isConnected: false, type: "NONE" });
    native.networkEvent({ isConnected: true, type: "CELLULAR" });
    native.appEvent("background"); native.advance(11_000); native.appEvent("active"); native.appEvent("active");
    await vi.waitFor(() => expect(events).toEqual(["network-changed", "application-active-long", "application-active-probe"]));
    expect(statuses).toContain("offline");
    const retired = [...native.networkListeners];
    abort.abort(); await Promise.all([wakeups, changes]); await runtime.dispose();
    expect(native.networkListeners.size).toBe(0); expect(native.appListeners.size).toBe(0);
    const count = events.length; for (const listener of retired) listener({ isConnected: true, type: "WIFI" });
    await Promise.resolve(); expect(events).toHaveLength(count);
  });

  it("reports unknown on native query failure and cleans up partial listener setup", async () => {
    const native = nativeSignals();
    native.network.getNetworkStateAsync.mockRejectedValue(Error("native-secret"));
    const runtime = ManagedRuntime.make(makeManagedConnectionSignals(native.network, { ...native.appState, addEventListener: () => { throw Error("native-secret"); } }));
    try {
      const status = await runtime.runPromise(Effect.gen(function* () { return yield* (yield* Connectivity.Connectivity).status; }));
      expect(status).toBe("unknown");
      await expect(runtime.runPromise(Effect.gen(function* () { yield* Stream.runDrain((yield* Wakeups.ConnectionWakeups).changes); }))).rejects.toThrow("Native connection events are unavailable");
      expect(native.networkListeners.size).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("offers honest native metadata and disabled identities without requests or fake keys", async () => {
    const native = nativeSignals(), fetch = vi.fn(async () => new Response());
    const runtime = ManagedRuntime.make(makeManagedPlatformLayer({ ...native, fetch,
      storageLayer: makeManagedStorageLayer({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }),
      cacheBackend: { read: async () => null, write: async () => {}, remove: async () => {}, clear: async () => {} },
    }));
    try {
      await runtime.runPromise(Effect.gen(function* () {
        expect(Option.isNone(yield* (yield* ClientCapabilities.CloudSession).identity)).toBe(true);
        expect(Option.isNone(yield* (yield* ClientCapabilities.RelayDeviceIdentity).deviceId)).toBe(true);
        expect(Option.isNone(yield* (yield* ClientCapabilities.PrimaryEnvironmentAuth).bearerToken)).toBe(true);
        expect((yield* ClientCapabilities.ClientPresentation).metadata).toMatchObject({ label: "Blackcrab Remote", os: "iOS", surface: "mobile" });
        expect((yield* Effect.flip((yield* ClientCapabilities.CloudSession).clerkToken)).reason).toBe("authentication");
        expect((yield* Effect.flip((yield* ManagedRelay.ManagedRelayDpopSigner).thumbprint))._tag).toBe("ManagedRelayDpopKeyLoadError");
        const relay = yield* ManagedRelay.ManagedRelayClient;
        const disabled = yield* Effect.flip(relay.listEnvironments({ clerkToken: "must-never-be-transmitted" }));
        expect(disabled._tag).toBe("ManagedRelayUrlInvalidError");
        expect(JSON.stringify(disabled)).not.toContain("must-never-be-transmitted");
      }));
      expect(fetch).not.toHaveBeenCalled();
    } finally { await runtime.dispose(); }
  });
});
