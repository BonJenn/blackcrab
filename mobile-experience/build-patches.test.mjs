import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { applyOwnedMobileBuildPatches } from './build-patches.mjs';
const descriptor = JSON.parse(await fs.readFile(new URL('./build-patches/registry.json', import.meta.url), 'utf8'));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-widget-patch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'apps/mobile/node_modules/expo-widgets');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(root, 'apps/mobile/package.json'), '{"name":"mobile"}');
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'expo-widgets', version: '58.0.20' }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'apps/mobile/node_modules/expo-widgets': { integrity: descriptor.originalIntegrity } } }));
  await fs.copyFile(new URL('./fixtures/expo-widgets.metro.original.cjs', import.meta.url), path.join(pkg, 'metro.config.js'));
  return { root, pkg };
}
test('hoisted widget dependencies enter the file map without changing project root or resolver stubs', async t => {
  const { root, pkg } = await fixture(t);
  const result = await applyOwnedMobileBuildPatches({ repoRoot: root });
  assert.equal(result.id, 'expo-widgets-workspace-watch');
  assert.deepEqual(await applyOwnedMobileBuildPatches({ repoRoot: root }), result);
  const sandbox = { module: { exports: {} }, process: { cwd: () => path.join(root, 'apps/mobile') }, __dirname: pkg, require: name => {
    if (name === 'expo/metro-config') return { getDefaultConfig: () => ({ watchFolders: [path.join(root, 'node_modules')], resolver: {}, transformer: {}, serializer: {} }) };
    if (name === 'resolve-workspace-root') return { resolveWorkspaceRoot: () => root };
    return createRequire(import.meta.url)(name);
  } };
  vm.runInNewContext(await fs.readFile(path.join(pkg, 'metro.config.js'), 'utf8'), sandbox);
  const config = sandbox.module.exports;
  assert.equal(config.projectRoot, pkg);
  assert.ok(config.watchFolders.includes(root));
  assert.equal(config.resolver.resolveRequest({}, 'react', 'ios').filePath, path.join(pkg, 'bundle/react-stub.ts'));
});
test('changed source, wrong version and symlinks fail closed', async t => {
  const { root, pkg } = await fixture(t), file = path.join(pkg, 'metro.config.js');
  await fs.appendFile(file, '\n// changed');
  await assert.rejects(applyOwnedMobileBuildPatches({ repoRoot: root }), /before patch/);
  await fs.rm(file); await fs.symlink(new URL('./fixtures/expo-widgets.metro.original.cjs', import.meta.url), file);
  await assert.rejects(applyOwnedMobileBuildPatches({ repoRoot: root }), /linked/);
  await fs.writeFile(path.join(pkg, 'package.json'), '{"name":"expo-widgets","version":"58.0.21"}');
  await assert.rejects(applyOwnedMobileBuildPatches({ repoRoot: root }), /pin differs/);
});
