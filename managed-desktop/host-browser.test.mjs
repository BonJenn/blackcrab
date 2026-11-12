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
 const shared=registry.find(r=>r.target==='packages/shared/src/leasedDesktopBrowser.ts');assert.equal(shared.afterSha256,await fileDigest(new URL('./patches/gate-c-5.ts',import.meta.url)));
 const channel=await fs.readFile(path.join(root,'apps/server/src/preview/DesktopBrowserChannel.ts'),'utf8');assert.ok(channel.includes('mutually exclusive'));assert.ok(channel.includes('const inputFd = config.desktopBrowserFd'));assert.ok(channel.includes('const controlFd = config.desktopBrowserControlFd'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
