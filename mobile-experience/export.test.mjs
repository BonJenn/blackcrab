import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildMobileExperience,inventoryExperience,resolveExperienceDependencies,SUPPORT_FILES} from './export.mjs';
function pkg(){return{name:'mobile',folder:'apps/mobile',originalManifest:{dependencies:{effect:'catalog:'},devDependencies:{typescript:'6.0.3'}},dependencies:{external:['effect']}};}
test('per-owner pins retain group, complete resolution and declared specifier',()=>{
 const lock='importers:\n  apps/mobile:\n    dependencies:\n      effect: {specifier: "catalog:", version: "4.1.2(peer@1)"}\n    devDependencies:\n      typescript: {specifier: "6.0.3", version: "6.0.3"}\n';
 const result=resolveExperienceDependencies(lock,[pkg()]);assert.equal(result.owners[0].groups.dependencies.effect.resolution,'4.1.2(peer@1)');assert.deepEqual(result.owners[0].actualExternalEdges,[{name:'effect',manifestName:'effect',groups:['dependencies']}]);
 assert.throws(()=>resolveExperienceDependencies(lock.replace('catalog:', '^4'),[pkg()]),/mismatch/);
 assert.throws(()=>resolveExperienceDependencies(lock,[{...pkg(),dependencies:{external:['undeclared']}}]),/lacks owned/);
 assert.throws(()=>resolveExperienceDependencies(lock+'---\n'+lock,[pkg()]),/one complete/);
});
test('archive authentication rejects arbitrary bytes without exporting',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-export-auth-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const archive=path.join(root,'fake.tar.gz');await fs.writeFile(archive,'not the pinned archive');await assert.rejects(buildMobileExperience({archive,cacheDir:root,output:path.join(root,'output')}),/pinned T3/);await assert.rejects(fs.stat(path.join(root,'output')),{code:'ENOENT'});
});
test('inventory retains native registrations, assets and all generator inputs; rejects links',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-export-inventory-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const put=async(p,b='x')=>{const target=path.join(root,p);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,b);};
 for(const file of [...SUPPORT_FILES,'third-party-licenses/spdx/MIT.json','assets/icon.png','scripts/tool.ts','patches/native.patch','apps/mobile/modules/native/ios/Native.swift','apps/mobile/modules/native/expo-module.config.json','apps/mobile/scripts/generate-device-stream.mts','apps/mobile/src/features/devices/device-stream.browser.ts','apps/mobile/src/features/browser/preview-stream.browser.ts','scripts/lib/third-party-licenses.ts'])await put(file);
 const a=await inventoryExperience(root,{files:[],packages:[]});assert.equal(a.nativeModules.length,1);assert.ok(a.files.includes('assets/icon.png'));assert.ok(a.files.includes('third-party-licenses/spdx/MIT.json'));assert.ok(a.files.includes('apps/server/src/device/deviceToolVersions.json'));assert.ok(a.files.includes('native/libghostty-vt/LICENSE'));assert.ok(a.nativeModules[0].registrations.includes('apps/mobile/modules/native/expo-module.config.json'));assert.equal(a.generatedAliases.length,3);
 await fs.symlink(path.join(root,'assets/icon.png'),path.join(root,'apps/mobile/linked'));await assert.rejects(inventoryExperience(root,{files:[],packages:[]}),/Symlink/);
});

test('export verifier rejects extra files and source/metadata tampering even with outer hashes updated',async t=>{
 const {createHash}=await import('node:crypto');const {UPSTREAM}=await import('../managed-host/artifact.mjs');const {analyzeMobileExperience}=await import('./graph.mjs');const {verifyExperienceExport}=await import('./export.mjs');
 const hash=b=>createHash('sha256').update(b).digest('hex'),serialize=x=>JSON.stringify(x,null,2)+'\n';
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-export-verify-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source');
 const put=async(p,b='x')=>{const target=path.join(source,p);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,b);};
 for(const file of [...SUPPORT_FILES,'third-party-licenses/spdx/MIT.json','assets/icon.png','scripts/tool.ts','patches/native.patch','apps/mobile/modules/native/ios/Native.swift','apps/mobile/scripts/generate-device-stream.mts','apps/mobile/src/features/devices/device-stream.browser.ts','apps/mobile/src/features/browser/preview-stream.browser.ts','scripts/lib/third-party-licenses.ts'])await put(file);
 await fs.mkdir(path.join(source,'packages'),{recursive:true});await put('apps/mobile/package.json','{"name":"mobile"}');await put('apps/mobile/index.ts','export const x=1;');await put('pnpm-lock.yaml','importers:\n  apps/mobile: {}\n');
 const graph=analyzeMobileExperience(source),inventory=await inventoryExperience(source,graph),lock=resolveExperienceDependencies(await fs.readFile(path.join(source,'pnpm-lock.yaml'),'utf8'),graph.packages);
 const records=[];for(const p of inventory.files){const b=await fs.readFile(path.join(source,p));records.push({path:'source/'+p,upstreamPath:p,role:graph.files.some(f=>f.path===p)?'runtime-source':'support-source',bytes:b.length,sha256:hash(b)});}
 for(const [p,v]of Object.entries({'IMPORT-GRAPH.json':graph,'RESOURCE-INVENTORY.json':inventory,'DEPENDENCY-LOCK.json':lock})){const b=serialize(v);await fs.writeFile(path.join(root,p),b);records.push({path:p,role:'generated-metadata',bytes:Buffer.byteLength(b),sha256:hash(b)});}
 const manifest={schema:1,kind:'blackcrab-mobile-experience-source-preparation',upstream:UPSTREAM,sourcePatches:[],consumerManifestChanges:[],files:records};const save=()=>fs.writeFile(path.join(root,'VENDOR-MANIFEST.json'),serialize(manifest));await save();assert.equal((await verifyExperienceExport(root)).sourceFiles,1);
 await fs.writeFile(path.join(root,'extra'),'extra');await assert.rejects(verifyExperienceExport(root),/Unexpected/);await fs.unlink(path.join(root,'extra'));
 const provenanceRow=records.find(x=>x.path==='source/apps/mobile/index.ts');provenanceRow.upstreamPath='another/source.ts';await save();await assert.rejects(verifyExperienceExport(root),/provenance mismatch/);provenanceRow.upstreamPath='apps/mobile/index.ts';await save();
 const target=path.join(source,'apps/mobile/index.ts'),original=await fs.readFile(target);const mutate=Buffer.from('export const x=2;');await fs.writeFile(target,mutate);const row=records.find(x=>x.path==='source/apps/mobile/index.ts');row.sha256=hash(mutate);row.bytes=mutate.length;await save();await assert.rejects(verifyExperienceExport(root),/graph mismatch/);await fs.writeFile(target,original);row.sha256=hash(original);row.bytes=original.length;
 const b=serialize({...lock,documentIndex:100});await fs.writeFile(path.join(root,'DEPENDENCY-LOCK.json'),b);const r=records.find(x=>x.path==='DEPENDENCY-LOCK.json');r.sha256=hash(b);r.bytes=Buffer.byteLength(b);await save();await assert.rejects(verifyExperienceExport(root),/Dependency lock mismatch/);
});
