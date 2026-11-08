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
vi.mock("expo-network", () => ({}));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///unused/" }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "ios", Version: "18", isPad: false } }));
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
import { makeManagedPlatformLayer } from "../apps/mobile/src/managed/platform";
import { makeManagedStorageLayer } from "../apps/mobile/src/managed/storage";

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

describe.skipIf(!enabled)("managed packaged-host thread acceptance", () => {
  it("deduplicates commands, enforces read-only grants and retains thread metadata through host restart", async () => {
    const executable = process.env.BLACKCRAB_MANAGED_HOST_PATH;
    if (!executable) throw Error("Set BLACKCRAB_MANAGED_HOST_PATH to a verified packaged executable.");
    const root = await realpath(await mkdtemp(join(tmpdir(), "blackcrab-managed-acceptance-")));
    const project = join(root, "project"), data = join(root, "state"), home = join(root, "home"), temporary = join(root, "tmp");
    for (const folder of [project, data, home, temporary]) await mkdir(folder);
    const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: temporary, CI: "1", NODE_ENV: "production" as const, OTEL_SDK_DISABLED: "true", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const port = await freePort(), address = `http://127.0.0.1:${port}`;
    let host: ChildProcess | undefined, writer: ReturnType<typeof client> | undefined, reader: ReturnType<typeof client> | undefined;
    const writerStorage = new Map<string, string>(), readerStorage = new Map<string, string>();
    const report: Record<string, unknown> = { passed: false, providerTurns: 0, root };
    let starts = 0;
    let bootstrapCredential = "";
    async function start() {
      starts++;
      bootstrapCredential = randomUUID();
      host = spawn(resolve(executable!), ["serve", "--mode", "web", "--host", "127.0.0.1", "--port", String(port), "--base-dir", data, "--no-browser", "--bootstrap-fd", "3"], { cwd: project, env, detached: true, stdio: ["ignore", "pipe", "pipe", "pipe"] });
      host.stdio[3]!.on("error", () => {});
      (host.stdio[3] as import("node:stream").Writable).end(JSON.stringify({ mode: "desktop", noBrowser: true, port, t3Home: data, host: "127.0.0.1", desktopBootstrapToken: bootstrapCredential, shellEnvironmentPrepared: true, tailscaleServeEnabled: false, tailscaleServePort: 443 }) + "\n");
      let output = "";
      const capture = (bytes: Buffer) => { output = (output + bytes.toString("utf8")).slice(-128_000); };
      host.stdout!.on("data", capture); host.stderr!.on("data", capture);
      host.once("close", () => { void writeFile(join(root, `host-${starts}.log`), output, { mode: 0o600 }); });
      await vi.waitFor(async () => { expect(host?.exitCode).toBeNull(); expect((await fetch(address + "/.well-known/t3/environment", { signal: AbortSignal.timeout(1_000) })).ok).toBe(true); }, { timeout: 60_000, interval: 100 });
      return (await (await fetch(address + "/.well-known/t3/environment")).json()).environmentId;
    }
    async function pairing(scopes: string[]) {
      const result = await execute(resolve(executable!), ["pair", "--base-dir", data, "--label", "Blackcrab acceptance", ...scopes.flatMap(scope => ["--scope", scope])], { cwd: project, env, timeout: 30_000, maxBuffer: 1_000_000 });
      const url = result.stdout.match(/https?:\/\/[^\s\u001b]+\/pair#[^\s\u001b]+/)?.[0];
      if (!url) throw Error("No private fixture pairing URL.");
      return url;
    }
    async function ownerProbeToken() {
      const response = await fetch(address + "/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token: bootstrapCredential,
          subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
          scope: "orchestration:read",
          client_label: "Blackcrab owner probe fixture",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw Error("Private owner probe exchange failed.");
      const result = await response.json();
      if (typeof result.access_token !== "string" || !result.access_token) throw Error("Private owner probe token missing.");
      return result.access_token as string;
    }
    const authenticatedSession = async (token: string) => {
      const response = await fetch(address + "/api/auth/session", {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw Error("Private fixture session check failed.");
      return (await response.json()).authenticated;
    };
    try {
      const identity = await start();
      await execute(resolve(executable!), ["project", "add", project, "--title", "Acceptance fixture", "--base-dir", data], { cwd: project, env, timeout: 30_000, maxBuffer: 1_000_000 });
      writer = client(writerStorage); let services = await writer.services();
      const id = await writer.runtime.runPromise(services.onboarding.registerPairing({ pairingUrl: await pairing(["orchestration:read", "orchestration:operate"]) }));
      const connected = () => vi.waitFor(async () => expect((await writer!.runtime.runPromise(services.registry.state(id))).phase).toBe("connected"), { timeout: 30_000, interval: 100 });
      await connected();
      const shell = await writer.runtime.runPromise(services.registry.run(id, makeEnvironmentShellState()).pipe(Effect.provideService(Scope.Scope, writer.scope)));
      let projectId: string | undefined;
      await vi.waitFor(async () => { const state = await writer!.runtime.runPromise(SubscriptionRef.get(shell)); expect(state.status).toBe("live"); projectId = Option.isSome(state.snapshot) ? state.snapshot.value.projects.find(p => p.workspaceRoot === project)?.id : undefined; expect(projectId).toBeTruthy(); }, { timeout: 30_000 });
      const threadId = Schema.decodeUnknownSync(ThreadId)(randomUUID()), commandId = randomUUID();
      const create = decode({ type: "thread.create", commandId, threadId, projectId, title: "Acceptance draft", modelSelection: { instanceId: "codex", model: "gpt-5-codex" }, runtimeMode: "full-access", interactionMode: "default", branch: null, worktreePath: null, createdBy: "user", creationSource: "mobile" });
      const dispatch = (command: ReturnType<typeof decode>) => writer!.runtime.runPromise(services.registry.run(id, Rpc.requestGuarded(methods.dispatchCommand, command)).pipe(Effect.timeout("15 seconds")));
      const first = await dispatch(create); expect(await dispatch(create)).toEqual(first); report.commandDeduplication = true;
      const projection = () => writer!.runtime.runPromise(services.registry.run(id, Rpc.request(methods.getThreadProjection, { threadId })).pipe(Effect.timeout("15 seconds")));
      const catalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument))(writerStorage.get(MANAGED_CATALOG_KEY)!);
      const pairedToken = catalog.credentials[0]?.credential.token;
      if (!pairedToken) throw Error("Private paired fixture session missing.");
      expect(await authenticatedSession(pairedToken)).toBe(true);
      const firstOwnerToken = await ownerProbeToken();
      expect(await authenticatedSession(firstOwnerToken)).toBe(true);
      const secondOwnerToken = await ownerProbeToken();
      expect(await authenticatedSession(secondOwnerToken)).toBe(true);
      expect(await authenticatedSession(firstOwnerToken)).toBe(false);
      expect(await authenticatedSession(pairedToken)).toBe(true);
      expect((await projection()).thread.id).toBe(threadId);
      report.independentPairedSessionSurvivesOwnerProbeRotation = true;
      await dispatch(decode({ type: "thread.metadata.update", commandId: randomUUID(), threadId, title: "Acceptance retained", expectedEmpty: true }));
      await dispatch(decode({ type: "thread.archive", commandId: randomUUID(), threadId }));
      expect((await projection()).thread.archivedAt).not.toBeNull();
      await dispatch(decode({ type: "thread.unarchive", commandId: randomUUID(), threadId }));
      expect((await projection()).thread.archivedAt).toBeNull(); report.archiveRoundTrip = true;
      reader = client(readerStorage); const readServices = await reader.services();
      const readId = await reader.runtime.runPromise(readServices.onboarding.registerPairing({ pairingUrl: await pairing(["orchestration:read"]) }));
      await vi.waitFor(async () => expect((await reader!.runtime.runPromise(readServices.registry.state(readId))).phase).toBe("connected"), { timeout: 30_000 });
      const forbidden = await reader.runtime.runPromise(Effect.exit(readServices.registry.run(readId, Rpc.requestGuarded(methods.dispatchCommand, decode({ type: "thread.metadata.update", commandId: randomUUID(), threadId, title: "Must not persist" })))).pipe(Effect.timeout("15 seconds")));
      expect(Exit.isFailure(forbidden)).toBe(true);
      if (Exit.isFailure(forbidden)) expect(Cause.pretty(forbidden.cause)).toMatch(/orchestration:operate|scope|forbidden|authoriz/i);
      expect((await projection()).thread.title).toBe("Acceptance retained"); report.readOnlyMutationRejected = true;
      await reader.dispose(); reader = undefined; await writer.dispose(); writer = undefined;
      await stop(host); host = undefined;
      expect(await start()).toBe(identity);
      writer = client(writerStorage); services = await writer.services(); await connected();
      const restored = await projection(); expect(restored.thread.title).toBe("Acceptance retained"); expect(restored.thread.archivedAt).toBeNull(); expect(restored.runs).toEqual([]); expect(restored.providerSessions).toEqual([]);
      report.restartRecovery = true; report.passed = true;
    } finally {
      try { await reader?.dispose(); } finally { try { await writer?.dispose(); } finally { await stop(host); await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); } }
      console.log(`Private acceptance evidence: ${join(root, "report.json")}`);
    }
  }, 240_000);
});
