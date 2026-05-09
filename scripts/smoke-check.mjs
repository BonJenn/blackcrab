#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const runNative = process.argv.includes("--native");

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "typecheck"]);
run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"]);
run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", "--locked"]);
run("npm", ["run", "build"]);

if (runNative) {
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
    console.log(`Found native artifact: ${artifact}`);
  }
}

console.log("\nSmoke check passed.");
