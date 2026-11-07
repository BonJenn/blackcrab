import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSharedRuntime, createConsumerManifest, resolveExternalVersions } from './export.mjs';
function fixturePackage() {
  return {
    name: '@t3tools/client-runtime', folder: 'packages/client-runtime',
    originalManifest: { name: '@t3tools/client-runtime', type: 'module', exports: { './connection': { types: './src/connection/index.ts', default: './src/connection/index.ts' } }, dependencies: { effect: 'catalog:', '@cursor/sdk': '1.2.0', '@t3tools/contracts': 'workspace:*' }, scripts: { postinstall: 'must never be copied' } },
    usedExports: [{ key: './connection', conditions: ['default'], target: 'packages/client-runtime/src/connection/index.ts' }],
    dependencies: { workspace: ['@t3tools/contracts'], external: ['effect'] },
  };
}
const files = new Set(['packages/client-runtime/src/connection/index.ts']);
const contracts = { name: '@t3tools/contracts', folder: 'packages/contracts' };
test('mobile metadata follows proven imports and cannot pull unused server SDKs or lifecycle scripts', () => {
  const pkg = fixturePackage(), manifest = createConsumerManifest(pkg, files, [pkg, contracts]);
  assert.deepEqual(manifest.dependencies, { '@t3tools/contracts': 'file:../contracts', effect: '4.1.2' });
  assert.equal(manifest.scripts, undefined); assert.equal(manifest.dependencies['@cursor/sdk'], undefined);
  assert.deepEqual(manifest.exports, pkg.originalManifest.exports);
  assert.equal(pkg.originalManifest.dependencies['@cursor/sdk'], '1.2.0');
});
test('export metadata cannot reference omitted source or invented workspace/external versions', () => {
  const pkg = fixturePackage();
  assert.throws(() => createConsumerManifest(pkg, new Set(), [pkg, contracts]), /unselected target/);
  assert.throws(() => createConsumerManifest(pkg, files, [pkg]), /Unselected workspace/);
  assert.throws(() => createConsumerManifest(pkg, files, [pkg, contracts], { effect: '4.2.0' }), /Unpinned mobile dependency/);
  pkg.dependencies.external.push('@cursor/sdk');
  assert.throws(() => createConsumerManifest(pkg, files, [pkg, contracts]), /Unpinned mobile dependency/);
});
test('every retained conditional export target must be part of the analyzed boundary', () => {
  const pkg = fixturePackage(); pkg.originalManifest.exports['./connection'].node = './src/server.ts';
  assert.throws(() => createConsumerManifest(pkg, files, [pkg, contracts]), /unselected target/);
});
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-shared-export-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}
test('an existing output survives without inspecting an archive or creating a cache', async t => {
  const root = await temporary(t), output = path.join(root, 'out'), cache = path.join(root, 'cache');
  await fs.mkdir(output); await fs.writeFile(path.join(output, 'keep'), 'existing');
  await assert.rejects(buildSharedRuntime({ archive: '/absent', cacheDir: cache, output }), /already exists/);
  assert.equal(await fs.readFile(path.join(output, 'keep'), 'utf8'), 'existing'); await assert.rejects(fs.stat(cache), { code: 'ENOENT' });
});
test('unrecognized source bytes fail before extraction and publication', async t => {
  const root = await temporary(t), archive = path.join(root, 'changed.tar.gz'), cache = path.join(root, 'cache'), output = path.join(root, 'out');
  await fs.writeFile(archive, 'not the pinned archive');
  await assert.rejects(buildSharedRuntime({ archive, cacheDir: cache, output }), /pinned T3 target/);
  await assert.rejects(fs.stat(cache), { code: 'ENOENT' }); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});

test('pnpm multi-document input selects the complete workspace importer rather than a root-only header', () => {
  const pkg = fixturePackage();
  const complete = { importers: { [pkg.folder]: { dependencies: { effect: { version: '4.1.2' } } } } };
  const header = { importers: { '.': {} } };
  const result = resolveExternalVersions(JSON.stringify(header) + '\n---\n' + JSON.stringify(complete), [pkg]);
  assert.equal(result.documentIndex, 1); assert.equal(result.versions.effect, '4.1.2');
  assert.throws(() => resolveExternalVersions(JSON.stringify(complete) + '\n---\n' + JSON.stringify(complete), [pkg]), /exactly one/);
  complete.importers[pkg.folder].dependencies.effect.version = '4.2.0';
  assert.throws(() => resolveExternalVersions(JSON.stringify(complete), [pkg]), /importer differs/);
});
