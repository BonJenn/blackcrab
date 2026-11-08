// Native platform boundaries for the pinned shared connection runtime.
// Lifecycle behavior adapted from BonJenn/t3code 7f02de2 mobile connection/platform.ts;
// upstream MIT attribution is included at vendor/t3/LICENSE.upstream.
import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import { RelayMobileClientId } from "@t3tools/contracts/relay";
import { ClientCapabilities, PlatformConnectionSource } from "@t3tools/client-runtime/platform";
import { ConnectionBlockedError, Connectivity, Wakeups } from "@t3tools/client-runtime/connection";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import * as Network from "expo-network";
import { AppState, Platform } from "react-native";
import mobilePackage from "../../package.json";
import { makeManagedCacheLayer, type ManagedCacheBackend } from "./cache";
import { makeManagedStorageLayer } from "./storage";

export interface ManagedNetworkState { readonly isConnected?: boolean; readonly type?: string }
interface Subscription { remove(): void }
export interface ManagedNetwork {
  getNetworkStateAsync(): Promise<ManagedNetworkState>;
  addNetworkStateListener(listener: (state: ManagedNetworkState) => void): Subscription;
}
export interface ManagedAppState {
  readonly currentState: string | null | undefined;
  addEventListener(event: "change", listener: (state: string) => void): Subscription;
}
export interface ManagedPlatformOptions {
  readonly storageLayer?: ReturnType<typeof makeManagedStorageLayer>;
  readonly cacheBackend?: ManagedCacheBackend;
  readonly fetch?: typeof globalThis.fetch;
  readonly network?: ManagedNetwork;
  readonly appState?: ManagedAppState;
  readonly now?: () => number;
  readonly presentation?: AuthClientPresentationMetadata;
}
function networkStatus(state: ManagedNetworkState): "unknown" | "online" | "offline" {
  return state.isConnected === false ? "offline" : state.isConnected === true ? "online" : "unknown";
}
export function applicationActiveWakeup(backgroundedAt: number | null, now: number): "application-active-probe" | "application-active-long" {
  return backgroundedAt !== null && now - backgroundedAt >= 10_000 ? "application-active-long" : "application-active-probe";
}

/** Streams own every native listener and ignore retired asynchronous network reads. */
export function makeManagedConnectionSignals(network: ManagedNetwork = Network, appState: ManagedAppState = AppState, now: () => number = Date.now) {
  const connectivity = Connectivity.layer({
    status: Effect.tryPromise({ try: () => network.getNetworkStateAsync(), catch: () => undefined }).pipe(Effect.match({ onFailure: () => "unknown" as const, onSuccess: networkStatus })),
    changes: Stream.callback<"unknown" | "online" | "offline">(queue => Effect.acquireRelease(
      Effect.sync(() => {
        let active = true; const subscriptions: Subscription[] = [];
        const remove = () => { active = false; for (const subscription of subscriptions) { try { subscription.remove(); } catch { /* Retired callbacks are still fenced. */ } } };
        try {
          subscriptions.push(network.addNetworkStateListener(state => { if (active) Queue.offerUnsafe(queue, networkStatus(state)); }));
          subscriptions.push(appState.addEventListener("change", state => {
            if (state !== "active" || !active) return;
            void Promise.resolve().then(() => network.getNetworkStateAsync()).then(current => { if (active) Queue.offerUnsafe(queue, networkStatus(current)); }).catch(() => undefined);
          }));
          return { remove };
        } catch { remove(); throw new Error("Native connection events are unavailable."); }
      }),
      subscription => Effect.sync(subscription.remove),
    ).pipe(Effect.asVoid)),
  });
  const wakeups = Wakeups.layer({
    changes: Stream.callback<Wakeups.ConnectionWakeup>(queue => Effect.acquireRelease(
      Effect.sync(() => {
        let active = true, previousType: string | undefined;
        let backgroundedAt = appState.currentState === "background" ? now() : null;
        const subscriptions: Subscription[] = [];
        const remove = () => { active = false; for (const subscription of subscriptions) { try { subscription.remove(); } catch { /* Retired callbacks are still fenced. */ } } };
        try {
          subscriptions.push(network.addNetworkStateListener(state => {
            if (!active) return;
            const type = state.isConnected === true ? state.type : undefined;
            if (previousType !== undefined && type !== undefined && previousType !== type) Queue.offerUnsafe(queue, "network-changed");
            previousType = type ?? previousType;
          }));
          subscriptions.push(appState.addEventListener("change", state => {
            if (!active) return;
            if (state === "background") backgroundedAt = now();
            else if (state === "active") { Queue.offerUnsafe(queue, applicationActiveWakeup(backgroundedAt, now())); backgroundedAt = null; }
          }));
          void Promise.resolve().then(() => network.getNetworkStateAsync()).then(state => {
            if (active && previousType === undefined && state.isConnected === true) previousType = state.type;
          }).catch(() => undefined);
          return { remove };
        } catch { remove(); throw new Error("Native connection events are unavailable."); }
      }),
      subscription => Effect.sync(subscription.remove),
    ).pipe(Effect.asVoid)),
  });
  return Layer.merge(connectivity, wakeups);
}

function nativePresentation(): AuthClientPresentationMetadata {
  const osMajorVersion = Number.parseInt(String(Platform.Version), 10);
  return {
    label: "Blackcrab Remote", surface: "mobile", appVersion: mobilePackage.version,
    deviceType: Platform.OS === "ios" && Platform.isPad ? "tablet" : "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
    ...(Number.isFinite(osMajorVersion) && osMajorVersion > 0 ? { osMajorVersion } : {}),
  };
}

export function makeManagedPlatformLayer(options: ManagedPlatformOptions = {}) {
  const http = layerRemoteHttpClient(options.fetch ?? globalThis.fetch);
  const capabilities = Layer.succeedContext(Context.make(ClientCapabilities.CloudSession, ClientCapabilities.CloudSession.of({
    identity: Effect.succeedNone,
    clerkToken: Effect.fail(new ConnectionBlockedError({ reason: "authentication", detail: "Managed cloud relay is not configured." })),
  })).pipe(
    Context.add(ClientCapabilities.PrimaryEnvironmentAuth, { bearerToken: Effect.succeedNone }),
    Context.add(ClientCapabilities.RelayDeviceIdentity, { deviceId: Effect.succeedNone }),
    Context.add(ClientCapabilities.ClientPresentation, { metadata: options.presentation ?? nativePresentation() }),
    Context.add(ClientCapabilities.SshEnvironmentGateway, {
      provision: () => Effect.fail(new ConnectionBlockedError({ reason: "unsupported", detail: "SSH connections are not available in this mobile app." })),
      prepare: () => Effect.fail(new ConnectionBlockedError({ reason: "unsupported", detail: "SSH connections are not available in this mobile app." })),
      disconnect: () => Effect.void,
    }),
  ));
  const signer = Layer.succeed(ManagedRelay.ManagedRelayDpopSigner, {
    thumbprint: Effect.fail(new ManagedRelay.ManagedRelayDpopKeyLoadError({ keyStore: "expo-secure-store", cause: new Error("Managed relay is not configured.") })),
    createProof: input => Effect.fail(new ManagedRelay.ManagedRelayDpopProofCreationError({ method: input.method, url: "unconfigured", cause: new Error("Managed relay is not configured.") })),
  });
  const relay = ManagedRelay.layer({ relayUrl: "http://relay.invalid", clientId: RelayMobileClientId }).pipe(Layer.provideMerge(Layer.merge(http, signer)));
  return Layer.mergeAll(
    options.storageLayer ?? makeManagedStorageLayer(),
    makeManagedCacheLayer(options.cacheBackend),
    capabilities,
    Layer.succeed(PlatformConnectionSource.PlatformConnectionSource, { registrations: Stream.empty }),
    makeManagedConnectionSignals(options.network, options.appState, options.now),
    http,
    Socket.layerWebSocketConstructorGlobal,
    relay,
  );
}
