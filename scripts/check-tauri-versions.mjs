import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

/** Compare the two committed dependency graphs before expensive native packaging. */
export function checkLockedTauriVersions(npmLock, cargoLock) {
  const crates = cargoLock.split(/^\[\[package\]\]\s*$/m).slice(1).map((block) => ({
    name: /^name = "([^"]+)"$/m.exec(block)?.[1],
    version: /^version = "([^"]+)"$/m.exec(block)?.[1],
  }));
  const names = Object.keys(npmLock.packages?.['']?.dependencies ?? {})
    .filter((name) => name === '@tauri-apps/api' || name.startsWith('@tauri-apps/plugin-'));
  if (!names.includes('@tauri-apps/api')) throw Error('The root Tauri API dependency is missing from package-lock.json');
  const errors = [];
  for (const name of names) {
    const crateName = name === '@tauri-apps/api' ? 'tauri' : name.replace('@tauri-apps/', 'tauri-');
    const matches = crates.filter((crate) => crate.name === crateName);
    const jsVersion = npmLock.packages?.[`node_modules/${name}`]?.version;
    const rustVersion = matches.length === 1 ? matches[0].version : undefined;
    const family = (version) => /^(\d+\.\d+)\.\d+$/.exec(version ?? '')?.[1];
    if (!family(jsVersion) || !family(rustVersion) || family(jsVersion) !== family(rustVersion)) {
      errors.push(`${name} (${jsVersion ?? 'missing'}) / ${crateName} (${rustVersion ?? 'missing or ambiguous'})`);
    }
  }
  if (errors.length) throw Error(`Tauri npm/Rust major/minor versions must match:\n${errors.join('\n')}`);
  return names.length;
}

export async function checkTauriVersions(root = repository) {
  const [npmLock, cargoLock] = await Promise.all([
    fs.readFile(path.join(root, 'package-lock.json'), 'utf8'),
    fs.readFile(path.join(root, 'src-tauri/Cargo.lock'), 'utf8'),
  ]);
  return checkLockedTauriVersions(JSON.parse(npmLock), cargoLock);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`Locked Tauri npm/Rust versions match (${await checkTauriVersions()} packages)`);
}
