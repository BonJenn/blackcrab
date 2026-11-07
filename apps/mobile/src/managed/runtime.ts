import type { EnvironmentId as EnvironmentIdType } from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import {
  Connection,
  ConnectionOnboarding,
  EnvironmentRegistry,
  type ConnectionCatalogEntry,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  makeEnvironmentShellState,
  ShellSnapshotLoader,
  type EnvironmentShellState,
} from "@t3tools/client-runtime/state/shell";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { makeManagedPlatformLayer } from "./platform";

export interface ManagedRuntimeEvents {
  catalog(entries: ReadonlyMap<EnvironmentIdType, ConnectionCatalogEntry>): void;
  connection(environmentId: string, state: SupervisorConnectionState): void;
  shell(environmentId: string, state: EnvironmentShellState): void;
  unavailable(environmentId?: string): void;
}
export interface ManagedRuntimeAdapter {
  start(events: ManagedRuntimeEvents): Promise<void>;
  pair(input: { address: string; pairingCode: string }): Promise<string>;
  setEnabled(environmentId: string, enabled: boolean): Promise<void>;
  remove(environmentId: string): Promise<void>;
  retry(environmentId: string): Promise<void>;
  dispose(): Promise<void>;
}
const decodeEnvironmentId = Schema.decodeUnknownSync(EnvironmentId);
function runtimeLayer(options?: Parameters<typeof makeManagedPlatformLayer>[0]) {
  return ShellSnapshotLoader.layer.pipe(
    Layer.provideMerge(Connection.layerWithOptions({
      usageLimitSources: true, usageLimitsCommand: true, providerCatalogsOnDemand: true,
    })),
    Layer.provideMerge(makeManagedPlatformLayer(options)),
  );
}

/** One shared service/receipt/event implementation; native ownership is outside this adapter. */
export function createManagedRuntimeAdapter(options?: Parameters<typeof makeManagedPlatformLayer>[0]): ManagedRuntimeAdapter {
  const runtime = ManagedRuntime.make(runtimeLayer(options));
  let registry: EnvironmentRegistry.EnvironmentRegistry["Service"] | null = null;
  let onboarding: ConnectionOnboarding.ConnectionOnboarding["Service"] | null = null;
  let retired = false;
  let observer: Fiber.Fiber<void, unknown> | null = null;
  const watches = new Map<string, { token: symbol; fiber?: Fiber.Fiber<void, unknown> }>();
  let disposal: Promise<void> | undefined;
  let startup: Promise<void> | undefined;
  return {
    start(events) {
      if (retired) return Promise.reject(new Error("Managed environments are not ready."));
      if (startup) return startup;
      startup = (async () => {
      const services = await runtime.runPromise(Effect.gen(function* () {
        return {
          registry: yield* EnvironmentRegistry.EnvironmentRegistry,
          onboarding: yield* ConnectionOnboarding.ConnectionOnboarding,
        };
      }));
      if (retired) return;
      registry = services.registry; onboarding = services.onboarding;
      const activeRegistry = services.registry;
      observer = runtime.runFork(Effect.scoped(SubscriptionRef.changes(activeRegistry.entries).pipe(
        Stream.runForEach(entries => Effect.gen(function* () {
          if (retired) return;
          events.catalog(entries);
          for (const [id, watch] of watches) {
            if (entries.has(decodeEnvironmentId(id))) continue;
            watches.delete(id); if (watch.fiber) yield* Fiber.interrupt(watch.fiber);
          }
          for (const id of entries.keys()) {
            if (watches.has(id)) continue;
            const token = Symbol(id);
            const watch: { token: symbol; fiber?: Fiber.Fiber<void, unknown> } = { token };
            watches.set(id, watch);
            const current = () => !retired && watches.get(id)?.token === token;
            const connection = activeRegistry.stateChanges(id).pipe(Stream.runForEach(state => Effect.sync(() => {
              if (current()) events.connection(id, state);
            })));
            const shell = activeRegistry.followStream(id, Stream.unwrap(
              makeEnvironmentShellState().pipe(Effect.map(SubscriptionRef.changes)),
            )).pipe(Stream.runForEach(state => Effect.sync(() => {
              if (current()) events.shell(id, state);
            })));
            const fiber = yield* Effect.all([connection, shell], { concurrency: "unbounded", discard: true }).pipe(
              Effect.catchCause(() => Effect.sync(() => { if (current()) events.unavailable(id); })),
              Effect.forkScoped,
            );
            watch.fiber = fiber;
          }
        })),
        Effect.catchCause(() => Effect.sync(() => { if (!retired) events.unavailable(); })),
      )));
      })();
      return startup;
    },
    async pair(input) {
      if (!onboarding || retired) throw new Error("Managed environments are not ready.");
      const code = input.pairingCode.trim();
      // A pairing link carries its own credential; a plain address uses the separate code.
      const request = code ? { host: input.address.trim(), pairingCode: code } : { pairingUrl: input.address.trim() };
      return runtime.runPromise(onboarding.registerPairing(request));
    },
    async setEnabled(id, enabled) {
      if (!registry || retired) throw new Error("Managed environments are not ready.");
      await runtime.runPromise(registry.setEnabled(decodeEnvironmentId(id), enabled));
    },
    async remove(id) {
      if (!registry || retired) throw new Error("Managed environments are not ready.");
      await runtime.runPromise(registry.remove(decodeEnvironmentId(id)));
    },
    async retry(id) {
      if (!registry || retired) throw new Error("Managed environments are not ready.");
      await runtime.runPromise(registry.retryNow(decodeEnvironmentId(id)));
    },
    dispose() {
      if (disposal) return disposal;
      retired = true; registry = null; onboarding = null;
      disposal = (async () => {
        if (observer) await Effect.runPromise(Fiber.interrupt(observer));
        watches.clear(); await runtime.dispose();
      })();
      return disposal;
    },
  };
}
