#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const runNative = process.argv.includes("--native");

function bin(command) {
  return process.platform === "win32" &&
    (command === "npm" || command === "npx")
    ? `${command}.cmd`
    : command;
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(bin(command), args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`${command} exited after signal ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "typecheck"]);
run("npm", ["test"]);
run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"]);
run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", "--locked"]);
run("npm", ["run", "build"]);

if (runNative) {
  if (process.platform !== "darwin") {
    console.error(
      "Native smoke validates macOS .app and .dmg artifacts; run it on macOS.",
    );
    process.exit(1);
  }

  run("npm", ["run", "build:native"]);

  const config = JSON.parse(
    fs.readFileSync(path.join("src-tauri", "tauri.conf.json"), "utf8"),
  );
  const productName = config.productName || "Blackcrab";
  const version = config.version || "0.0.0";
  const arch =
    process.arch === "arm64"
      ? "aarch64"
      : process.arch === "x64"
        ? "x64"
        : process.arch;
  const appPath = path.join(
    "src-tauri",
    "target",
    "release",
    "bundle",
    "macos",
    `${productName}.app`,
  );
  const dmgPath = path.join(
    "src-tauri",
    "target",
    "release",
    "bundle",
    "dmg",
    `${productName}_${version}_${arch}.dmg`,
  );
  for (const artifact of [appPath, dmgPath]) {
    if (!fs.existsSync(artifact)) {
      console.error(`Missing native artifact: ${artifact}`);
      process.exit(1);
    }
    const stat = fs.statSync(artifact);
    if (artifact.endsWith(".dmg") && stat.size === 0) {
      console.error(`Native artifact is empty: ${artifact}`);
      process.exit(1);
    }
    console.log(`Found native artifact: ${artifact}`);
  }
}

console.log("\nSmoke check passed.");
