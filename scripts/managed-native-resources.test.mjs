import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {prepareManagedNativeResources,parseManagedResourceArgs} from './managed-native-resources.mjs';
import {writeArtifactManifest,UPSTREAM,NODE_VERSION,PNPM_VERSION} from '../managed-host/artifact.mjs';
import {writeManifest} from '../managed-desktop/artifact.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,role){const root=await fs.mkdtemp(path.join(os.tmpdir(),`native-${role}-`));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const put=async(name,bytes='fixture')=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),bytes);};
 const base=new URL(`../managed-${role}/`,import.meta.url);const registry=JSON.parse(await fs.readFile(new URL('patches/registry.json',base),'utf8'));
 await fs.cp(new URL('patches/',base),path.join(root,'source-patches'),{recursive:true});
 if(role==='desktop') { for(const folder of ['runtime','assets','host-requirements'])await fs.cp(new URL(folder+'/',base),path.join(root,folder),{recursive:true});for(const file of ['descriptor.mjs','attachment.mjs'])await fs.copyFile(new URL(file,base),path.join(root,file)); }
 for(const patch of registry){const destination=path.join(root,'source-patches',patch.file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(new URL('patches/'+patch.file,base),destination);}
 const sourcePatches=registry.map(({id,sha256})=>({id,sha256}));
 if(role==='host'){
  for(const name of ['t3','client/index.html','LICENSE.upstream','THIRD-PARTY-NOTICES','resource-monitor/t3-resource-monitor'])await put(name);
  await fs.chmod(path.join(root,'t3'),0o755);await fs.chmod(path.join(root,'resource-monitor/t3-resource-monitor'),0o755);
  await put('BUILD-PROVENANCE.json',JSON.stringify({upstream:UPSTREAM,sourcePatches,node:NODE_VERSION,pnpm:PNPM_VERSION,signing:'local-only',target:`${process.platform}-${process.arch}`}));
  await writeArtifactManifest(root,{platform:process.platform,arch:process.arch,sourcePatches});
 }else{
  const app='Blackcrab.app/Contents/Resources/app/';
  for(const name of ['Blackcrab.app/Contents/MacOS/Blackcrab',`${app}apps/desktop/dist-electron/main.cjs`,`${app}apps/desktop/dist-electron/preload.cjs`,`${app}apps/server/dist/client/index.html`,'LICENSE.upstream','LICENSE.electron','BUILD-PROVENANCE.json'])await put(name);
  await put(`${app}package.json`,JSON.stringify({blackcrabManagedClient:'production'}));
  for(const asset of JSON.parse(await fs.readFile(new URL('assets/registry.json',base),'utf8'))){
   // Registry assets are copied from the producer-owned originals, not fabricated hashes.
   const assetRoot=new URL('assets/',base);const entries=await fs.readdir(assetRoot);
   let found=false;for(const entry of entries){const candidate=new URL(entry,assetRoot);const stat=await fs.stat(candidate);if(stat.isFile()){const bytes=await fs.readFile(candidate);if(sha(bytes)===asset.afterSha256){await put(app+asset.target,bytes);found=true;break;}}}
   assert.equal(found,true,`asset fixture ${asset.target}`);
  }
  await put('Blackcrab.app/Contents/Frameworks/Fixture.framework/Versions/A/binary','signaturebytes');await fs.chmod(path.join(root,'Blackcrab.app/Contents/Frameworks/Fixture.framework/Versions/A/binary'),0o755);await fs.symlink('A',path.join(root,'Blackcrab.app/Contents/Frameworks/Fixture.framework/Versions/Current'));await fs.symlink('Versions/Current/binary',path.join(root,'Blackcrab.app/Contents/Frameworks/Fixture.framework/binary'));
  await writeManifest(root,{sourcePatches,availability:{}});
 }
 return {root,put};}
test('resource flags are consumed without changing ordinary Tauri arguments',()=>{
 assert.deepEqual(parseManagedResourceArgs(['--signed','--managed-host','/host','--target','aarch64-apple-darwin','--managed-desktop','/desktop']),{args:['--signed','--target','aarch64-apple-darwin'],host:'/host',desktop:'/desktop'});
 for(const args of [['--managed-host'],['--managed-desktop','--signed'],['--managed-host','a','--managed-host','b']])assert.throws(()=>parseManagedResourceArgs(args));
});
test('absent flags clear inherited trust hashes while preserving unrelated environment',async()=>{
 const result=await prepareManagedNativeResources({env:{KEEP:'yes',BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256:'stale',BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256:'stale',BLACKCRAB_EMBEDDED_DESKTOP_ARCHIVE_SHA256:'stale',BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256:'stale'}});
 assert.deepEqual(result.env,{KEEP:'yes'});assert.deepEqual(result.config.bundle.resources,{});
});
test('verified host mapping pins actual manifest bytes and rejects content/source tampering',async t=>{
 const {root,put}=await fixture(t,'host');const result=await prepareManagedNativeResources({host:root,env:{}});t.after(result.cleanup);
 assert.equal(result.env.BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256,sha(await fs.readFile(path.join(root,'blackcrab-managed-host.json'))));
 assert.deepEqual(Object.values(result.config.bundle.resources),['managed-host-payload.tar.gz']);assert.equal(result.env.BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256,sha(await fs.readFile(Object.keys(result.config.bundle.resources)[0])));
 await put('t3','tamper');await assert.rejects(prepareManagedNativeResources({host:root}),/integrity/);
});
test('host self-consistent inventory cannot substitute reviewed patch records',async t=>{
 const {root}=await fixture(t,'host');const file=path.join(root,'blackcrab-managed-host.json');const manifest=JSON.parse(await fs.readFile(file));manifest.sourcePatches=[];await fs.writeFile(file,JSON.stringify(manifest));
 await assert.rejects(prepareManagedNativeResources({host:root}),/provenance/);
});
test('production desktop mapping verifies role and refuses rehashed QA application role',async t=>{
 const {root,put}=await fixture(t,'desktop');const result=await prepareManagedNativeResources({desktop:root,env:{},target:'aarch64-apple-darwin'});t.after(result.cleanup);
 assert.equal(result.env.BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256,sha(await fs.readFile(path.join(root,'blackcrab-managed-desktop.json'))));
 await put('Blackcrab.app/Contents/Resources/app/package.json',JSON.stringify({blackcrabManagedClient:'qa'}));
 const registry=JSON.parse(await fs.readFile(new URL('../managed-desktop/patches/registry.json',import.meta.url),'utf8'));
 await writeManifest(root,{sourcePatches:registry.map(({id,sha256})=>({id,sha256})),availability:{}});
 await assert.rejects(prepareManagedNativeResources({desktop:root,target:'aarch64-apple-darwin'}),/role/);
});

test('resource target must match bundled architecture; universal cannot reuse one binary',async()=>{
 await assert.rejects(prepareManagedNativeResources({desktop:'/unused',target:'x86_64-apple-darwin'}),/darwin-arm64/);
 await assert.rejects(prepareManagedNativeResources({host:'/unused',target:'universal-apple-darwin'}),/single-architecture/);
});

test('native wrapper preserves signed/local flags and passes only freshly verified trust to child',async t=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 const {root}=await fixture(t,'host');const bin=await fs.mkdtemp(path.join(os.tmpdir(),'tauri-stub-'));t.after(()=>fs.rm(bin,{recursive:true,force:true}));
 const output=path.join(bin,'captured.json');await fs.writeFile(path.join(bin,'npx'),`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.CAPTURE,JSON.stringify({args:process.argv.slice(2),desktop:process.env.BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256,host:process.env.BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256}));\n`,{mode:0o755});
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,CAPTURE:output,BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256:'stale',BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256:'stale',TAURI_SIGNING_PRIVATE_KEY:'fixture-only-not-a-key'};
 const script=new URL('./tauri-build.mjs',import.meta.url);
 await run(process.execPath,[fileURLToPath(script),'--local','--bundles','app','--managed-host',root],{env});
 let captured=JSON.parse(await fs.readFile(output));assert.equal(captured.desktop,undefined);assert.equal(captured.host,sha(await fs.readFile(path.join(root,'blackcrab-managed-host.json'))));assert.equal(captured.args.includes('--managed-host'),false);
 const configs=captured.args.flatMap((arg,i)=>arg==='--config'?[JSON.parse(captured.args[i+1])]:[]);assert.equal(configs[0].bundle.createUpdaterArtifacts,false);const archive=Object.keys(configs[1].bundle.resources)[0];assert.equal(configs[1].bundle.resources[archive],'managed-host-payload.tar.gz');await assert.rejects(fs.stat(archive),{code:'ENOENT'});
 await run(process.execPath,[fileURLToPath(script),'--signed','--bundles','app'],{env});captured=JSON.parse(await fs.readFile(output));assert.deepEqual(captured.args,['tauri','build','--bundles','app']);assert.equal(captured.host,undefined);assert.equal(captured.desktop,undefined);
});

test('archive preparation rejects control paths and source hard links',async t=>{
 const {root,put}=await fixture(t,'host');await put('bad\nname','unsafe');
 const manifest=JSON.parse(await fs.readFile(path.join(root,'blackcrab-managed-host.json')));await fs.unlink(path.join(root,'blackcrab-managed-host.json'));
 await writeArtifactManifest(root,{platform:process.platform,arch:process.arch,sourcePatches:manifest.sourcePatches});
 await assert.rejects(prepareManagedNativeResources({host:root}),/Control character/);
 await fs.unlink(path.join(root,'bad\nname'));await fs.link(path.join(root,'t3'),path.join(root,'hardlinked'));
 await fs.unlink(path.join(root,'blackcrab-managed-host.json'));await writeArtifactManifest(root,{platform:process.platform,arch:process.arch,sourcePatches:manifest.sourcePatches});
 await assert.rejects(prepareManagedNativeResources({host:root}),/hard link/);
});

test('actual Tauri bundle-only keeps both opaque resource archives byte-identical', {skip:!process.env.BLACKCRAB_TEST_TAURI_BUNDLE_BINARY},async t=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 const desktop=await fixture(t,'desktop'),host=await fixture(t,'host');
 const prepared=await prepareManagedNativeResources({desktop:desktop.root,host:host.root,env:{}});t.after(prepared.cleanup);
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'tauri-archive-proof-'));t.after(()=>fs.rm(project,{recursive:true,force:true}));
 for(const name of ['src','dist','target/debug'])await fs.mkdir(path.join(project,name),{recursive:true});
 await fs.writeFile(path.join(project,'src/main.rs'),'fn main() {}\n');await fs.writeFile(path.join(project,'dist/index.html'),'fixture');
 await fs.writeFile(path.join(project,'Cargo.toml'),'[package]\nname="blackcrab"\nversion="0.1.0"\nedition="2021"\n');
 await fs.copyFile(process.env.BLACKCRAB_TEST_TAURI_BUNDLE_BINARY,path.join(project,'target/debug/blackcrab'));await fs.chmod(path.join(project,'target/debug/blackcrab'),0o755);
 await fs.writeFile(path.join(project,'tauri.conf.json'),JSON.stringify({productName:'BlackcrabArchiveProof',version:'0.1.0',identifier:'com.blackcrab.disposable-archive-proof',build:{frontendDist:'./dist'},bundle:{active:true,createUpdaterArtifacts:false,icon:[],resources:prepared.config.bundle.resources}}));
 const env={...process.env,CARGO_TARGET_DIR:path.join(project,'target')};for(const key of Object.keys(env))if(key.startsWith('APPLE_')||key.startsWith('TAURI_SIGNING')||key.startsWith('CSC_'))delete env[key];
 const result=await run(process.execPath,[fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js',import.meta.url)),'bundle','--debug','--bundles','app','--no-sign'],{cwd:project,env,timeout:45000,maxBuffer:1024*1024});
 const blobs={};for(const [source,name] of Object.entries(prepared.config.bundle.resources)){
  const bundled=path.join(project,'target/debug/bundle/macos/BlackcrabArchiveProof.app/Contents/Resources',name);
  const original=sha(await fs.readFile(source)),embedded=sha(await fs.readFile(bundled));assert.equal(embedded,original);blobs[name]={sha256:embedded,bytes:(await fs.stat(bundled)).size};
 }
 t.diagnostic(JSON.stringify({blobs,trust:prepared.env,log:result.stderr}));
});
