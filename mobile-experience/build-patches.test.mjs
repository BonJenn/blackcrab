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

test('pinned Expo scanner retains complete discovery and failure behavior with a bounded 120-second deadline',async t=>{
 const {applyExpoModuleScannerBuildPatch}=await import('./build-patches.mjs');
 const policy=JSON.parse(await fs.readFile(new URL('./build-patches/scanner-registry.json',import.meta.url)));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-scanner-patch-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const relative='apps/mobile/node_modules/expo-modules-autolinking',pkg=path.join(root,relative);
 await fs.mkdir(path.join(pkg,'build/platforms/apple'),{recursive:true});
 await fs.writeFile(path.join(root,'apps/mobile/package.json'),'{}');
 await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:policy.package,version:policy.version}));
 await fs.writeFile(path.join(root,'package-lock.json'),JSON.stringify({packages:{[relative]:{integrity:policy.originalIntegrity}}}));
 const target=path.join(pkg,policy.target);
 await fs.copyFile(new URL('./fixtures/expo-module-scanner.original.js',import.meta.url),target);
 const result=await applyExpoModuleScannerBuildPatch({repoRoot:root});
 assert.equal(result.afterSha256,policy.afterSha256);
 assert.deepEqual(await applyExpoModuleScannerBuildPatch({repoRoot:root}),result);
 const warnings=[],sandbox={exports:{},module:{exports:{}},console:{warn:message=>warnings.push(message)},require:name=>name==='../../utils'?{}:createRequire(import.meta.url)(name)};
 vm.runInNewContext(await fs.readFile(target,'utf8'),sandbox);
 const expected={modules:[{name:'ApplicationModule'}],warnings:[]};
 let captured;
 const actual=await sandbox.exports.scanExpoModulesAsync({scanModules:async(roots,options)=>{captured={roots,options};return expected;}},{application:'/application'});
 assert.equal(actual,expected);assert.equal(captured.options.timeout,120000);assert.deepEqual([...captured.roots],['/application']);
 assert.equal(await sandbox.exports.scanExpoModulesAsync({scanModules:async()=>{throw Error('scan failed');}},{application:'/application'}),null);
 assert.match(warnings[0],/scan failed/);
 await fs.appendFile(target,'\n// unexpected change');
 await assert.rejects(applyExpoModuleScannerBuildPatch({repoRoot:root}),/before patch/);
});
