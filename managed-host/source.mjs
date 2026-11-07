import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { UPSTREAM } from './artifact.mjs';
const patchesRoot = fileURLToPath(new URL('./patches/', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
export async function archiveDigest(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
export async function applySourcePatches(root) {
  const registry = JSON.parse(await fs.readFile(path.join(patchesRoot, 'registry.json'), 'utf8'));
  const applied = [];
  for (const patch of registry) {
    const diff = await fs.readFile(path.join(patchesRoot, patch.file));
    if (hash(diff) !== patch.sha256) throw new Error('Managed source patch digest mismatch');
    const file = path.join(root, patch.target);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Managed source patch target is not a regular file');
    let contents = await fs.readFile(file, 'utf8');
    if (hash(contents) !== patch.beforeSha256) throw new Error(`Pinned source differs before patch: ${patch.id}`);
    for (const replacement of patch.replacements) {
      if (contents.split(replacement.before).length !== 2) throw new Error(`Source patch does not match uniquely: ${patch.id}`);
      contents = contents.replace(replacement.before, replacement.after);
    }
    if (hash(contents) !== patch.afterSha256) throw new Error(`Managed source patch result mismatch: ${patch.id}`);
    await fs.writeFile(file, contents);
    applied.push({ id: patch.id, sha256: patch.sha256 });
  }
  return applied;
}
/** Only the exact archived target is extracted; callers never build a mutable user checkout. */
export async function extractPinnedSourceArchive(archive, cacheDir) {
  if (await archiveDigest(archive) !== UPSTREAM.archiveSha256) throw new Error('Source archive does not match the pinned T3 target');
  await fs.mkdir(cacheDir, { recursive: true });
  const root = await fs.mkdtemp(path.join(cacheDir, 'blackcrab-managed-source-'));
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', path.resolve(archive), '--strip-components=1', '-C', root], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', bytes => { error = (error + bytes.toString()).slice(-2048); });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Pinned source extraction failed (${code}): ${error}`)));
  });
  return { root };
}

/** Native runtime builds apply their recorded build-only patches after extraction. */
export async function prepareSourceArchive(archive, cacheDir) {
  const { root } = await extractPinnedSourceArchive(archive, cacheDir);
  const sourcePatches = await applySourcePatches(root);
  return { root, sourcePatches };
}
