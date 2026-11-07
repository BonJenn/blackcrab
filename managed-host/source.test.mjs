import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { archiveDigest, prepareSourceArchive, applySourcePatches } from './source.mjs';
import { buildManagedHost } from './build.mjs';
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-source-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('an unpinned archive is rejected before extraction or cache creation', async t => {
  const root = await fixture(t), archive = path.join(root, 'input.tar.gz'), cache = path.join(root, 'cache');
  await fs.writeFile(archive, 'not the pinned source');
  await assert.rejects(prepareSourceArchive(archive, cache), /does not match/);
  await assert.rejects(fs.stat(cache), { code: 'ENOENT' });
});
test('source patches cannot overwrite changed or linked source files', async t => {
  const root = await fixture(t), file = path.join(root, 'apps/web/vite.config.ts'); await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'unrelated configuration');
  await assert.rejects(applySourcePatches(root), /differs before patch/); assert.equal(await fs.readFile(file, 'utf8'), 'unrelated configuration');
  const other = path.join(root, 'other'); await fs.writeFile(other, 'untouched'); await fs.unlink(file); await fs.symlink(other, file);
  await assert.rejects(applySourcePatches(root), /not a regular file/); assert.equal(await fs.readFile(other, 'utf8'), 'untouched');
});
test('source patch records contain the actual patch bytes', async () => {
  const root = fileURLToPath(new URL('./patches/', import.meta.url));
  const registry = JSON.parse(await fs.readFile(path.join(root, 'registry.json'), 'utf8'));
  for (const patch of registry) assert.equal(await archiveDigest(path.join(root, patch.file)), patch.sha256);
});
test('an existing output is preserved without starting a build or executing a toolchain', async t => {
  const root = await fixture(t), output = path.join(root, 'artifact'); await fs.mkdir(output); await fs.writeFile(path.join(output, 'keep'), 'existing');
  await assert.rejects(buildManagedHost({ archive: '/absent', cacheDir: path.join(root, 'cache'), output, node: '/never-execute', pnpm: '/absent' }), /Output already exists/);
  assert.equal(await fs.readFile(path.join(output, 'keep'), 'utf8'), 'existing'); await assert.rejects(fs.stat(path.join(root, 'cache')), { code: 'ENOENT' });
});
