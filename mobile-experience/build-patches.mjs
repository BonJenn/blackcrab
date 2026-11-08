import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
const registryUrl = new URL('./build-patches/registry.json', import.meta.url);
const registrySha256 = '8990bc260905bb8da421070936bf3ff76ad3ee3a2f37b53f9e6d20066cc1e8f0';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function applyOwnedMobileBuildPatches({ repoRoot }) {
  repoRoot = await fs.realpath(repoRoot);
  const bytes = await fs.readFile(registryUrl);
  if (hash(bytes) !== registrySha256) throw new Error('Unknown mobile build patch descriptor');
  const descriptor = JSON.parse(bytes);
  const diff = await fs.readFile(new URL(descriptor.file, registryUrl));
  if (hash(diff) !== descriptor.sha256) throw new Error('Mobile build patch diff differs');
  const require = createRequire(path.join(repoRoot, 'apps/mobile/package.json'));
  const manifestPath = require.resolve('expo-widgets/package.json');
  const packageRoot = await fs.realpath(path.dirname(manifestPath));
  if (!packageRoot.startsWith(repoRoot + path.sep)) throw new Error('Mobile build patch package escapes staging');
  const location = path.relative(repoRoot, packageRoot).split(path.sep).join('/');
  const installed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  if (installed.name !== descriptor.package || installed.version !== descriptor.version || lock.packages?.[location]?.integrity !== descriptor.originalIntegrity) throw new Error('Mobile build patch package pin differs');
  const target = path.join(packageRoot, descriptor.target), stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Mobile build patch target is linked or not regular');
  const original = await fs.readFile(target);
  if (hash(original) !== descriptor.afterSha256) {
    if (hash(original) !== descriptor.beforeSha256 || original.toString().split(descriptor.before).length !== 2) throw new Error('Mobile build configuration differs before patch');
    const patched = Buffer.from(original.toString().replace(descriptor.before, descriptor.after));
    if (hash(patched) !== descriptor.afterSha256) throw new Error('Mobile build patch output differs');
    const temporary = target + '.blackcrab-' + randomUUID();
    try { await fs.writeFile(temporary, patched, { flag: 'wx', mode: stat.mode & 0o777 }); await fs.rename(temporary, target); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  return { id: descriptor.id, package: descriptor.package, version: descriptor.version, location, target: descriptor.target, beforeSha256: descriptor.beforeSha256, afterSha256: descriptor.afterSha256, patchSha256: descriptor.sha256 };
}
