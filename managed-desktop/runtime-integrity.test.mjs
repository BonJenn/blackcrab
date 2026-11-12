import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {linkDependencyCache} from './dependencies.mjs';import {assertCanonicalEffect,assertBundleEffectSingleton} from './runtime-integrity.mjs';
test('cache overlays canonicalize identical packages; actual workspace resolution and bundle guards reject a second runtime',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-effect-identity-'));try{
 const [source,primary,secondary]=['source','primary','secondary'].map(x=>path.join(root,x));
 for(const dir of [source,primary,secondary]){await fs.mkdir(path.join(dir,'apps/desktop'),{recursive:true});await fs.mkdir(path.join(dir,'packages/contracts'),{recursive:true});await fs.mkdir(path.join(dir,'scripts'));await fs.writeFile(path.join(dir,'pnpm-lock.yaml'),'same-pinned-lock');}
 const relative='node_modules/.pnpm/effect@4.1.2/node_modules/effect';const metadata=JSON.stringify({name:'effect',version:'4.1.2',exports:{'./package.json':'./package.json'}});
 for(const dir of [primary,secondary]){await fs.mkdir(path.join(dir,relative),{recursive:true});await fs.writeFile(path.join(dir,relative,'package.json'),metadata);}
 async function link(dir,workspace){await fs.mkdir(path.join(dir,workspace,'node_modules'),{recursive:true});await fs.symlink(path.join(dir,relative),path.join(dir,workspace,'node_modules/effect'),'dir');}
 await link(primary,'packages/contracts');await link(secondary,'apps/desktop');
 await linkDependencyCache(source,primary);await linkDependencyCache(source,secondary,{canonicalProducer:primary});
 const expected=await fs.realpath(path.join(primary,relative));assert.equal(await fs.realpath(path.join(source,'apps/desktop/node_modules/effect')),expected);assert.equal((await assertCanonicalEffect(source)).root,expected);
 const maps=path.join(root,'bundle');await fs.mkdir(maps);await fs.writeFile(path.join(maps,'main.cjs.map'),JSON.stringify({sources:[path.join(primary,relative,'src/Schema.ts')]}));assert.equal((await assertBundleEffectSingleton(maps,expected)).copies,1);
 await fs.writeFile(path.join(maps,'main.cjs.map'),JSON.stringify({sources:[path.join(primary,relative,'src/Schema.ts'),path.join(secondary,relative,'src/Schema.ts')]}));await assert.rejects(assertBundleEffectSingleton(maps,expected),/duplicate physical Effect/);
 await fs.unlink(path.join(source,'apps/desktop/node_modules/effect'));await fs.symlink(path.join(secondary,relative),path.join(source,'apps/desktop/node_modules/effect'),'dir');await assert.rejects(assertCanonicalEffect(source),/ONE physical Effect runtime/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('secondary-only consumers resolve canonical Effect through a private dependency closure',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-effect-overlay-'));
 try{
  const [source,primary,secondary]=['source','primary','secondary'].map(n=>path.join(root,n));
  for(const dir of [source,primary,secondary]){
   for(const sub of ['apps/web','packages','scripts'])await fs.mkdir(path.join(dir,sub),{recursive:true});
   await fs.writeFile(path.join(dir,'pnpm-lock.yaml'),'same-lock');
  }
  const effectRelative='node_modules/.pnpm/effect@4.1.2/node_modules/effect';
  for(const dir of [primary,secondary]){
   const effect=path.join(dir,effectRelative);await fs.mkdir(effect,{recursive:true});
   await fs.writeFile(path.join(effect,'package.json'),JSON.stringify({name:'effect',version:'4.1.2',main:'index.cjs'}));
   await fs.writeFile(path.join(effect,'index.cjs'),'module.exports = {};');
   await fs.mkdir(path.join(dir,'apps/web/node_modules'),{recursive:true});
   await fs.symlink(effect,path.join(dir,'apps/web/node_modules/effect'),'dir');
  }
  await fs.mkdir(path.join(secondary,'apps/web/node_modules/.bin'));
  const consumer=path.join(secondary,'node_modules/.pnpm/consumer/node_modules/@effect/atom-react');
  await fs.mkdir(consumer,{recursive:true});
  await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'@effect/atom-react',version:'4.1.2',main:'index.cjs',peerDependencies:{effect:'4.1.2'}}));
  await fs.writeFile(path.join(consumer,'index.cjs'),"module.exports=require('effect');");
  await fs.mkdir(path.join(consumer,'nested'));
  await fs.writeFile(path.join(consumer,'nested/package.json'),'{}');
  await fs.writeFile(path.join(consumer,'nested/index.cjs'),"module.exports=require('@effect/atom-react');");
  await fs.symlink(path.join(secondary,effectRelative),path.resolve(consumer,'../../effect'),'dir');
  await fs.mkdir(path.join(secondary,'apps/web/node_modules/@effect'));
  await fs.symlink(consumer,path.join(secondary,'apps/web/node_modules/@effect/atom-react'),'dir');
  const before=await fs.readlink(path.resolve(consumer,'../../effect'));
  await linkDependencyCache(source,primary);
  await linkDependencyCache(source,secondary,{canonicalProducer:primary});
  const {createRequire}=await import('node:module'),require=createRequire(path.join(source,'apps/web/probe.cjs'));
  assert.equal(require('@effect/atom-react'),require('effect'));
  const overlay=await fs.realpath(path.join(source,'apps/web/node_modules/@effect/atom-react'));
  assert.equal(require(path.join(overlay,'nested/index.cjs')),require('effect'));
  assert.equal((await assertCanonicalEffect(source)).root,await fs.realpath(path.join(primary,effectRelative)));
  assert.ok((await fs.realpath(path.join(source,'apps/web/node_modules/@effect/atom-react'))).startsWith((await fs.realpath(source))+path.sep));
  assert.equal(await fs.readlink(path.resolve(consumer,'../../effect')),before);
  assert.ok((await fs.stat(path.join(source,'apps/web/node_modules/.bin'))).isDirectory());
  await fs.symlink(path.join(secondary,'missing-package'),path.join(secondary,'apps/web/node_modules/broken-package'),'dir');
  await assert.rejects(linkDependencyCache(source,secondary,{canonicalProducer:primary}),{code:'ENOENT'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('relocated React consumers retain pnpm type peers during real TypeScript resolution',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-type-overlay-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const [source,primary,secondary]=['source','primary','secondary'].map(n=>path.join(root,n));
 for(const d of [source,primary,secondary]){for(const n of ['apps/web','packages','scripts'])await fs.mkdir(path.join(d,n),{recursive:true});await fs.writeFile(path.join(d,'pnpm-lock.yaml'),'same-lock');}
 const reactRel='node_modules/.pnpm/react@19/node_modules/react';
 for(const d of [primary,secondary]){const p=path.join(d,reactRel);await fs.mkdir(p,{recursive:true});await fs.writeFile(path.join(p,'package.json'),JSON.stringify({name:'react',version:'19.3.0',main:'index.js'}));await fs.writeFile(path.join(p,'index.js'),'module.exports = {};');}
 const types=path.join(secondary,'node_modules/.pnpm/@types+react@19/node_modules/@types/react');await fs.mkdir(types,{recursive:true});await fs.writeFile(path.join(types,'package.json'),JSON.stringify({name:'@types/react',version:'19.3.0',types:'index.d.ts'}));await fs.writeFile(path.join(types,'index.d.ts'),'export interface SVGProps { className?: string }');
 const hoisted=path.join(secondary,'node_modules/.pnpm/node_modules/@types');await fs.mkdir(hoisted,{recursive:true});await fs.symlink(types,path.join(hoisted,'react'),'dir');
 const consumer=path.join(secondary,'node_modules/.pnpm/icons@1/node_modules/icons');await fs.mkdir(consumer,{recursive:true});await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'icons',version:'1.0.0',types:'index.d.ts',peerDependencies:{react:'*'}}));await fs.writeFile(path.join(consumer,'index.d.ts'),"import type { SVGProps } from 'react'; export type IconProps = SVGProps;");await fs.symlink(path.join(secondary,reactRel),path.join(consumer,'../react'),'dir');
 await fs.mkdir(path.join(secondary,'apps/web/node_modules'),{recursive:true});await fs.symlink(consumer,path.join(secondary,'apps/web/node_modules/icons'),'dir');
 await linkDependencyCache(source,primary);await linkDependencyCache(source,secondary,{canonicalProducer:primary});
 const overlay=await fs.realpath(path.join(source,'apps/web/node_modules/icons'));
 const ts=(await import('typescript')).default;
 const resolved=ts.resolveModuleName('react',path.join(overlay,'index.d.ts'),{moduleResolution:ts.ModuleResolutionKind.Bundler},ts.sys).resolvedModule;
 assert.ok(resolved?.resolvedFileName.endsWith('index.d.ts'));
 assert.equal(await fs.readFile(resolved.resolvedFileName,'utf8'),'export interface SVGProps { className?: string }');
 assert.equal(await fs.readFile(path.join(types,'index.d.ts'),'utf8'),'export interface SVGProps { className?: string }');
});
