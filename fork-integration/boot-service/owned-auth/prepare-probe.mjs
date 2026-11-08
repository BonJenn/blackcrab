import fs from 'node:fs/promises';import path from 'node:path';import {createRequire}from'node:module';import{createHash}from'node:crypto';
import{sourceMirror}from'./source-mirror.mjs';
import{prepareEffectiveConfigProbe}from'../effective-config/prepare-probe.mjs';
export async function prepareOwnedAuthProbe(options){
 const base=await prepareEffectiveConfigProbe(options),root=base.root,server=path.join(root,'apps/server/src'),here=new URL('.',import.meta.url);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const active=JSON.parse(await fs.readFile(new URL('../../../managed-host/patches/registry.json',here)));
 const boot=JSON.parse(await fs.readFile(new URL('../registry.json',here))).patches;
 const composed=new Map(),chain=[];
 for(const [records,directory]of [[active,new URL('../../../managed-host/patches/',here)],[boot,new URL('../',here)]])for(const record of records){
  let before=composed.get(record.target);if(before===undefined)try{before=await fs.readFile(path.join(options.sourceRoot,record.target))}catch(error){if(error.code!=='ENOENT')throw error;}
  if(hash(await fs.readFile(new URL(record.file,directory)))!==record.sha256)throw Error('Patch bytes changed '+record.id);
  let after;
  if(record.kind==='payload'){if(before!==undefined||record.beforeSha256!==null)throw Error('Payload predecessor exists');after=await fs.readFile(new URL(record.file,directory));}
  else{if(before===undefined||hash(before)!==record.beforeSha256)throw Error('Predecessor mismatch '+record.id);let text=before.toString();for(const replacement of record.replacements){if(text.split(replacement.before).length!==2)throw Error('Ambiguous replacement');text=text.replace(replacement.before,()=>replacement.after);}after=Buffer.from(text);}
  if(hash(after)!==record.afterSha256)throw Error('Result mismatch '+record.id);composed.set(record.target,after);chain.push({id:record.id,target:record.target,beforeSha256:record.beforeSha256,afterSha256:record.afterSha256});
 }
 const {stage}=await sourceMirror(root,options.sourceRoot);
 // Base developer scaffold includes a query-only identity refactor. It is NOT
 // part of this service chain; restore exact original before bundling Config.
 await stage('apps/server/src/environment/ServerEnvironment.ts',await fs.readFile(path.join(options.sourceRoot,'apps/server/src/environment/ServerEnvironment.ts')));
 for(const [target,bytes]of composed)await stage(target,bytes);
 const own=JSON.parse(await fs.readFile(new URL('registry.json',here)));
 const backend=JSON.parse(await fs.readFile(new URL('../backend-identity/registry.json',here)));
 async function fixtureRecords(registry,directory){for(const record of registry.patches){const before=composed.get(record.target)??await fs.readFile(path.join(options.sourceRoot,record.target));if(hash(before)!==record.beforeSha256||hash(await fs.readFile(new URL(record.file,directory)))!==record.sha256)throw Error('Fixture predecessor/diff changed '+record.id);const stem=path.basename(record.target,'.ts');const after=await fs.readFile(new URL('fixtures/'+stem+'.after.ts',directory));if(hash(after)!==record.afterSha256)throw Error('Fixture result changed '+record.id);composed.set(record.target,after);await stage(record.target,after);chain.push({id:record.id,target:record.target,beforeSha256:record.beforeSha256,afterSha256:record.afterSha256});}for(const record of registry.addedSources){const bytes=await fs.readFile(new URL(record.file,directory));if(hash(bytes)!==record.sha256)throw Error('Added source changed '+record.id);composed.set(record.target,bytes);await stage(record.target,bytes);chain.push({id:record.id,target:record.target,beforeSha256:null,afterSha256:record.sha256});}}
 await fixtureRecords(own,here);
 const identity=JSON.parse(await fs.readFile(new URL('../../owner-control/identity-v2/registry.json',here)));
 for(const record of identity){const bytes=await fs.readFile(new URL('../../owner-control/identity-v2/patches/'+record.file,here));if(hash(bytes)!==record.sha256)throw Error('Identity patch changed');const before=composed.get(record.target);let after;if(record.kind==='payload'){if(before!==undefined)throw Error('Identity payload exists');after=bytes;}else{if(!before||hash(before)!==record.beforeSha256)throw Error('Identity predecessor changed');let text=before.toString();for(const r of record.replacements){if(text.split(r.before).length!==2)throw Error('Identity replacement differs');text=text.replace(r.before,()=>r.after);}after=Buffer.from(text);}if(hash(after)!==record.afterSha256)throw Error('Identity result differs');composed.set(record.target,after);await stage(record.target,after);chain.push({id:record.id,target:record.target,beforeSha256:record.beforeSha256,afterSha256:record.afterSha256});}
 await fixtureRecords(backend,new URL('../backend-identity/',here));
 await fs.writeFile(path.join(root,'composed-chain.json'),JSON.stringify({activeCount:active.length,bootCount:boot.length,ownedAuthCount:own.patches.length+own.addedSources.length,identityCount:identity.length,backendCount:backend.patches.length+backend.addedSources.length,chain},null,2)+'\n');
 await stage('ConfigProbe.ts',await fs.readFile(new URL('ConfigProbe.ts',here)));
 const pnpm=path.join(options.dependencyCache,'node_modules/.pnpm'),effect=path.join(pnpm,'effect@4.1.2/node_modules/effect'),platform=path.join(pnpm,'@effect+platform-node@4.1.2_bufferutil@4.1.0_effect@4.1.2_redis@6.2.1_utf-8-validate@6.0.6/node_modules/@effect/platform-node');
 const require=createRequire(import.meta.url),esbuild=require(path.join(pnpm,'esbuild@0.28.2/node_modules/esbuild/lib/main.js')),output=path.join(root,'owned-config-probe.mjs');
 const built=await esbuild.build({entryPoints:[path.join(root,'ConfigProbe.ts')],outfile:output,bundle:true,preserveSymlinks:true,platform:'node',format:'esm',target:'node26',metafile:true,logLevel:'silent',nodePaths:[path.join(pnpm,'node_modules')],alias:{effect:path.join(effect,'dist'),'@effect/platform-node':path.join(platform,'dist')},external:['ffi-rs'],plugins:[{name:'original-workspaces',setup(build){build.onResolve({filter:/^@t3tools\/(contracts|shared|tailscale)(?:\/|$)/},async args=>{const m=args.path.match(/^@t3tools\/(contracts|shared|tailscale)(?:\/(.*))?$/),stem=path.join(root,'packages',m[1],'src',m[2]??'index');for(const f of [stem+'.ts',path.join(stem,'index.ts')])try{if((await fs.stat(f)).isFile())return{path:f}}catch{}throw Error('Missing source '+args.path)})}}],banner:{js:"import{createRequire as __r}from'node:module';const require=__r(import.meta.url);"}});
 const inputs=await Promise.all(Object.keys(built.metafile.inputs).map(async f=>({path:path.resolve(f),sha256:createHash('sha256').update(await fs.readFile(path.resolve(f))).digest('hex')})));
 for(const input of inputs){for(const origin of [root,options.dependencyCache,options.sourceRoot,await fs.realpath(options.sourceRoot)]){const rel=path.relative(origin,input.path);if((rel.startsWith('apps/')||rel.startsWith('packages/'))&&!rel.startsWith('../')){let expected=composed.get(rel);if(expected===undefined)expected=await fs.readFile(path.join(options.sourceRoot,rel));if(hash(expected)!==input.sha256)throw Error('Unregistered service-graph source differs '+rel);}}}
 const roots=new Set(inputs.map(x=>x.path.match(/^(.*\/node_modules\/effect)\/dist\//)?.[1]).filter(Boolean));if(roots.size!==1)throw Error('Multiple Effect roots');
 await fs.writeFile(path.join(root,'owned-build.json'),JSON.stringify({candidateOnly:true,inputs,effectRoots:[...roots]},null,2)+'\n');
 const ts=JSON.parse(await fs.readFile(base.tsconfig));ts.files=[path.join(server,'OwnedServiceAuthBootstrap.ts')];await fs.writeFile(base.tsconfig,JSON.stringify(ts));
 return {...base,entry:output};
}
