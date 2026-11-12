import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {productCopyRecords,productCopyDescriptors,productCopyPatchedBytes,applyProductCopyPatches} from './product-copy-patches.mjs';
import {mobileCloudPatchDescriptors,mobileCloudPatchedBytes} from './cloud-source-patches.mjs';

const vendor=fileURLToPath(new URL('../vendor/t3-mobile/',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function original(record){
 let bytes;
 try{bytes=await fs.readFile(path.join(vendor,'original-files',record.target));}
 catch(error){if(error.code!=='ENOENT')throw error;bytes=await fs.readFile(path.join(vendor,record.target));}
 if(hash(bytes)!==record.beforeSha256){
  const cloud=(await mobileCloudPatchDescriptors()).find(p=>p.target===record.target);
  if(cloud)bytes=await mobileCloudPatchedBytes(bytes,cloud);
 }
 assert.equal(hash(bytes),record.beforeSha256);return bytes;
}

test('copy adapters preserve exact original inputs and reject drift or a forged patch kind',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-product-copy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const records=await productCopyRecords(),descriptors=await productCopyDescriptors();
 for(const record of records){const target=path.join(root,record.target);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,await original(record));}
 const result=await applyProductCopyPatches(root);assert.deepEqual(result.patches,descriptors);
 for(const [index,record]of records.entries()){
  const before=result.originals[index].bytes,after=await fs.readFile(path.join(root,record.target));
  assert.equal(hash(after),record.afterSha256);assert.deepEqual(await productCopyPatchedBytes(before,descriptors[index]),after);
  await assert.rejects(productCopyPatchedBytes(Buffer.concat([before,Buffer.from('// drift')]),descriptors[index]),/input differs/);
  await assert.rejects(productCopyPatchedBytes(before,{...descriptors[index],kind:'type-only'}),/Unregistered/);
 }
 await assert.rejects(applyProductCopyPatches(root),/Pinned source differs/);
});

test('relay errors show Blackcrab and the actual limit without advertising an unimplemented paid tier',async()=>{
 const descriptor=(await productCopyDescriptors()).find(p=>p.target==='packages/client-runtime/src/relay/errorPresentation.ts');
 const after=await productCopyPatchedBytes(await original(descriptor),descriptor);
 const js=ts.transpileModule(after.toString('utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const module=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 for(const maxTunnels of [1,3,10,100])assert.equal(module.relayProtectedErrorMessage({_tag:'RelayEnvironmentLinkLimitExceededError',maxTunnels}),`Relay refused the link: this account already has its maximum of ${maxTunnels} managed tunnels. Unlink an environment to free one up.`);
 assert.match(module.relayOfflineReasonMessage({offlineReason:'tunnel_released'}),/Blackcrab Connect.*Start Blackcrab/);
 assert.match(module.relayProtectedErrorMessage({_tag:'RelayEnvironmentConnectNotAuthorizedError',reason:'environment_link_not_found'}),/Blackcrab Connect/);
 assert.match(module.relayProtectedErrorMessage({_tag:'RelayAuthInvalidError',reason:'invalid_dpop',dpopFailureReason:'time_window'}),/automatic date and time/);
 assert.doesNotMatch(js,/T3CHAT_PLAN_TUNNEL_LIMITS|paid T3 Chat|Pro raises|Premier to/);
});

test('all graph-reachable shared product literals are owned while real third-party names remain',async()=>{
 const graph=JSON.parse(await fs.readFile(path.join(vendor,'IMPORT-GRAPH.json'),'utf8'));
 const unexpected=[];
 for(const file of graph.files.filter(f=>f.runtime&&f.path.startsWith('packages/')&&/\.[cm]?[jt]sx?$/.test(f.path)&&!/\.(test|spec)\./.test(f.path))){
  const source=await fs.readFile(path.join(vendor,file.path),'utf8'),parsed=ts.createSourceFile(file.path,source,ts.ScriptTarget.Latest,true,file.path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function visit(node){
   if((ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)||ts.isJsxText(node))&&/\bT3 (Code|Connect|Account)\b/.test(node.text)&&node.text!=='T3 Code for GitHub')unexpected.push({file:file.path,text:node.text});
   ts.forEachChild(node,visit);
  }visit(parsed);
 }
 assert.deepEqual(unexpected,[]);
 const read=relative=>fs.readFile(path.join(vendor,relative),'utf8');
 assert.match(await read('packages/source-control-github/src/shared/definition.ts'),/T3 Code for GitHub/);
 assert.match(await read('packages/shared/src/themePalettes.ts'),/label: "T3 Chat"/);
 assert.match(await read('packages/contracts/src/t3ProjectFile.ts'),/https:\/\/t3\.codes\/schema\/t3\.json/);
 assert.match(await read('packages/client-runtime/src/relay/managedRelay.ts'),/read linked T3 Chat account/);
});
