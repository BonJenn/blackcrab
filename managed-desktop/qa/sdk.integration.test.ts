/// <reference types="node" />
/** Actual packaged host + unchanged shared SDK; no provider session or model turn. */
import { describe, expect, it, vi } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import * as Scope from "effect/Scope";
import { OrchestrationV2Command, ORCHESTRATION_V2_WS_METHODS as methods, ThreadId } from "@t3tools/contracts";
import { Connection, ConnectionOnboarding, EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import * as Rpc from "@t3tools/client-runtime/rpc";
import { ShellSnapshotLoader, makeEnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { MANAGED_CATALOG_KEY } from "../apps/mobile/src/managed/catalog";
import { makeManagedPlatformLayer } from "@blackcrab/qa-platform";
import { makeManagedStorageLayer } from "@blackcrab/qa-storage";

const execute = promisify(execFile);
const enabled = process.env.BLACKCRAB_MANAGED_ACCEPTANCE === "1";
const decode = Schema.decodeUnknownSync(OrchestrationV2Command);
async function freePort() {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No fixture port.");
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  return address.port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>(done => child.once("close", () => done()));
  const signal = (name: NodeJS.Signals) => { try { process.kill(-child.pid!, name); } catch (error: any) { if (error.code !== "ESRCH") throw error; } };
  signal("SIGTERM"); const timer = setTimeout(() => signal("SIGKILL"), 5_000);
  try { await closed; } finally { clearTimeout(timer); }
}

function client(storage: Map<string, string>) {
  const cache = new Map<string, string>();
  const platform = makeManagedPlatformLayer({
    storageLayer: makeManagedStorageLayer({ getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); }, removeItem: async key => { storage.delete(key); } }),
    cacheBackend: { read: async key => cache.get(key) ?? null, write: async (key, value) => { cache.set(key, value); }, remove: async key => { cache.delete(key); }, clear: async prefix => { for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key); } },
    fetch: globalThis.fetch,
    network: { getNetworkStateAsync: async () => ({ isConnected: true, type: "WIFI" }), addNetworkStateListener: () => ({ remove() {} }) },
    appState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  });
  // Fixture-only bypass of the SDK's presentation permission prompt: server scopes
  // remain mandatory. The read-only test must reach and be rejected by the host.
  const layer = ShellSnapshotLoader.layer.pipe(Layer.provideMerge(Connection.layerWithOptions({ providerCatalogsOnDemand: true })), Layer.provideMerge(platform), Layer.provideMerge(Layer.succeed(Rpc.RpcPermissionGuard, { authorize: () => Effect.void })));
  const runtime = ManagedRuntime.make(layer);
  const scope = Scope.makeUnsafe();
  const services = () => runtime.runPromise(Effect.gen(function* () { return { registry: yield* EnvironmentRegistry.EnvironmentRegistry, onboarding: yield* ConnectionOnboarding.ConnectionOnboarding }; }));
  return { runtime, services, scope, dispose: async () => { await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))); await runtime.dispose(); } };
}

describe("managed native package SDK fixture",()=>{it("mutates only idle metadata through the unchanged SDK",async()=>{
 const input=JSON.parse(await (await import("node:fs/promises")).readFile(process.env.BLACKCRAB_NATIVE_QA_INPUT!,"utf8"));const writer=client(new Map());
 try{const services=await writer.services();const id=await writer.runtime.runPromise(services.onboarding.registerPairing({pairingUrl:input.pairingUrl}));await vi.waitFor(async()=>expect((await writer.runtime.runPromise(services.registry.state(id))).phase).toBe("connected"),{timeout:30000,interval:100});
 const shell=await writer.runtime.runPromise(services.registry.run(id,makeEnvironmentShellState()).pipe(Effect.provideService(Scope.Scope,writer.scope)));let projectId:string|undefined;await vi.waitFor(async()=>{const state=await writer.runtime.runPromise(SubscriptionRef.get(shell));projectId=Option.isSome(state.snapshot)?state.snapshot.value.projects.find(p=>p.workspaceRoot===input.projectRoot)?.id:undefined;expect(projectId).toBeTruthy();},{timeout:30000,interval:100});
 const threadId=input.threadId??randomUUID();if(input.mode!=="read"){const command=decode(input.mode==="update"?{type:"thread.metadata.update",commandId:randomUUID(),threadId,title:input.title,expectedEmpty:true}:{type:"thread.create",commandId:randomUUID(),threadId,projectId,title:input.title,modelSelection:{instanceId:"codex",model:"gpt-5-codex"},runtimeMode:"full-access",interactionMode:"default",branch:null,worktreePath:null,createdBy:"user",creationSource:"mobile"});await writer.runtime.runPromise(services.registry.run(id,Rpc.requestGuarded(methods.dispatchCommand,command)).pipe(Effect.timeout("15 seconds")));}
 const projection=await writer.runtime.runPromise(services.registry.run(id,Rpc.request(methods.getThreadProjection,{threadId})).pipe(Effect.timeout("15 seconds")));expect(projection.runs).toEqual([]);expect(projection.providerSessions).toEqual([]);await writeFile(input.output,JSON.stringify({environmentId:id,threadId,projectId,title:projection.thread.title,runs:projection.runs,providerSessions:projection.providerSessions}),{mode:0o600});
 }finally{await writer.dispose();}
},90000);});
