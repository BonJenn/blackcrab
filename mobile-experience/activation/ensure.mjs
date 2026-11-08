import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateActivation, verifyActivation } from './generator.mjs';
const inFlight = new Map();
const kind = 'blackcrab-owned-full-mobile-activation';

/** Replace only an explicitly owned generated source tree, never an arbitrary output. */
export async function publishGeneratedActivation({ output, build, verify }) {
  const parent = path.dirname(output);
  await fs.mkdir(parent, { recursive: true });
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw Error('Generated source parent is not an owned directory');
  const lock = output + '.lock';
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw Error('Native UI generation is busy; retry after the existing preparation finishes.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const stage = output + '.pending-' + randomUUID(), backup = output + '.previous-' + randomUUID();
  let movedOld = false;
  try {
    let exists = false;
    try {
      const stat = await fs.lstat(output);
      exists = true;
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Native UI output must be a real generated directory');
      const markerFile = path.join(output, 'ACTIVATION-MANIFEST.json');
      const markerStat = await fs.lstat(markerFile);
      if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1 || markerStat.size > 16 * 1024 * 1024) throw Error('Unrecognized generated native UI output');
      if (JSON.parse(await fs.readFile(markerFile, 'utf8')).kind !== kind) throw Error('Unrecognized generated native UI output');
    } catch (error) { if (error.code !== 'ENOENT' || exists) throw error; }
    if (exists) {
      try { return await verify(output); }
      catch { /* Owned disposable source output has drifted; rebuild from verified input. */ }
    }
    await build(stage);
    const result = await verify(stage);
    if (exists) { await fs.rename(output, backup); movedOld = true; }
    try { await fs.rename(stage, output); }
    catch (error) { if (movedOld) { await fs.rename(backup, output); movedOld = false; } throw error; }
    if (movedOld) { await fs.rm(backup, { recursive: true }); movedOld = false; }
    return result;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    await fs.rmdir(lock);
  }
}

/** Fresh clones need no checked-in generated files and never evaluate upstream config. */
export function ensureNativeUI(repoRoot) {
  repoRoot = path.resolve(repoRoot);
  if (inFlight.has(repoRoot)) return inFlight.get(repoRoot);
  const consumer = path.join(repoRoot, 'vendor/t3-mobile');
  const output = path.join(repoRoot, 'apps/mobile/.generated/native-ui');
  const work = publishGeneratedActivation({ output,
    build: generated => generateActivation({ consumer, output: generated }),
    verify: generated => verifyActivation({ consumer, output: generated }),
  }).finally(() => inFlight.delete(repoRoot));
  inFlight.set(repoRoot, work);
  return work;
}
