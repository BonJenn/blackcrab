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
