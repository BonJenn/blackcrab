import * as fs from "node:fs";
import * as path from "node:path";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Pool from "../backend/DesktopBackendPool.ts";
import * as Manager from "../backend/DesktopBackendManager.ts";
import * as Configuration from "../backend/DesktopBackendConfiguration.ts";
import * as Window from "../window/DesktopWindow.ts";
import * as State from "./DesktopState.ts";
import * as UpdatePolicy from "../updates/DesktopUpdatePolicy.ts";
import { readDescriptor, inspectProfile, NAMESPACE } from "./managed-desktop/descriptor.mjs";
import { createAttachment } from "./managed-desktop/attachment.mjs";

import * as ManagedBrowser from "./ManagedBrowser.ts";
import { descriptor } from "./ManagedBootstrap.mjs";
const root = descriptor.profile.root;
const config: Manager.DesktopBackendStartConfig = {
 executablePath: "OWNER_CONTROL_REQUIRED", entryPath: "OWNER_CONTROL_REQUIRED", cwd: root,
 httpBaseUrl: new URL(descriptor.owner.origin), args: [], env: {}, extendEnv: false,
 bootstrapDelivery: "fd3", captureOutput: false, preflightFailure: Option.none(),
 bootstrap: { mode: "desktop", noBrowser: true, host: "127.0.0.1", port: Number(new URL(descriptor.owner.origin).port), t3Home: root, desktopBootstrapToken: "", shellEnvironmentPrepared: true, tailscaleServeEnabled: false, tailscaleServePort: 443 },
};
export const layerConfiguration = Layer.succeed(Configuration.DesktopBackendConfiguration, Configuration.DesktopBackendConfiguration.of({ resolvePrimary: Effect.succeed(config), resolveWsl: () => Effect.die("OwnerControl unavailable: WSL ownership"), resolvePrimaryLabel: Effect.succeed("Blackcrab managed host"), currentBootstrapToken: Effect.die("Use original secret-authenticated DesktopLocalEnvironmentAuth") }));
export const layerUpdatePolicy = Layer.succeed(UpdatePolicy.DesktopUpdatePolicy, { mode: "off", feedUrl: undefined, allowNightly: false, message: "Blackcrab distribution/update owner control is not configured." });
export const layerPool = Layer.effect(Pool.DesktopBackendPool, Effect.gen(function* () {
 const window = yield* Window.DesktopWindow, state = yield* State.DesktopState;
 const browser=yield* ManagedBrowser.make;
 const context = yield* Effect.context<Window.DesktopWindow | State.DesktopState>();
 const run = Effect.runPromiseWith(context);
 const attachment = createAttachment({ verify: async () => {
  const response = await fetch(new URL(".well-known/t3/environment", descriptor.owner.origin), { redirect: "manual", signal: AbortSignal.timeout(10000) });
  const identity = await response.json();
  if (!response.ok || identity.environmentId !== descriptor.owner.environmentId || identity.serverVersion !== descriptor.owner.serverVersion || identity.orchestrationProtocolVersion !== 2) throw Error("Managed desktop host identity changed");
  // A host must explicitly support our own renderer origin before privileged UI opens.
  const cors = await fetch(new URL("oauth/token", descriptor.owner.origin), { method: "OPTIONS", headers: { Origin: "blackcrab://app", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
  if (!cors.ok || cors.headers.get("access-control-allow-origin") !== "blackcrab://app") throw Error("Managed host does not permit the Blackcrab renderer origin");
 }, onDetach:()=>browser.stop(), onReady: async () => { browser.start(); try { await run(window.handleBackendReady(config.httpBaseUrl)); await run(SubscriptionRef.set(state.primaryBackendStartup, { _tag: "Ready" })); } catch(error) { browser.stop(); throw error; } } });
 const primary: Pool.DesktopBackendInstance = { id: Manager.PRIMARY_INSTANCE_ID, label: Effect.succeed("Blackcrab managed host (attached)"), start: Effect.promise(() => attachment.start()), stop: () => Effect.sync(() => attachment.stop()), currentConfig: Effect.succeed(Option.some(config)), snapshot: Effect.sync(() => ({ desiredRunning: attachment.ready, ready: attachment.ready, activePid: Option.none(), restartAttempt: 0, restartScheduled: false })), waitForReady: () => Effect.sync(() => attachment.ready) };
 return Pool.DesktopBackendPool.of({ primary: Effect.succeed(primary), list: Effect.succeed([primary]), get: id => Effect.succeed(id === primary.id ? Option.some(primary) : Option.none()), register: () => Effect.die("OwnerControl unavailable: additional backend ownership"), unregister: () => Effect.die("OwnerControl unavailable: backend ownership") });
}));
