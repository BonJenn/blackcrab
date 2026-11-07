import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parseAllDocuments } from 'yaml';
import { verifySharedRuntime } from './verify.mjs';
const VENDOR = fileURLToPath(new URL('../vendor/t3/', import.meta.url));
const SESSION = 'packages/client-runtime/src/rpc/session.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-shared-verify-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(VENDOR, root, { recursive: true, filter: file => path.basename(file) !== 'node_modules' });
  return root;
}
async function manifest(root) { return JSON.parse(await fs.readFile(path.join(root, 'VENDOR-MANIFEST.json'), 'utf8')); }
async function save(root, value) { await fs.writeFile(path.join(root, 'VENDOR-MANIFEST.json'), JSON.stringify(value, null, 2) + '\n'); }
async function rehash(root, relative, { sourceClaim = false } = {}) {
  const m = await manifest(root), bytes = await fs.readFile(path.join(root, relative)), record = m.files.find(file => file.path === relative);
  assert.ok(record, `missing fixture record: ${relative}`);
  record.bytes = bytes.length; record.sha256 = hash(bytes);
  if (sourceClaim && record.upstreamPath) record.upstreamSha256 = record.sha256;
  await save(root, m);
}

test('the checked-in source slice verifies with its known patch and restricted dependency boundary', async t => {
  const root = await fixture(t), result = await verifySharedRuntime(root);
  assert.deepEqual(result, { verified: true, packages: 20, sourceFiles: 207, files: 255, externalVersions: { effect: '4.1.2', '@noble/hashes': '1.8.0' } });
});

test('source byte changes, extra payload and source symlinks are rejected', async t => {
  await t.test('source bytes', async t => {
    const root = await fixture(t);
    await fs.appendFile(path.join(root, SESSION), '\n// changed payload\n');
    await assert.rejects(verifySharedRuntime(root), /source integrity differs/);
  });
  await t.test('extra file', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, 'packages/client-runtime/src/unlisted.ts'), 'export const unexpected = true;');
    await assert.rejects(verifySharedRuntime(root), /source file list differs/);
  });
  await t.test('linked source', { skip: process.platform === 'win32' }, async t => {
    const root = await fixture(t), target = path.join(root, SESSION);
    await fs.unlink(target); await fs.symlink(path.join(VENDOR, SESSION), target);
    await assert.rejects(verifySharedRuntime(root), /symbolic link/);
  });
});

test('only selected npm workspace package roots can exempt dependency directories', async t => {
  await t.test('source dependency shadow', async t => {
    const root = await fixture(t), injected = path.join(root, 'packages/client-runtime/src/node_modules/effect');
    await fs.mkdir(injected, { recursive: true });
    await fs.writeFile(path.join(injected, 'package.json'), JSON.stringify({ name: 'effect', version: '4.1.2', type: 'module', exports: { './Effect': './injected.js' } }));
    await fs.writeFile(path.join(injected, 'injected.js'), 'export const unexpected = true;');
    const require = createRequire(pathToFileURL(path.join(root, 'packages/client-runtime/src/connection/index.ts')));
    assert.equal(require.resolve('effect/Effect'), await fs.realpath(path.join(injected, 'injected.js')));
    await assert.rejects(verifySharedRuntime(root), /unexpected dependency directory/);
  });
  await t.test('vendor root is not the consumer npm workspace root', async t => {
    const root = await fixture(t); await fs.mkdir(path.join(root, 'node_modules'));
    await assert.rejects(verifySharedRuntime(root), /unexpected dependency directory/);
  });
  await t.test('unselected package directory', async t => {
    const root = await fixture(t);
    await fs.mkdir(path.join(root, 'packages/unselected/node_modules'), { recursive: true });
    await assert.rejects(verifySharedRuntime(root), /unexpected dependency directory/);
  });
  await t.test('selected package-level npm dependencies remain outside source provenance', async t => {
    const root = await fixture(t), dependency = path.join(root, 'packages/client-runtime/node_modules/consumer-fixture');
    await fs.mkdir(dependency, { recursive: true }); await fs.writeFile(path.join(dependency, 'package.json'), '{"name":"consumer-fixture","version":"1.0.0"}');
    assert.equal((await verifySharedRuntime(root)).verified, true);
  });
});

test('generated dependency injection fails after the outer integrity record is recomputed', async t => {
  const root = await fixture(t), relative = 'packages/client-runtime/package.json', file = path.join(root, relative);
  const generated = JSON.parse(await fs.readFile(file, 'utf8'));
  generated.dependencies['@cursor/sdk'] = '1.2.0';
  await fs.writeFile(file, JSON.stringify(generated, null, 2) + '\n');
  await rehash(root, relative);
  await assert.rejects(verifySharedRuntime(root), /generated package metadata differs/);
});

test('original package provenance cannot be rewritten merely by rehashing its outer source claim', async t => {
  const root = await fixture(t), relative = 'upstream/manifests/client-runtime.json', file = path.join(root, relative);
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  original.dependencies.effect = '4.2.0';
  await fs.writeFile(file, JSON.stringify(original, null, 2) + '\n');
  await rehash(root, relative, { sourceClaim: true });
  await assert.rejects(verifySharedRuntime(root), /original package metadata differs/);
});

test('upstream lock importer pin changes are rejected even after the outer record is rehashed', async t => {
  const root = await fixture(t), relative = 'upstream/pnpm-lock.yaml', file = path.join(root, relative);
  const documents = parseAllDocuments(await fs.readFile(file, 'utf8'));
  const complete = documents.find(document => document.getIn(['importers', 'packages/client-runtime', 'dependencies', 'effect']) !== undefined);
  assert.ok(complete);
  complete.setIn(['importers', 'packages/client-runtime', 'dependencies', 'effect', 'version'], '4.2.0');
  await fs.writeFile(file, documents.map(document => document.toString()).join('\n---\n'));
  await rehash(root, relative, { sourceClaim: true });
  await assert.rejects(verifySharedRuntime(root), /Pinned upstream importer differs/);
});

test('the known patch and original bytes cannot disappear from provenance after manifest relabeling', async t => {
  await t.test('known patch omitted', async t => {
    const root = await fixture(t), m = await manifest(root), record = m.files.find(file => file.path === SESSION);
    m.sourcePatches = []; delete record.sourcePatchId; record.upstreamSha256 = record.sha256;
    await save(root, m);
    await assert.rejects(verifySharedRuntime(root), /known source patch list differs/);
  });
  await t.test('known target relabeled as unchanged', async t => {
    const root = await fixture(t), m = await manifest(root), record = m.files.find(file => file.path === SESSION);
    delete record.sourcePatchId; record.upstreamSha256 = record.sha256;
    await save(root, m);
    await assert.rejects(verifySharedRuntime(root), /known source patch provenance differs/);
  });
  await t.test('preserved original tampered and rehashed', async t => {
    const root = await fixture(t), relative = 'upstream/original-files/' + SESSION;
    await fs.appendFile(path.join(root, relative), '\n// changed original\n');
    await rehash(root, relative, { sourceClaim: true });
    await assert.rejects(verifySharedRuntime(root), /original source differs/);
  });
});
