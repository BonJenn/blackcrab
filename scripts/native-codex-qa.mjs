// macOS-only, isolated native fixture runner. No provider model is called.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("This native QA runner currently supports macOS only");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "blackcrab-native-qa-"));
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
const identifier = "com.bonjenn.blackcrab.qa" + randomBytes(6).toString("hex");
const config = path.join(root, "tauri.qa.json");
fs.writeFileSync(config, JSON.stringify({ productName: "Blackcrab QA", identifier, bundle: { createUpdaterArtifacts: false } }));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const fixture = path.join(repo, "src-tauri/tests/fixtures/codex_ui.py");
fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexec /usr/bin/env python3 " + quote(fixture) + ' "$@"\n', { mode: 0o700 });
const qaState = path.join(root, "fixture");
fs.mkdirSync(qaState);
const cwd = path.join(root, "project");
fs.mkdirSync(cwd);
const appData = path.join(os.homedir(), "Library/Application Support", identifier);
const bundle = path.join(repo, "src-tauri/target/debug/bundle/macos/Blackcrab QA.app");
const manifest = path.join(root, "manifest.json");
const metadata = { identifier, bundle, root, project: cwd, appData, fixtureState: qaState, journal: path.join(appData, "execution/state.sqlite3"), log: path.join(root, "app.log") };
fs.writeFileSync(manifest, JSON.stringify(metadata, null, 2));
console.log(`Native QA manifest: ${manifest}`);
// NODE_ENV makes import.meta.env.DEV true even in the packaged frontend, so
// product telemetry stays disabled. This rebuilds dist and the debug bundle;
// the normal production build restores production frontend output.
const built = spawnSync(path.join(repo, "node_modules/.bin/tauri"), ["build", "--debug", "--bundles", "app", "--no-sign", "--ci", "--config", config], {
  cwd: repo, stdio: "inherit", env: { ...process.env, NODE_ENV: "development", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0" },
});
if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status ?? 1);
const assets = path.join(repo, "dist/assets");
if (fs.readdirSync(assets).filter(name => name.endsWith(".js")).some(name => fs.readFileSync(path.join(assets, name), "utf8").includes("https://www.blackcrab.app/api/events"))) throw new Error("QA frontend still contains the product-analytics endpoint; refusing to launch");
const info = spawnSync("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(bundle, "Contents/Info.plist")], { encoding: "utf8" });
if (info.status !== 0) throw new Error("QA bundle has no executable metadata");
const output = fs.openSync(metadata.log, "a");
const app = spawn(path.join(bundle, "Contents/MacOS", info.stdout.trim()), [], {
  cwd, stdio: ["ignore", output, output], env: { ...process.env, PATH: bin + path.delimiter + (process.env.PATH ?? ""), BLACKCRAB_QA_STATE: qaState, BLACKCRAB_QA_JOURNAL: metadata.journal },
});
metadata.pid = app.pid;
fs.writeFileSync(manifest, JSON.stringify(metadata, null, 2));
console.log(`Native QA running, pid ${app.pid}. Fixture project: ${cwd}`);
console.log("Close the QA app or interrupt this runner to stop only its owned process. Retained artifacts are listed in the manifest.");
process.on("SIGINT", () => app.kill("SIGTERM"));
process.on("SIGTERM", () => app.kill("SIGTERM"));
app.on("error", error => { console.error(error.message); process.exitCode = 1; });
app.on("exit", (code, signal) => { fs.closeSync(output); console.log(`Native QA exited: ${signal ?? code}`); process.exitCode = code ?? 0; });
