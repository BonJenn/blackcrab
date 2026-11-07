import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { applySharedSourcePatches, validateSharedSourcePatch, SHARED_SOURCE_PATCH_DIRECTORY } from './patches.mjs';

// Exact MIT-licensed BonJenn/t3code fixture at 7f02de2eb8e253e0ec23f005b3cfff8e2c963be8.
// Upstream copyright/license is preserved with the vendored source artifact.
// Compressed bytes keep this test independent of scratch archives or generated vendor layout.
const ORIGINAL = gunzipSync(Buffer.from('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', 'base64'));
const TARGET = 'packages/client-runtime/src/rpc/session.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-shared-patch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, TARGET);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, ORIGINAL, { mode: 0o640 });
  return { root, target };
}
function emit(bytes) {
  return ts.transpileModule(bytes.toString('utf8'), { fileName: 'session.ts', compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true, removeComments: true, sourceMap: false, inlineSourceMap: false, inlineSources: false, newLine: ts.NewLineKind.LineFeed } }).outputText;
}
async function isolatedModule(t, mutate) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-patch-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const require = createRequire(import.meta.url);
  const source = await fs.readFile(new URL('./patches.mjs', import.meta.url), 'utf8');
  const copiedSource = source.replace("import ts from 'typescript';", `import ts from ${JSON.stringify(pathToFileURL(require.resolve('typescript')).href)};`);
  assert.notEqual(source, copiedSource);
  await fs.writeFile(path.join(root, 'patches.mjs'), copiedSource);
  await fs.cp(fileURLToPath(SHARED_SOURCE_PATCH_DIRECTORY), path.join(root, 'patches'), { recursive: true });
  await mutate(path.join(root, 'patches'));
  return import(pathToFileURL(path.join(root, 'patches.mjs')).href);
}

test('the exact parameter annotation patch preserves JavaScript and returns original bytes', async t => {
  const { root, target } = await fixture(t);
  const result = await applySharedSourcePatches(root), patched = await fs.readFile(target), descriptor = result.patches[0];
  assert.equal(result.patches.length, 1);
  assert.deepEqual(result.originals, [{ path: TARGET, bytes: ORIGINAL }]);
  assert.equal(descriptor.target, TARGET);
  assert.equal(hash(ORIGINAL), descriptor.beforeSha256);
  assert.equal(hash(patched), descriptor.afterSha256);
  for (const index of [0, 1, 2]) assert.match(patched.toString(), new RegExp(`Parameters<typeof protocol\\.send>\\[${index}\\]`));
  assert.equal(emit(ORIGINAL), emit(patched));
  assert.equal(hash(emit(patched)), descriptor.emittedJavaScriptSha256);
  assert.doesNotThrow(() => validateSharedSourcePatch(ORIGINAL, patched, descriptor));
  if (process.platform !== 'win32') assert.equal((await fs.stat(target)).mode & 0o777, 0o640);
  assert.deepEqual((await fs.readdir(path.dirname(target))).filter(name => name.startsWith('.blackcrab-shared-patch-')), []);
});

test('changed source and repeated application fail without overwriting it', async t => {
  const { root, target } = await fixture(t);
  const changed = Buffer.concat([ORIGINAL, Buffer.from('\n// changed source\n')]);
  await fs.writeFile(target, changed);
  await assert.rejects(applySharedSourcePatches(root), /original source differs/);
  assert.deepEqual(await fs.readFile(target), changed);
  await fs.writeFile(target, ORIGINAL);
  await applySharedSourcePatches(root);
  const patched = await fs.readFile(target);
  await assert.rejects(applySharedSourcePatches(root), /original source differs/);
  assert.deepEqual(await fs.readFile(target), patched);
});

test('validation rejects changed source, runtime edits and unknown descriptors', async t => {
  const { root, target } = await fixture(t);
  const { patches: [descriptor] } = await applySharedSourcePatches(root), patched = await fs.readFile(target);
  assert.throws(() => validateSharedSourcePatch(Buffer.concat([ORIGINAL, Buffer.from(' ')]), patched, descriptor), /original source differs/);
  const runtimeEdit = Buffer.from(patched.toString().replace('protocol.send(clientId, request, transferables)', 'Effect.void'));
  assert.notEqual(hash(runtimeEdit), hash(patched));
  assert.throws(() => validateSharedSourcePatch(ORIGINAL, runtimeEdit, descriptor), /patched source differs/);
  for (const key of Object.keys(descriptor)) assert.throws(() => validateSharedSourcePatch(ORIGINAL, patched, { ...descriptor, [key]: 'unknown' }), /unknown descriptor/);
  assert.throws(() => validateSharedSourcePatch(ORIGINAL, patched, { ...descriptor, extra: true }), /unknown descriptor/);
  assert.throws(() => validateSharedSourcePatch(ORIGINAL, patched, null), /unknown descriptor/);
});

test('tampered diff and registry bytes fail before any source overwrite', async t => {
  await t.test('diff', async t => {
    const { root, target } = await fixture(t);
    const module = await isolatedModule(t, directory => fs.appendFile(path.join(directory, '001-rpc-send-parameter-types.patch'), '\nchanged\n'));
    await assert.rejects(module.applySharedSourcePatches(root), /diff digest differs/);
    assert.deepEqual(await fs.readFile(target), ORIGINAL);
  });
  await t.test('registry', async t => {
    const { root, target } = await fixture(t);
    const module = await isolatedModule(t, async directory => {
      const file = path.join(directory, 'registry.json'), registry = JSON.parse(await fs.readFile(file, 'utf8'));
      registry[0].beforeSha256 = '0'.repeat(64);
      await fs.writeFile(file, JSON.stringify(registry));
    });
    await assert.rejects(module.applySharedSourcePatches(root), /registry digest differs/);
    assert.deepEqual(await fs.readFile(target), ORIGINAL);
  });
});

test('linked roots, ancestors and targets cannot receive patches', { skip: process.platform === 'win32' }, async t => {
  await t.test('target', async t => {
    const { root, target } = await fixture(t), outside = path.join(root, 'other.ts');
    await fs.writeFile(outside, ORIGINAL); await fs.unlink(target); await fs.symlink(outside, target);
    await assert.rejects(applySharedSourcePatches(root), /linked/);
    assert.deepEqual(await fs.readFile(outside), ORIGINAL);
  });
  await t.test('hardlinked target', async t => {
    const { root, target } = await fixture(t), outside = path.join(root, 'linked-copy.ts');
    await fs.link(target, outside);
    await assert.rejects(applySharedSourcePatches(root), /single-link regular file/);
    assert.deepEqual(await fs.readFile(outside), ORIGINAL);
    assert.deepEqual(await fs.readFile(target), ORIGINAL);
  });
  await t.test('ancestor', async t => {
    const { root, target } = await fixture(t), directory = path.dirname(target), originalDirectory = path.join(root, 'real-rpc');
    await fs.rename(directory, originalDirectory); await fs.symlink(originalDirectory, directory, 'dir');
    await assert.rejects(applySharedSourcePatches(root), /linked/);
    assert.deepEqual(await fs.readFile(path.join(originalDirectory, 'session.ts')), ORIGINAL);
  });
  await t.test('root', async t => {
    const { root, target } = await fixture(t), alias = root + '-alias';
    t.after(() => fs.rm(alias, { force: true })); await fs.symlink(root, alias, 'dir');
    await assert.rejects(applySharedSourcePatches(alias), /real directory/);
    assert.deepEqual(await fs.readFile(target), ORIGINAL);
  });
});
