import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {artifactFixture} from './testing/artifact-fixture.mjs';
import {inventory,writeManifest,verifyArtifact,MANIFEST,fileDigest,ELECTRON} from './artifact.mjs';
import {validateTargetEntries} from './artifact-data.mjs';

async function fixture(t,target){const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-portable-artifact-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const manifest=await artifactFixture(root,target);return{root,manifest};}
async function verify(root,target){return verifyArtifact(root,{expectedTarget:target,expectedManifestSha256:await fileDigest(path.join(root,MANIFEST))});}
async function refresh(root,target){const m=JSON.parse(await fs.readFile(path.join(root,MANIFEST)));m.files=await inventory(root,{targetId:target});await fs.writeFile(path.join(root,MANIFEST),JSON.stringify(m));}
for(const target of (process.platform==='win32'?['win32-x64']:['linux-x64','win32-x64'])) {
 test(`${target}: explicit target and manifest pin bind the complete artifact`,async t=>{
  const{root,manifest}=await fixture(t,target);
  assert.equal(manifest.format,2);assert.equal((await verify(root,target)).target,target);
  await assert.rejects(verifyArtifact(root),/provenance/);
  await assert.rejects(verify(root,target==='linux-x64'?'win32-x64':'linux-x64'),/provenance/);
  await assert.rejects(verifyArtifact(root,{expectedTarget:target,expectedManifestSha256:'0'.repeat(64)}),/trust digest/);
  await assert.rejects(verifyArtifact(root,{expectedTarget:target,allowQA:true}),/Mac QA/);
  await fs.appendFile(path.join(root,'resources/app/apps/desktop/dist-electron/main.cjs'),'tampered');
  await assert.rejects(verify(root,target),/integrity/);
 });
 test(`${target}: refreshing inventory cannot hide a wrong target, boot entry or missing payload`,async t=>{
  const{root}=await fixture(t,target),file=path.join(root,'BUILD-PROVENANCE.json');
  const original=await fs.readFile(file,'utf8'),provenance=JSON.parse(original);
  provenance.target='darwin-arm64';await fs.writeFile(file,JSON.stringify(provenance));await refresh(root,target);
  await assert.rejects(verify(root,target),/target\/build provenance/);
  await fs.writeFile(file,original);
  const pkgfile=path.join(root,'resources/app/package.json'),pkg=JSON.parse(await fs.readFile(pkgfile));pkg.main='main.cjs';await fs.writeFile(pkgfile,JSON.stringify(pkg));await refresh(root,target);
  await assert.rejects(verify(root,target),/target\/build provenance/);
  pkg.main='apps/desktop/dist-electron/boot.cjs';await fs.writeFile(pkgfile,JSON.stringify(pkg));
  await fs.rm(path.join(root,'resources/app/apps/desktop/dist-electron/boot.cjs'));await refresh(root,target);
  await assert.rejects(verify(root,target),/missing.*boot.cjs/);
 });
}
test('Windows inventory rejects device names, trailing aliases, case collisions and links',()=>{
 for(const name of ['NUL.txt','a/COM1','lpt².txt','a/trailing.','a/trailing ','a/b?c','a/b:c','a/b\\c','a/\u0001'])assert.throws(()=>validateTargetEntries([{path:name,type:'file'}],'win32-x64'),/Unsafe/);
 assert.throws(()=>validateTargetEntries([{path:MANIFEST.toUpperCase(),type:'file'}],'win32-x64'),/alias/);
 assert.throws(()=>validateTargetEntries([{path:'App',type:'directory'},{path:'app',type:'directory'}],'win32-x64'),/alias/);
 assert.throws(()=>validateTargetEntries([{path:'a',type:'file'},{path:'b',type:'symlink',target:'a'}],'win32-x64'),/links are not portable/);
});
test('Windows inventories ignore POSIX execute bits; Mac serialization remains format 1',async t=>{
 const{root,manifest}=await fixture(t,'win32-x64');assert(manifest.files.filter(e=>e.type==='file').every(e=>!Object.hasOwn(e,'executable')));
 const file=path.join(root,'resources/app/package.json');await fs.chmod(file,0o755);assert.deepEqual(await inventory(root,{targetId:'win32-x64'}),manifest.files);
 const mac=await writeManifest(root,{sourcePatches:[],availability:{}});assert.equal(mac.format,1);assert.equal(Object.hasOwn(mac,'target'),false);assert.deepEqual(mac.electron,ELECTRON);
 await assert.rejects(writeManifest(root,{sourcePatches:[],availability:{},targetId:'linux-x64',qaPolicy:[]}),/Mac QA/);
});
if(process.platform!=='win32')test('Linux portable manifest requires a native executable with execute permission',async t=>{
 const{root}=await fixture(t,'linux-x64'),exe=path.join(root,'Blackcrab');
 const original=await fs.readFile(exe);await fs.writeFile(exe,Buffer.alloc(128));await refresh(root,'linux-x64');await assert.rejects(verify(root,'linux-x64'),/format\/architecture/);
 await fs.writeFile(exe,original);await fs.chmod(exe,0o644);await refresh(root,'linux-x64');await assert.rejects(verify(root,'linux-x64'),/permission missing/);
});
