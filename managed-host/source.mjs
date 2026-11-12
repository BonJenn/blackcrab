import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {controlledCommand} from './controlled-process.mjs';
import { UPSTREAM } from './artifact.mjs';
const patchesRoot = fileURLToPath(new URL('./patches/', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
export async function archiveDigest(file, processControl) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) { processControl?.assertRunning(); digest.update(bytes); }
  return digest.digest('hex');
}
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const relative = value => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || (/[\r\n\0]/.test(value)) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe managed patch path');
  return value;
};
async function directory(value) {
  const stat = await fs.lstat(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Managed patch directory is not a regular directory');
  return fs.realpath(value);
}
async function targetWithin(base, name, missingParents) {
  const parts = relative(name).split('/'); let current = base;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try { const stat = await fs.lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Managed patch parent is not a regular directory'); }
    catch (error) { if (error.code !== 'ENOENT' || !missingParents) throw error; }
  }
  return path.join(base, ...parts);
}
/** Preflight the complete record chain before writing anything; payloads never overwrite files. */
export async function applySourcePatchRecords(root, { records, patchDirectory = patchesRoot }) {
  if (!Array.isArray(records) || records.length > 1024) throw new Error('Invalid managed source patch registry');
  const sourceRoot = await directory(root), patchRoot = await directory(patchDirectory), states = new Map(), ids = new Set();
  for (const patch of records) {
    if (!patch || typeof patch.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(patch.id) || ids.has(patch.id) || !validHash(patch.sha256) || !validHash(patch.afterSha256) || (patch.kind !== undefined && patch.kind !== 'payload')) throw new Error('Invalid managed source patch record');
    ids.add(patch.id);
    const name = relative(patch.target), target = await targetWithin(sourceRoot, name, patch.kind === 'payload' || states.has(name));
    const patchFile = await targetWithin(patchRoot, patch.file, false), patchStat = await fs.lstat(patchFile);
    if (!patchStat.isFile() || patchStat.isSymbolicLink()) throw new Error('Managed patch data is not a regular file');
    const bytes = await fs.readFile(patchFile);
    if (hash(bytes) !== patch.sha256) throw new Error('Managed source patch digest mismatch');
    let state = states.get(name);
    if (!state) {
      let contents = null;
      try { const stat = await fs.lstat(target); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Managed source target is not a regular file'); contents = await fs.readFile(target); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      state = { target, initialExists: contents !== null, contents }; states.set(name, state);
    }
    let output;
    if (patch.kind === 'payload') {
      if (patch.beforeSha256 !== null || state.contents !== null) throw new Error('Managed payload target must be absent');
      output = bytes;
    } else {
      if (!validHash(patch.beforeSha256) || state.contents === null || hash(state.contents) !== patch.beforeSha256) throw new Error(`Pinned source differs before patch: ${patch.id}`);
      if (!Array.isArray(patch.replacements) || !patch.replacements.length) throw new Error('Managed patch replacements missing');
      let contents = state.contents.toString('utf8');
      if (!Buffer.from(contents).equals(state.contents)) throw new Error('Managed replacement target is not UTF-8');
      for (const replacement of patch.replacements) {
        if (typeof replacement.before !== 'string' || !replacement.before || typeof replacement.after !== 'string' || contents.split(replacement.before).length !== 2) throw new Error(`Source patch does not match uniquely: ${patch.id}`);
        contents = contents.replace(replacement.before, () => replacement.after);
      }
      output = Buffer.from(contents);
    }
    if (hash(output) !== patch.afterSha256) throw new Error(`Managed source patch result mismatch: ${patch.id}`);
    state.contents = output;
  }
  for (const state of states.values()) {
    await fs.mkdir(path.dirname(state.target), { recursive: true });
    await fs.writeFile(state.target, state.contents, state.initialExists ? undefined : { flag: 'wx' });
  }
  return records.map(({ id, sha256 }) => ({ id, sha256 }));
}
export async function applySourcePatches(root) {
  const records = JSON.parse(await fs.readFile(path.join(patchesRoot, 'registry.json'), 'utf8'));
  return applySourcePatchRecords(root, { records });
}
/** Only the exact archived target is extracted; callers never build a mutable user checkout. */
export async function extractPinnedSourceArchive(archive, cacheDir, {processControl} = {}) {
  if (await archiveDigest(archive, processControl) !== UPSTREAM.archiveSha256) throw new Error('Source archive does not match the pinned T3 target');
  await fs.mkdir(cacheDir, { recursive: true });
  const root = await fs.mkdtemp(path.join(cacheDir, 'blackcrab-managed-source-'));
  if (processControl) await controlledCommand('tar', ['-xzf', path.resolve(archive), '--strip-components=1', '-C', root], {env:process.env,label:'source-extraction',maxBuffer:2048,timeoutMs:30*60*1000}, processControl);
  else await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', path.resolve(archive), '--strip-components=1', '-C', root], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', bytes => { error = (error + bytes.toString()).slice(-2048); });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Pinned source extraction failed (${code}): ${error}`)));
  });
  return { root };
}

/** Native runtime builds apply their recorded build-only patches after extraction. */
export async function prepareSourceArchive(archive, cacheDir, options) {
  const { root } = await extractPinnedSourceArchive(archive, cacheDir, options);
  const sourcePatches = await applySourcePatches(root);
  return { root, sourcePatches };
}
