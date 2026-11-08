import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.BLACKCRAB_TEST_OWNER_EXPOSURE_MODULE;
test('actual pinned owner exposure service and filesystem adapter', {skip:!modulePath}, async t=>{
 assert(path.isAbsolute(modulePath));
 const {createOwnerExposureRuntime}=await import(pathToFileURL(modulePath));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-owner-exposure-test-'));
 await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const stateHome=path.join(root,'owned-state');await fs.mkdir(stateHome,{mode:0o700});
 const environment={dirname:root,homeDirectory:root,platform:process.platform,processArch:process.arch,
  appVersion:'0.1.7',appPath:root,isPackaged:true,resourcesPath:root,runningUnderArm64Translation:false};
 const input={environment,stateHome,port:19051};
 let service;
 t.after(async()=>{await service?.dispose();});
 await t.test('original defaults expose only a local endpoint',async()=>{
  service=await createOwnerExposureRuntime(input);
  const config=await service.getBackendConfig();assert.equal(config.bindHost,'127.0.0.1');assert.equal(config.port,19051);
  assert.equal(config.tailscaleServeEnabled,false);assert.equal(config.tailscaleServePort,443);
  assert((await service.getAdvertisedEndpoints()).every(x=>x.httpBaseUrl.startsWith('http://127.0.0.1:')));
 });
 await t.test('saved Serve preference survives a fresh runtime without installing a route',async()=>{
  const changed=await service.setTailscaleServeEnabled({enabled:true,port:8443});assert.equal(changed.requiresRelaunch,true);
  await service.dispose();service=null;
  service=await createOwnerExposureRuntime({...input,port:19052});
  const config=await service.getBackendConfig();assert.equal(config.port,19052);assert.equal(config.tailscaleServeEnabled,true);assert.equal(config.tailscaleServePort,8443);
  const disabled=await service.setTailscaleServeEnabled({enabled:false});assert.equal(disabled.state.tailscaleServeEnabled,false);
 });
 await t.test('original interface resolution updates desired bind without opening a listener',async()=>{
  const changed=await service.setMode('network-accessible');assert.equal(changed.state.mode,'network-accessible');assert.equal(changed.requiresRelaunch,true);
  assert.equal((await service.getBackendConfig()).bindHost,'0.0.0.0');
  assert.equal((await service.setMode('local-only')).state.mode,'local-only');
 });
 await t.test('captured port reconfiguration rejects invalid ports',async()=>{
  await service.configure(19053);assert.equal((await service.getBackendConfig()).port,19053);
  await assert.rejects(service.configure(0),/Invalid owner backend port/);
 });
 await t.test('original persistence error preserves its tag and effective state',async()=>{
  const directory=path.join(stateHome,'userdata');await fs.rename(directory,directory+'-saved');await fs.writeFile(directory,'owned fixture obstruction');
  try {
   await assert.rejects(service.setMode('network-accessible'),error=>error._tag==='DesktopServerExposureModePersistenceError');
   assert.equal((await service.getBackendConfig()).bindHost,'127.0.0.1');
  } finally {await fs.unlink(directory);await fs.rename(directory+'-saved',directory);}
 });
 await t.test('relative private-state authority is refused',async()=>{
  await assert.rejects(createOwnerExposureRuntime({...input,stateHome:'relative'}),/Invalid private owner/);
 });
});
