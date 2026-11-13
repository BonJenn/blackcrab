import fs from 'node:fs/promises';

/** The outer app and its workspace are one Blackcrab release. */
export async function readBlackcrabVersion(root = new URL('../', import.meta.url)) {
  const [pkg, native] = await Promise.all([
    fs.readFile(new URL('package.json', root), 'utf8').then(JSON.parse),
    fs.readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8').then(JSON.parse),
  ]);
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.version !== native.version) {
    throw new Error('Blackcrab package and native release versions must match');
  }
  return pkg.version;
}
