/// <reference types="node" />
/** Opt-in, actual relocated managed host + shared SDK HTTP/WebSocket integration. */
import { describe, expect, it, vi } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { promisify } from "node:util";
vi.mock("expo-network", () => ({}));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///unused/" }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "ios", Version: "18", isPad: false } }));
import * as Option from "effect/Option";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ConnectionCatalogEntry, SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { createManagedRuntimeAdapter, type ManagedRuntimeAdapter, type ManagedRuntimeEvents } from "./runtime";
import { makeManagedStorageLayer } from "./storage";
import { MANAGED_CATALOG_KEY } from "./catalog";
import type { ManagedCacheBackend } from "./cache";

const enabled = process.env.BLACKCRAB_MANAGED_HOST_INTEGRATION === "1";
const execute = promisify(execFile);
async function freePort() {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Could not allocate integration port.");
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  return address.port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(done => {
    const deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => { clearTimeout(deadline); done(); }); child.kill("SIGTERM");
  });
}
function observer() {
  let catalog: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry> = new Map();
  const connections = new Map<string, SupervisorConnectionState>(), shells = new Map<string, EnvironmentShellState>();
  const unavailable: Array<string | undefined> = [];
  const events: ManagedRuntimeEvents = {
    catalog: value => { catalog = value; }, connection: (id, value) => { connections.set(id, value); },
    shell: (id, value) => { shells.set(id, value); }, unavailable: id => { unavailable.push(id); },
  };
  return { events, catalog: () => catalog, connections, shells, unavailable };
}

describe.skipIf(!enabled)("packaged host native managed runtime integration", () => {
  it("pairs over HTTP, receives a real project over WS, persists restart and removes access", async () => {
    const executable = process.env.BLACKCRAB_MANAGED_HOST_PATH;
    if (!executable) throw Error("Set BLACKCRAB_MANAGED_HOST_PATH to the packaged t3 executable.");
    const root = await mkdtemp(join(tmpdir(), "blackcrab-mobile-managed-"));
    const data = join(root, "host-data"), project = join(root, "sdk-project");
    await mkdir(project);
    const secure = new Map<string, string>(), cached = new Map<string, string>();
    const cacheBackend: ManagedCacheBackend = {
      read: async key => cached.get(key) ?? null, write: async (key, value) => { cached.set(key, value); },
      remove: async key => { cached.delete(key); }, clear: async prefix => { for (const key of cached.keys()) if (key.startsWith(prefix)) cached.delete(key); },
    };
    const options = () => ({
      storageLayer: makeManagedStorageLayer({ getItem: async (key: string) => secure.get(key) ?? null, setItem: async (key: string, value: string) => { secure.set(key, value); }, removeItem: async (key: string) => { secure.delete(key); } }),
      cacheBackend, fetch: globalThis.fetch,
      network: { getNetworkStateAsync: async () => ({ isConnected: true, type: "WIFI" }), addNetworkStateListener: () => ({ remove() {} }) },
      appState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    });
    let host: ChildProcess | undefined, adapter: ManagedRuntimeAdapter | undefined;
    let startupOutput = "", spawnFailure = false;
    try {
      const port = await freePort(), address = `http://127.0.0.1:${port}`;
      // Explicit dirs/home fence this artifact away from the user's providers and application state.
      // A fresh environment excludes inherited provider/account credentials.
      const env: NodeJS.ProcessEnv = Object.assign(Object.create(null), { NODE_ENV: "production", PATH: process.env.PATH, HOME: root, TMPDIR: root, T3CODE_HOME: data, CI: "1" });
      host = spawn(resolve(executable), ["--base-dir", data, "--mode", "desktop", "--host", "127.0.0.1", "--port", String(port), "--no-browser", "--auto-bootstrap-project-from-cwd", project], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
      host.on("error", () => { spawnFailure = true; });
      const capture = (chunk: Buffer) => { startupOutput = (startupOutput + chunk.toString("utf8")).slice(-16_384); };
      host.stdout?.on("data", capture); host.stderr?.on("data", capture);
      await vi.waitFor(async () => {
        expect(spawnFailure).toBe(false); expect(host?.exitCode).toBeNull();
        expect((await fetch(address + "/.well-known/t3/environment", { signal: AbortSignal.timeout(1000) })).ok).toBe(true);
      }, { timeout: 45_000, interval: 100 }).catch(() => {
        // Readiness precedes pairing; still redact credential-like diagnostics defensively.
        const safe = startupOutput.replace(/(bearer|token|credential|secret)([\s:=]+)[^\s,\"}]+/gi, "$1$2[redacted]");
        throw Error(`Packaged host startup failed (spawn=${spawnFailure}, exit=${host?.exitCode}, signal=${host?.signalCode}). ${safe}`);
      });
      const minted = await execute(resolve(executable), ["pair", "--base-dir", data, "--label", "Blackcrab integration", "--scope", "orchestration:read"], { env, cwd: project, timeout: 15_000, maxBuffer: 1_000_000 });
      const pairingUrl = minted.stdout.match(/https?:\/\/[^\s\u001b]+\/pair#[^\s\u001b]+/)?.[0];
      if (!pairingUrl) throw Error("Packaged host did not issue a pairing URL.");
      adapter = createManagedRuntimeAdapter(options()); const first = observer(); await adapter.start(first.events);
      const id = await adapter.pair({ address: pairingUrl, pairingCode: "" });
      await vi.waitFor(() => {
        expect(first.connections.get(id)?.phase).toBe("connected");
        const shell = first.shells.get(id); expect(shell?.status).toBe("live");
        expect(shell && Option.isSome(shell.snapshot) && shell.snapshot.value.projects.some(value => value.workspaceRoot === project)).toBe(true);
      }, { timeout: 20_000, interval: 100 });
      expect(secure.has(MANAGED_CATALOG_KEY)).toBe(true);
      await adapter.setEnabled(id, false);
      await vi.waitFor(() => {
        expect([...first.catalog().values()][0]?.enabled).toBe(false);
        expect(first.connections.get(id)?.desired).toBe(false);
      });
      await adapter.setEnabled(id, true);
      await vi.waitFor(() => expect(first.connections.get(id)?.phase).toBe("connected"), { timeout: 15_000 });
      await adapter.dispose(); adapter = undefined;
      adapter = createManagedRuntimeAdapter(options()); const restored = observer(); await adapter.start(restored.events);
      await vi.waitFor(() => { expect(restored.catalog().size).toBe(1); expect(restored.connections.get(id)?.phase).toBe("connected"); expect(restored.shells.get(id)?.status).toBe("live"); }, { timeout: 20_000 });
      await adapter.remove(id);
      await vi.waitFor(() => expect(restored.catalog().size).toBe(0));
      await adapter.dispose(); adapter = undefined;
      adapter = createManagedRuntimeAdapter(options()); const removed = observer(); await adapter.start(removed.events);
      await vi.waitFor(() => expect(removed.catalog().size).toBe(0));
      expect(JSON.parse(secure.get(MANAGED_CATALOG_KEY)!).credentials).toEqual([]);
      expect(first.unavailable).toEqual([]); expect(restored.unavailable).toEqual([]); expect(removed.unavailable).toEqual([]);
    } finally {
      try { await adapter?.dispose(); } finally {
        // Do not remove the sandbox until the owned process has exited.
        await stop(host);
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 150_000);
});
