/** Opt-in source/build preparation only. Never installs, selects or starts a service. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractPinnedSourceArchive,applySourcePatchRecords} from './source.mjs';
import {verifyArtifact} from './artifact.mjs';
export const SERVICE_PROFILE='blackcrab-local-service-layout-v1';
const PROFILE_FILE='BLACKCRAB-SERVICE-PROFILE.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const roots=new URL('../',import.meta.url);
const GROUPS=[
 ['identity','fork-integration/identity/','object',['001-own-pairing-app-links','002-own-desktop-provider-return','003-own-mobile-pairing-reader','004-own-managed-policy']],
 ['managed-host','managed-host/patches/','array',["office-font-file-url-path","managed-native-local-api","managed-native-folder-picker-entry","managed-native-project-icon-api","managed-native-project-icon-picker","managed-native-project-icon-entry","blackcrab-renderer-origin","blackcrab-packaged-cors","managed-host-identity-proof","owned-client-01","owned-client-02","owned-client-03","owned-client-04","owned-client-05","owned-client-06","owned-client-07","owned-client-08","owned-client-09","owned-client-10","owned-client-11","owned-client-12","owned-client-13","owned-client-14","owned-client-15","owned-client-test-ownedcloud-test-ts","native-browser-host-1","native-browser-host-2","native-browser-host-3","native-browser-host-4","native-browser-host-5","native-browser-host-6","native-browser-host-7","native-browser-host-8","native-browser-host-9","native-browser-host-10","blackcrab-pairing-app-links","native-browser-types-1","native-browser-types-2","native-browser-types-3","native-browser-types-4"]],
 ['boot','fork-integration/boot-service/','object',['001-owned-service-and-local-installer','002-owned-payload-layout','003-launcher-payload-layout','004-owned-layout-protocol','005-unconfigured-owned-updater-gate']],
 ['auth','fork-integration/boot-service/owned-auth/','fixtures',['owned-auth-config','owned-auth-serviceProtocol','owned-auth-serviceLauncherClient','owned-auth-bootstrap-source']],
 ['identity-v2','fork-integration/owner-control/identity-v2/','identity-v2',['candidate-owner-proof-v2-http','candidate-owner-proof-v2-issuer-interface']],
 ['backend','fork-integration/boot-service/backend-identity/','fixtures',['owned-proof-config','owned-proof-serviceLauncherClient','owned-proof-http','owned-proof-concrete-source']],
 ['launcher','fork-integration/boot-service/launcher-adapter/','launcher',['owned-service-serviceLauncher','owned-service-cli-server','owned-service-OwnedLauncherBootstrap','owned-service-OwnedServiceLauncherLoss']],
 ['browser','fork-integration/boot-service/browser-channel/','object',['owned-browser-auth','owned-browser-config','owned-browser-launcher','owned-browser-policy']],
 ['typecheck','fork-integration/boot-service/typecheck/','object',["owned-types-ManagedOwnerProofIssuer", "owned-types-OwnedLauncherBootstrap", "owned-types-OwnedServiceAuthBootstrap", "owned-types-OwnedServiceProof", "owned-types-config", "owned-types-http"]],
];
const ENTRY_SOURCES={
 'apps/server/src/bin.ts':'bfd166e85864948da79bee79bb7ba36eae5f6d3ab4871eb07dcaf8f6870b0598',
 'apps/server/src/cli/serviceLauncher.ts':'b8ced3fa033a95176bf0635814bb423004353ba69d8f89636413e52ceb1ebbdd',
 'apps/server/scripts/cli.ts':'5f1970ac12579613f65791fe5a780593f9e20a44e2b5c013031b0dbc158f4fe3',
 'apps/server/vite.config.ts':'880b8a7e545b943682376dc259d54d770f1150c2d95afcb259e9964be0389ef2',
};
const ALIASES=new Map([['blackcrab-pairing-app-links','001-own-pairing-app-links'],['blackcrab-provider-auth-return','002-own-desktop-provider-return']]);
// The shared cloud records include these namespace changes and add configured
// hosted return origins. Applying the historical versions as well would either
// reject the predecessor bytes or remove the configured return origin.
const SUPERSEDED_IDENTITY_IDS=new Set(['001-own-pairing-app-links','002-own-desktop-provider-return']);
const receipts=new WeakMap();
function relative(value){if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||/[\x00-\x1f\x7f]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe fixed service source path');return value;}
async function read(file){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>8*1024*1024)throw Error('Service source data must be bounded regular file');return fs.readFile(file);}
export function validateServiceProfileIDs(group,ids){const expected=GROUPS.find(g=>g[0]===group)?.[3];if(!expected||ids.length!==expected.length||new Set(ids).size!==ids.length||expected.some((id,i)=>ids[i]!==id))throw Error('Unknown or reordered service profile source IDs');}
function equivalent(a,b){return a.target===b.target&&a.kind===b.kind&&a.beforeSha256===b.beforeSha256&&a.afterSha256===b.afterSha256&&a.sha256===b.sha256&&JSON.stringify(a.replacements)===JSON.stringify(b.replacements);}
/** Pure derivation check, not an artifact/source authorization API. */
export function canonicalIdentityAlias(first,alias){
 if(ALIASES.get(alias.id)!==first.id||first.target!==alias.target||first.kind!==alias.kind||first.beforeSha256!==alias.beforeSha256||first.afterSha256!==alias.afterSha256||first.sha256!==alias.sha256||!Array.isArray(alias.replacements)||alias.replacements.length!==1)throw Error('Unrelated or nonidentical service alias');
 const before=alias.replacements[0].before;
 if(typeof before!=='string'||sha(before)!==first.beforeSha256)throw Error('Alias exact before bytes differ');
 function apply(record){if(!Array.isArray(record.replacements)||!record.replacements.length)throw Error('Alias replacements missing');let text=before;for(const r of record.replacements){if(typeof r.before!=='string'||!r.before||typeof r.after!=='string'||text.split(r.before).length!==2)throw Error('Alias replacement ambiguous');text=text.replace(r.before,()=>r.after);}if(sha(text)!==record.afterSha256)throw Error('Alias after bytes differ');return text;}
 const a=apply(first),b=apply(alias);if(a!==b)throw Error('Alias result bytes differ');
 return {replacements:[{before,after:a}],proof:{beforeSha256:first.beforeSha256,afterSha256:first.afterSha256,diffSha256:first.sha256,originalReplacementCounts:[first.replacements.length,alias.replacements.length],method:'independent-unique-replacement-execution-on-identical-full-before-bytes'}};
}
/** Fixed reviewed record sources only; no caller-selected registries/digests. */
export async function serviceProfilePlan(){
 const records=[],descriptors=[],data=new Map(),aliases=[],canonical=new Map(),ids=new Set();
 for(const [name,directory,format]of GROUPS){
  const base=new URL(directory,roots),raw=await read(new URL('registry.json',base)),registry=JSON.parse(raw),patches=Array.isArray(registry)?registry:registry.patches,added=Array.isArray(registry)?[]:registry.addedSources??[];
  if(!Array.isArray(patches)||!Array.isArray(added))throw Error('Malformed service source registry');
  validateServiceProfileIDs(name,[...patches,...added].map(r=>r.id));data.set(`${name}/registry.original.json`,raw);
  for(const [record,isAdded]of [...patches.map(r=>[r,false]),...added.map(r=>[r,true])]){
   if(name==='identity'&&SUPERSEDED_IDENTITY_IDS.has(record.id))continue;
   if(ids.has(record.id))throw Error('Duplicate service source ID');ids.add(record.id);
   const file=relative(record.file??record.patch),payload=new URL((format==='identity-v2'?'patches/':'')+file,base),bytes=await read(payload);
   if(sha(bytes)!==record.sha256)throw Error('Service source patch bytes changed '+record.id);
   const normalized={id:record.id,file:`${name}/${file}`,target:relative(record.target??record.path),sha256:record.sha256,beforeSha256:isAdded?null:record.beforeSha256,afterSha256:isAdded?record.sha256:record.afterSha256};
   if(isAdded||record.kind==='payload')normalized.kind='payload';
   else if(format==='fixtures'||format==='launcher'){
    const stem=path.posix.basename(file,'.patch'),prefix=format==='launcher'?'':'fixtures/';
    const before=await read(new URL(`${prefix}${stem}.before.ts`,base)),after=await read(new URL(`${prefix}${stem}.after.ts`,base));
    if(sha(before)!==record.beforeSha256||sha(after)!==record.afterSha256)throw Error('Service source fixture pins changed '+record.id);
    normalized.replacements=[{before:before.toString('utf8'),after:after.toString('utf8')}];
   }else normalized.replacements=structuredClone(record.replacements);
   data.set(normalized.file,bytes);descriptors.push(Object.freeze({id:record.id,sha256:record.sha256}));
   // The current strict pairing policy follows the owned cloud patch; it is not
   // the historical namespace-only alias with the same ID.
   const alias=record.id==='blackcrab-pairing-app-links'?undefined:ALIASES.get(record.id);
   if(alias){const previous=canonical.get(alias);if(!previous)throw Error('Service identity alias predecessor absent');const verified=canonicalIdentityAlias(previous,normalized);previous.replacements=structuredClone(verified.replacements);normalized.replacements=structuredClone(verified.replacements);if(!equivalent(previous,normalized))throw Error('Service identity alias is not byte-identical');aliases.push({id:record.id,appliedAs:alias,derivation:verified.proof});}
   else{canonical.set(record.id,normalized);records.push(normalized);}
  }
 }
 if(descriptors.length!==71||records.length!==71||aliases.length!==0)throw Error('Service profile composition changed');
 return {profile:SERVICE_PROFILE,protocol:4,version:'0.1.7',records,descriptors,aliases,data,entrySources:{...ENTRY_SOURCES}};
}
/** Source consistency API; actual producer below ALWAYS authenticates a fresh archive. */
export async function applyServiceProfileSource(root){
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o700||await fs.realpath(root)!==path.resolve(root))throw Error('Service preparation requires private canonical fresh source root');
 const plan=await serviceProfilePlan();
 for(const [file,digest]of Object.entries(ENTRY_SOURCES))if(sha(await read(path.join(root,file)))!==digest)throw Error('Original launcher/SEA entry source changed');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-service-profile-data-'));
 try{
  for(const [name,bytes]of plan.data){const file=path.join(temporary,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
  // One complete preflight, before any target write. No source symlinks/materialized mirrors.
  await applySourcePatchRecords(root,{records:plan.records,patchDirectory:temporary});
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
 const receipt=Object.freeze({root,sourcePatches:Object.freeze(plan.descriptors),profile:SERVICE_PROFILE});receipts.set(receipt,plan);return receipt;
}
export async function prepareServiceSourceArchive(archive,cacheDir,options){const {root}=await extractPinnedSourceArchive(archive,cacheDir,options);return applyServiceProfileSource(await fs.realpath(root));}
export async function stageServiceProfileEvidence(output,prepared){
 const plan=receipts.get(prepared);if(!plan)throw Error('Service source preparation receipt required');
 const patchRoot=path.join(output,'source-patches');await fs.mkdir(patchRoot,{recursive:false});
 for(const [name,bytes]of plan.data){const file=path.join(patchRoot,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx',mode:0o644});}
 await fs.writeFile(path.join(patchRoot,'registry.json'),JSON.stringify({schema:1,profile:SERVICE_PROFILE,protocol:4,records:plan.records,aliases:plan.aliases},null,2)+'\n',{flag:'wx'});
 const profile=profileMetadata(plan);
 await fs.writeFile(path.join(output,PROFILE_FILE),JSON.stringify(profile,null,2)+'\n',{flag:'wx'});return profile;
}

function profileMetadata(plan){ return {schema:1,profile:SERVICE_PROFILE,protocol:4,version:'0.1.7',sourcePatches:plan.descriptors,aliases:plan.aliases,entrySources:plan.entrySources,buildContract:{entry:'t3',launcherArgument:'__service-launcher',nodeIPC:3,privateAuthFD:0,cliAsset:'binMain.mjs',effectClosure:'single original embedded CLI asset'},activation:{performedByProducer:false,scope:'artifact-only'}};
}
/** Integrity/profile consistency only, not a signature or native selected-artifact grant. */
export async function verifyServiceProfileArtifact(root,options={}){
 const manifest=await verifyArtifact(root,options),profile=JSON.parse(await read(path.join(root,PROFILE_FILE))),plan=await serviceProfilePlan();
 if(JSON.stringify(profile)!==JSON.stringify(profileMetadata(plan))||JSON.stringify(manifest.sourcePatches)!==JSON.stringify(plan.descriptors))throw Error('Service artifact profile differs');
 const registry=JSON.parse(await read(path.join(root,'source-patches/registry.json')));
 if(JSON.stringify(registry)!==JSON.stringify({schema:1,profile:SERVICE_PROFILE,protocol:4,records:plan.records,aliases:plan.aliases}))throw Error('Service artifact source chain differs');
 for(const [file,bytes]of plan.data)if(sha(await read(path.join(root,'source-patches',file)))!==sha(bytes))throw Error('Service artifact reviewed source data differs');
 return manifest;
}
