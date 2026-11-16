import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serviceProfilePlan} from './service-profile.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const freeze=JSON.parse(await fs.readFile(new URL('./build-controller-source-freeze.json',import.meta.url),'utf8'));

test('macOS and Linux plans are the frozen plan, whatever platform runs the build tools',async()=>{
 for(const platform of ['darwin','linux']){
  const plan=await serviceProfilePlan(platform);
  assert.equal(plan.records.length,82);
  assert.equal(sha(JSON.stringify(plan.records)),freeze.recordGraphSha256,platform);
  assert.deepEqual(Object.fromEntries([...plan.data].map(([name,bytes])=>[name,sha(bytes)])),freeze.rawSourceData,platform);
  assert.ok(![...plan.data.keys()].some(name=>name.startsWith('windows/')));
 }
});

test('the Windows plan is the frozen plan followed by exactly the Windows records',async()=>{
 const shared=await serviceProfilePlan('linux'),windows=await serviceProfilePlan('win32');
 assert.deepEqual(windows.records.slice(0,82),shared.records);
 assert.deepEqual(windows.descriptors.slice(0,82),shared.descriptors);
 assert.deepEqual(windows.records.slice(82).map(record=>record.id),['owned-windows-OwnedLauncherBootstrap','owned-windows-serviceLauncher','owned-windows-OwnedServiceBrowser','owned-windows-leasedDesktopBrowser']);
 for(const [name,bytes]of shared.data)assert.equal(sha(windows.data.get(name)),sha(bytes),name);
 assert.deepEqual([...windows.data.keys()].filter(name=>!shared.data.has(name)).sort(),
  ['windows/owned-windows-OwnedLauncherBootstrap.patch','windows/owned-windows-OwnedServiceBrowser.patch','windows/owned-windows-leasedDesktopBrowser.patch','windows/owned-windows-serviceLauncher.patch','windows/registry.original.json']);
 // Each Windows record continues from the file as the shared records leave it.
 for(const record of windows.records.slice(82)){
  const previous=shared.records.filter(other=>other.target===record.target).at(-1);
  assert.ok(previous,record.target);
  assert.equal(record.beforeSha256,previous.afterSha256,record.id);
  assert.notEqual(record.afterSha256,record.beforeSha256);
  assert.equal(record.kind,undefined);
  // They only remove Unix owner/mode requirements and Unix process handling.
  for(const {before,after}of record.replacements){assert.ok(before&&after&&before!==after);assert.ok(!/getuid|0o[0-7]{3}|\/usr\/bin/.test(after),record.id);}
 }
});
