import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {stageRuntimeDependencies} from './dependencies.mjs';
import {inventory} from './artifact-data.mjs';

async function setup(t,dependencies={'playwright-core':'1.0.0'}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-physical-deps-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3}));
 const source=path.join(root,'source'),desktop=path.join(source,'apps/desktop'),output=path.join(root,'output');await fs.mkdir(desktop,{recursive:true});await fs.mkdir(output);await fs.writeFile(path.join(desktop,'package.json'),JSON.stringify({dependencies}));
 async function pkg(parent,name,meta={},code='module.exports = {};'){
  const dir=path.join(parent,'node_modules',name);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name,version:'1.0.0',main:'index.cjs',...meta}));await fs.writeFile(path.join(dir,'index.cjs'),code);await fs.writeFile(path.join(dir,'LICENSE'),'Fixture license');return dir;
 }
 return{root,source,desktop,output,pkg};
}
test('physical closure survives relocation without source links and preserves nested versions/cycles',async t=>{
 const f=await setup(t);const p=await f.pkg(f.desktop,'playwright-core',{dependencies:{a:'1',b:'1'},optionalDependencies:{absent:'1'}},"exports.marker='root';exports.a=require('a');exports.b=require('b');");
 await f.pkg(p,'a',{},"module.exports='a1';");
 const b=await f.pkg(p,'b',{dependencies:{a:'2','playwright-core':'1'}},"module.exports={a:require('a'),parent:require('playwright-core').marker};");await f.pkg(b,'a',{version:'2.0.0'},"module.exports='a2';");
 const result=await stageRuntimeDependencies(f.source,f.output,{targetId:'win32-x64'});assert.equal(result.layout,'physical-node-modules');assert.equal(result.packages.length,4);assert.equal(result.missingOptional[0].name,'absent');
 const files=await inventory(f.output,{targetId:'win32-x64'});assert(files.every(e=>e.type!=='symlink'));assert.equal(files.filter(e=>e.path.endsWith('/LICENSE')).length,4);
 const moved=path.join(f.root,'relocated');await fs.rename(f.output,moved);await fs.rm(f.source,{recursive:true,force:true});
 assert.deepEqual(createRequire(path.join(moved,'entry.cjs'))('playwright-core'),{marker:'root',a:'a1',b:{a:'a2',parent:'root'}});
});
test('required target native addon cannot disappear as an optional dependency',async t=>{
 const f=await setup(t,{'@napi-rs/keyring':'1.3.0'});await f.pkg(f.desktop,'@napi-rs/keyring',{version:'1.3.0',optionalDependencies:{'@napi-rs/keyring-win32-x64-msvc':'1.3.0'}});
 await assert.rejects(stageRuntimeDependencies(f.source,f.output,{targetId:'win32-x64'}),/Cannot locate.*win32-x64-msvc/);
});
test('target-incompatible optional packages are excluded but the native companion is copied',async t=>{
 const f=await setup(t,{'@napi-rs/keyring':'1.3.0'}),p=await f.pkg(f.desktop,'@napi-rs/keyring',{version:'1.3.0',optionalDependencies:{'@napi-rs/keyring-win32-x64-msvc':'1.3.0',foreign:'1'}});
 await f.pkg(p,'@napi-rs/keyring-win32-x64-msvc',{version:'1.3.0',os:['win32'],cpu:['x64']});await f.pkg(p,'foreign',{os:['darwin']});
 const r=await stageRuntimeDependencies(f.source,f.output,{targetId:'win32-x64'});assert.equal(r.packages.length,2);assert.equal(r.missingOptional[0].name,'foreign');
});
test('a package content link escaping the source package is rejected',async t=>{
 const f=await setup(t),p=await f.pkg(f.desktop,'playwright-core');const outside=path.join(f.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'file'),'unchanged');await fs.symlink(outside,path.join(p,'escape'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(stageRuntimeDependencies(f.source,f.output,{targetId:'win32-x64'}),/link escapes/);assert.equal(await fs.readFile(path.join(outside,'file'),'utf8'),'unchanged');
});
test('physical staging refuses overwriting an existing dependency tree',async t=>{
 const f=await setup(t);await f.pkg(f.desktop,'playwright-core');await fs.mkdir(path.join(f.output,'node_modules'));await fs.writeFile(path.join(f.output,'node_modules/keep'),'original');await assert.rejects(stageRuntimeDependencies(f.source,f.output,{targetId:'linux-x64'}),{code:'EEXIST'});assert.equal(await fs.readFile(path.join(f.output,'node_modules/keep'),'utf8'),'original');
});
