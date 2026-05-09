#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rawArgs = process.argv.slice(2);
let mode = "local";
const passThrough = [];

function usage() {
  console.log(`Usage:
  npm run build:native [-- <tauri build args>]
  npm run build:native:signed [-- <tauri build args>]

Modes:
  --local    Build local app/installers without updater artifacts. Default.
  --signed   Build release app/installers with updater artifacts and signing.

Local builds do not require TAURI_SIGNING_PRIVATE_KEY. Signed builds require it.`);
}

for (const arg of rawArgs) {
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  if (arg === "--local") {
    mode = "local";
    continue;
  }
  if (arg === "--signed" || arg === "--release") {
    mode = "signed";
    continue;
  }
  passThrough.push(arg);
}

const hasUpdaterKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());
const tauriArgs = ["tauri", "build", ...passThrough];
const localMacDefaultBundle =
  mode !== "signed" &&
  process.platform === "darwin" &&
  !passThrough.some((arg) => arg === "--bundles" || arg === "-b");

if (mode === "signed") {
  if (!hasUpdaterKey) {
    console.error(
      "TAURI_SIGNING_PRIVATE_KEY is required for signed release builds.",
    );
    console.error(
      "For local packaging without updater artifacts, run: npm run build:native",
    );
    process.exit(1);
  }
  console.log("Building signed native release with updater artifacts...");
} else {
  if (localMacDefaultBundle) {
    tauriArgs.push("--bundles", "app");
  }
  tauriArgs.push(
    "--config",
    JSON.stringify({ bundle: { createUpdaterArtifacts: false } }),
  );
  console.log("Building local native package without updater artifacts...");
  if (hasUpdaterKey) {
    console.log(
      "TAURI_SIGNING_PRIVATE_KEY is set, but local mode disables updater artifacts. Use npm run build:native:signed for release artifacts.",
    );
  }
}

function archSuffix() {
  if (process.arch === "arm64") return "aarch64";
  if (process.arch === "x64") return "x64";
  return process.arch;
}

function createLocalDmg() {
  const root = process.cwd();
  const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
  const productName = tauriConfig.productName || "Blackcrab";
  const version = tauriConfig.version || "0.0.0";
  const bundleDir = path.join(root, "src-tauri", "target", "release", "bundle");
  const macosDir = path.join(bundleDir, "macos");
  const dmgDir = path.join(bundleDir, "dmg");
  const appPath = path.join(macosDir, `${productName}.app`);
  const stagingDir = path.join(dmgDir, `${productName}-local-dmg`);
  const dmgPath = path.join(dmgDir, `${productName}_${version}_${archSuffix()}.dmg`);

  if (!fs.existsSync(appPath)) {
    throw new Error(`Expected app bundle was not found: ${appPath}`);
  }

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.cpSync(appPath, path.join(stagingDir, `${productName}.app`), {
    recursive: true,
    preserveTimestamps: true,
  });
  fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));
  fs.mkdirSync(dmgDir, { recursive: true });

  console.log(`Creating local DMG at ${dmgPath}`);
  const result = spawn(
    "hdiutil",
    [
      "create",
      "-volname",
      productName,
      "-srcfolder",
      stagingDir,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ],
    { stdio: "inherit" },
  );

  return new Promise((resolve, reject) => {
    result.on("error", reject);
    result.on("exit", (code, signal) => {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      if (signal) {
        reject(new Error(`hdiutil exited by signal ${signal}`));
      } else if (code === 0) {
        resolve(dmgPath);
      } else {
        reject(new Error(`hdiutil exited with code ${code}`));
      }
    });
  });
}

const bin = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(bin, tauriArgs, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", async (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }
  if (!localMacDefaultBundle) {
    process.exit(0);
    return;
  }
  try {
    const dmgPath = await createLocalDmg();
    console.log(`Finished local DMG at: ${dmgPath}`);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
});
