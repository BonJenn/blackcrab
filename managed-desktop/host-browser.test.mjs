import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {applyHostBrowserRequirements} from './host-browser-requirements/apply.mjs';import {digest,fileDigest} from './artifact.mjs';
const base=new URL('./host-browser-requirements/',import.meta.url);
test('staged host registry replays exact source after proof9; invalid base refuses before mutation',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-host-browser-')));try{
 const requirements=JSON.parse(await fs.readFile(new URL('base.json',base),'utf8')),registry=JSON.parse(await fs.readFile(new URL('registry.json',base),'utf8'));
 for(const pre of requirements.preconditions){const target=path.join(root,pre.target);await fs.mkdir(path.dirname(target),{recursive:true});const data=await fs.readFile(new URL(pre.fixture,base));assert.equal(digest(data),pre.sha256);await fs.writeFile(target,data);}
 for(const record of registry){const target=path.join(root,record.target);await fs.mkdir(path.dirname(target),{recursive:true});assert.equal(await fileDigest(new URL(record.file,base)),record.sha256);if(record.kind!=='payload')await fs.writeFile(target,record.replacements[0].before);}
 const first=registry.find(r=>r.kind!=='payload'),before=await fs.readFile(path.join(root,first.target));const pre=requirements.preconditions[0],prePath=path.join(root,pre.target),actual=await fs.readFile(prePath);await fs.writeFile(prePath,'wrong base');await assert.rejects(applyHostBrowserRequirements(root),/exact proof9/);assert.deepEqual(await fs.readFile(path.join(root,first.target)),before);await fs.writeFile(prePath,actual);
 await applyHostBrowserRequirements(root);for(const record of registry)assert.equal(await fileDigest(path.join(root,record.target)),record.afterSha256);
 const shared=registry.find(r=>r.target==='packages/shared/src/leasedDesktopBrowser.ts');
 // The workspace's copy also speaks to a Windows service over a named pipe. The macOS and Linux service keeps the copy above; the Windows service reaches the workspace's exact bytes through its own record.
 const windows=JSON.parse(await fs.readFile(new URL('../fork-integration/boot-service/windows/registry.json',import.meta.url),'utf8')).patches.find(r=>r.id==='owned-windows-leasedDesktopBrowser');
 const workspace=await fs.readFile(new URL('./patches/gate-c-5.ts',import.meta.url),'utf8');assert.equal(windows.replacements.length,2);for(const {before,after} of windows.replacements){assert.ok(workspace.includes(after));assert.ok(!workspace.includes(before));}
 const channel=await fs.readFile(path.join(root,'apps/server/src/preview/DesktopBrowserChannel.ts'),'utf8');assert.ok(channel.includes('mutually exclusive'));assert.ok(channel.includes('const inputFd = config.desktopBrowserFd'));assert.ok(channel.includes('const controlFd = config.desktopBrowserControlFd'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
