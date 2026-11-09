import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {inspectInstalledGraph,verifyInstalledGraph,InstalledGraphError} from './installed-graph.mjs';
async function fixture(t,{nested=true,coherent=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-installed-graph-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const write=async(p,value)=>{const file=path.join(root,p);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value))};
 const name='micromark-util-types',version=coherent?'2.0.2':'2.0.3';
 const owner={name:'fixture',version:'1.0.0',workspaces:['apps/*','vendor/t3-mobile/packages/*'],devDependencies:{[name]:version}};
 const app={name:'app',version:'1.0.0',dependencies:{[name]:version}};const shared={name:'shared',version:'1.0.0',dependencies:{[name]:'2.0.2'}};
 const packages={'':owner,'apps/mobile':app,'vendor/t3-mobile/packages/shared':shared,['node_modules/'+name]:{version}};
 if(!coherent)packages['vendor/t3-mobile/packages/shared/node_modules/'+name]={version:'2.0.2'};
 const lock={lockfileVersion:3,packages};await write('package.json',owner);await write('apps/mobile/package.json',app);await write('vendor/t3-mobile/packages/shared/package.json',shared);await write('package-lock.json',lock);
 await write('node_modules/'+name+'/package.json',{name,version});await write('node_modules/'+name+'/index.js','// Note: types exported from `index.d.ts`.\nexport {}\n');
 if(nested&&!coherent)await write('vendor/t3-mobile/packages/shared/node_modules/'+name+'/package.json',{name,version:'2.0.2'});
 return{root,write,lock,owner};
}
test('identical lock digest cannot hide omitted nested2.0.2 falling back to Root2.0.3',async t=>{
 const f=await fixture(t,{nested:false});const before=createHash('sha256').update(await fs.readFile(path.join(f.root,'package-lock.json'))).digest('hex');
 const report=await inspectInstalledGraph({repoRoot:f.root});assert.equal(report.ok,false);
 assert(report.packageDiffs.some(d=>d.location==='vendor/t3-mobile/packages/shared/node_modules/micromark-util-types'&&d.kind==='missing-required-package'));
 const delta=report.resolutionDiffs.find(d=>d.context==='vendor/t3-mobile/packages/shared'&&d.kind==='nearest-resolution');assert.equal(delta.expected.version,'2.0.2');assert.equal(delta.actual.version,'2.0.3');assert.equal(delta.actual.location,'node_modules/micromark-util-types');
 assert.equal(createHash('sha256').update(await fs.readFile(path.join(f.root,'package-lock.json'))).digest('hex'),before);
 await assert.rejects(verifyInstalledGraph({repoRoot:f.root}),error=>error instanceof InstalledGraphError&&error.report.resolutionDiffs.length>0);
});
test('complete old nested graph and coherent new Root2.0.2 graph are accepted',async t=>{
 for(const coherent of [false,true]){const f=await fixture(t,{coherent});const report=await verifyInstalledGraph({repoRoot:f.root});assert.equal(report.ok,true);assert.equal(report.contextEdges,3);assert.equal(report.installedPackageRoots,coherent?1:2);}
});
test('installed version mismatch, unlocked package and escaping source links fail closed',async t=>{
 const f=await fixture(t,{coherent:true});await f.write('node_modules/micromark-util-types/package.json',{name:'micromark-util-types',version:'2.0.3'});assert.equal((await inspectInstalledGraph({repoRoot:f.root})).ok,false);
 await f.write('node_modules/micromark-util-types/package.json',{name:'micromark-util-types',version:'2.0.2'});await f.write('node_modules/unlocked/package.json',{name:'unlocked',version:'1.0.0'});assert((await inspectInstalledGraph({repoRoot:f.root})).packageDiffs.some(d=>d.kind==='unlocked-installed-package'));
 await fs.rm(path.join(f.root,'node_modules/unlocked'),{recursive:true});await fs.rm(path.join(f.root,'node_modules/micromark-util-types'),{recursive:true});const outside=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-graph-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'package.json'),JSON.stringify({name:'micromark-util-types',version:'2.0.2'}));await fs.symlink(outside,path.join(f.root,'node_modules/micromark-util-types'));assert.equal((await inspectInstalledGraph({repoRoot:f.root})).ok,false);
});
test('explicit optional/platform absence is reported distinctly; required absence fails',async t=>{
 const f=await fixture(t,{coherent:true});f.owner.optionalDependencies={'optional-platform':'1.0.0'};f.lock.packages['']=f.owner;f.lock.packages['node_modules/optional-platform']={version:'1.0.0',optional:true,os:['linux']};await f.write('package.json',f.owner);await f.write('package-lock.json',f.lock);
 const report=await verifyInstalledGraph({repoRoot:f.root,platform:'darwin',arch:'arm64'});assert.equal(report.optionalAbsences[0].reason,'optional-platform');
 delete f.lock.packages['node_modules/optional-platform'].optional;await f.write('package-lock.json',f.lock);assert.equal((await inspectInstalledGraph({repoRoot:f.root,platform:'darwin'})).ok,false);
});
test('native-file linked contexts and package source identity are checked too',async t=>{
 const f=await fixture(t,{coherent:true});await f.write('native/module/package.json',{name:'native-module',version:'1.0.0',dependencies:{'micromark-util-types':'2.0.2'}});f.lock.packages['native/module']={name:'native-module',version:'1.0.0',dependencies:{'micromark-util-types':'2.0.2'}};f.lock.packages['node_modules/native-module']={resolved:'native/module',link:true};await fs.symlink('../native/module',path.join(f.root,'node_modules/native-module'));await f.write('package-lock.json',f.lock);
 const report=await verifyInstalledGraph({repoRoot:f.root});assert.equal(report.nativeFileContexts,1);assert(report.contexts.some(c=>c.context==='native/module'&&c.dependencies[0].version==='2.0.2'));
 await f.write('native/module/package.json',{name:'native-module',version:'1.0.0',dependencies:{required:'1.0.0'}});assert.equal((await inspectInstalledGraph({repoRoot:f.root})).ok,false);
});
