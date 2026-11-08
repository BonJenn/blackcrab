import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseAllDocuments } from 'yaml';
import { UPSTREAM } from '../managed-host/artifact.mjs';
import { extractPinnedSourceArchive } from '../managed-host/source.mjs';
import { analyzeMobileExperience } from './graph.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const GROUPS = ['dependencies','optionalDependencies','peerDependencies','devDependencies'];
export const SUPPORT_ROOTS = ['apps/mobile','assets','scripts','patches','third-party-licenses/spdx'];
export const SUPPORT_FILES = ['LICENSE','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.effect.json','third-party-licenses.config.json','apps/server/src/device/deviceToolVersions.json','native/libghostty-vt/LICENSE'];
export const GENERATED_ALIASES = [
 {name:'@t3tools/mobile-device-stream',output:'apps/mobile/.generated/device-stream',generator:'apps/mobile/scripts/generate-device-stream.mts',entry:'apps/mobile/src/features/devices/device-stream.browser.ts'},
 {name:'@t3tools/mobile-preview-stream',output:'apps/mobile/.generated/preview-stream',generator:'apps/mobile/scripts/generate-device-stream.mts',entry:'apps/mobile/src/features/browser/preview-stream.browser.ts'},
 {name:'@t3tools/mobile-third-party-licenses',output:'apps/mobile/.generated/third-party-licenses',generator:'scripts/lib/third-party-licenses.ts',entry:'third-party-licenses.config.json'},
];
/** Record original importer resolutions per owner and group, never treat hoisting as a pin. */
export function resolveExperienceDependencies(lockText, packages, nativeModules = []) {
 const documents = parseAllDocuments(lockText).map(d=>{if(d.errors.length)throw d.errors[0];return d.toJS();});
 const matches=documents.map((value,index)=>({value,index})).filter(({value})=>packages.every(p=>Object.hasOwn(value?.importers??{},p.folder)));
 if(matches.length!==1)throw new Error('Expected one complete mobile importer lock document');
 const {value:lock,index:documentIndex}=matches[0];
 const owners=packages.map(pkg=>{
  const importer=lock.importers[pkg.folder],groups={};
  for(const group of GROUPS){groups[group]={};for(const [name,specifier]of Object.entries(pkg.originalManifest[group]??{}).sort(([a],[b])=>compare(a,b))){
   const entry=importer[group]?.[name]??(group==='peerDependencies'?importer.dependencies?.[name]??importer.devDependencies?.[name]:undefined);
   if(!entry && group!=='peerDependencies')throw new Error(`Missing pinned importer ${pkg.name}:${group}:${name}`);
   const expectedSpecifier=lock.overrides?.[name] ?? specifier;
   if(entry && (entry.specifier!==expectedSpecifier || typeof entry.version!=='string'))throw new Error(`Importer declaration mismatch ${pkg.name}:${name}`);
   groups[group][name]={specifier,...(expectedSpecifier!==specifier?{override:expectedSpecifier}:{}),...(entry?{lockSpecifier:entry.specifier,resolution:entry.version}:{unresolvedPeer:true})};
  }}
  const actualEdges=pkg.dependencies.external.map(name=>{
   if(GENERATED_ALIASES.some(a=>a.name===name))return{name,kind:'generated'};
   const lookup=name==='mdast'?'@types/mdast':name;
   const owners=GROUPS.filter(g=>Object.hasOwn(groups[g],lookup));
   if(!owners.length)throw new Error(`Actual source edge lacks owned dependency: ${pkg.name}:${name}`);
   return{name,manifestName:lookup,groups:owners};
  });
  return{name:pkg.name,folder:pkg.folder,groups,actualExternalEdges:actualEdges};
 });
 const appOwner=owners.find(p=>p.folder==='apps/mobile');
 const localNativePeers=nativeModules.filter(m=>m.originalManifest).map(m=>({folder:m.folder,name:m.originalManifest.name,peers:Object.fromEntries(Object.entries(m.originalManifest.peerDependencies??{}).sort(([a],[b])=>compare(a,b)).map(([name,specifier])=>{const pin=appOwner?.groups.dependencies[name];if(!pin)throw new Error(`Unprovided native peer: ${m.folder}:${name}`);return[name,{specifier,provider:'apps/mobile',resolution:pin.resolution}];}))}));
 return{documentIndex,sha256:sha(lockText),owners,localNativePeers};
}
async function absent(file){try{await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}throw new Error(`Output exists: ${file}`);}
export async function inventoryExperience(source,graph,{allowInstalledPackageDependencies=false}={}){
 const files=new Set(graph.files.map(f=>f.path));
 const installedRoots=new Set([...graph.packages.filter(p=>p.folder.startsWith('packages/')).map(p=>p.folder+'/node_modules'),...['t3-highlights','t3-review-diff','t3-source-text','t3-terminal'].map(name=>'apps/mobile/modules/'+name+'/node_modules')]);
 async function walk(relative){
  if(allowInstalledPackageDependencies&&installedRoots.has(relative)){const stat=await fs.lstat(path.join(source,relative));if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Installed package dependencies must be a real directory');return;}
  if(relative.split('/').some(x=>['node_modules','.git'].includes(x)))throw new Error('Unexpected dependency/build tree in pinned source');
  const full=path.join(source,relative),stat=await fs.lstat(full);
  if(stat.isSymbolicLink())throw new Error(`Symlink in source inventory: ${relative}`);
  if(stat.isDirectory()){for(const name of (await fs.readdir(full)).sort(compare))await walk(`${relative}/${name}`);}
  else if(stat.isFile())files.add(relative);else throw new Error(`Special source file: ${relative}`);
 }
 for(const root of [...SUPPORT_ROOTS,...graph.packages.map(p=>p.folder)].sort(compare))await walk(root);
 for(const file of SUPPORT_FILES)await walk(file);
 const list=[...files].sort(compare);
 for(const alias of GENERATED_ALIASES)for(const key of ['generator','entry'])if(!files.has(alias[key]))throw new Error(`Missing generated alias input: ${alias[key]}`);
 const nativeModules=[];
 const nativeRoot='apps/mobile/modules';
 for(const name of (await fs.readdir(path.join(source,nativeRoot))).sort(compare)){
  const folder=`${nativeRoot}/${name}`;const entries=list.filter(f=>f.startsWith(folder+'/'));
  if(!entries.length)throw new Error(`Empty native module ${name}`);
  const manifestPath=entries.find(f=>f===`${folder}/package.json`);
  nativeModules.push({folder,...(manifestPath?{originalManifest:JSON.parse(await fs.readFile(path.join(source,manifestPath),'utf8'))}:{}),files:entries,registrations:entries.filter(f=>/expo-module\.config\.json$|\.podspec$|nitro\.json$|package\.json$/.test(f))});
 }
 return{files:list,nativeModules,generatedAliases:GENERATED_ALIASES};
}
/** Source-only preparation bundle: no generated consumer manifests and no upstream execution. */
export async function buildMobileExperience({archive,cacheDir,output}){
 output=path.resolve(output);await absent(output);
 const {root:source}=await extractPinnedSourceArchive(archive,cacheDir);
 let staging;
 try{
  const graph=analyzeMobileExperience(source),inventory=await inventoryExperience(source,graph);
  const dependencyLock=resolveExperienceDependencies(await fs.readFile(path.join(source,'pnpm-lock.yaml'),'utf8'),graph.packages,inventory.nativeModules);
  await fs.mkdir(path.dirname(output),{recursive:true});staging=await fs.mkdtemp(path.join(path.dirname(output),'.mobile-experience-'));
  const records=[],runtime=new Set(graph.files.filter(f=>f.runtime).map(f=>f.path)),typed=new Set(graph.files.map(f=>f.path));
  for(const relative of inventory.files){const bytes=await fs.readFile(path.join(source,relative));const target=path.join(staging,'source',relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);records.push({path:`source/${relative}`,upstreamPath:relative,bytes:bytes.length,sha256:sha(bytes),role:runtime.has(relative)?'runtime-source':typed.has(relative)?'type-source':'support-source'});}
  const metadata={'IMPORT-GRAPH.json':graph,'DEPENDENCY-LOCK.json':dependencyLock,'RESOURCE-INVENTORY.json':inventory};
  for(const [relative,value]of Object.entries(metadata)){const bytes=json(value);await fs.writeFile(path.join(staging,relative),bytes);records.push({path:relative,bytes:Buffer.byteLength(bytes),sha256:sha(bytes),role:'generated-metadata'});}
  const manifest={schema:1,kind:'blackcrab-mobile-experience-source-preparation',upstream:UPSTREAM,sourcePatches:[],consumerManifestChanges:[],limitations:['Source preparation only; original manifests/configuration remain unchanged and must not be used as a configured fork build.','Generated aliases are inventoried inputs, not generated/executed output.','Native compilation, external dependency install and full feature validation remain required.'],files:records.sort((a,b)=>compare(a.path,b.path))};
  await fs.writeFile(path.join(staging,'VENDOR-MANIFEST.json'),json(manifest));
  await verifyExperienceExport(staging);
  await absent(output);await fs.rename(staging,output);staging=null;
  return{output,files:records.length,sourceFiles:graph.files.length,packages:graph.packages.length,manifestSha256:sha(json(manifest))};
 }finally{if(staging)await fs.rm(staging,{recursive:true,force:true});await fs.rm(source,{recursive:true,force:true});}
}
/** Unsigned bundle consistency; archive authentication is guaranteed only during build. */
export async function verifyExperienceExport(root){
 const manifest=JSON.parse(await fs.readFile(path.join(root,'VENDOR-MANIFEST.json'),'utf8'));
 if(manifest.schema!==1||manifest.kind!=='blackcrab-mobile-experience-source-preparation'||JSON.stringify(manifest.upstream)!==JSON.stringify(UPSTREAM)||manifest.sourcePatches?.length||manifest.consumerManifestChanges?.length)throw new Error('Unexpected mobile export policy');
 const expected=new Set(['VENDOR-MANIFEST.json']);
 for(const item of manifest.files){if(typeof item.path!=='string'||item.path.includes('\\')||item.path.startsWith('/')||item.path.split('/').some(p=>!p||p==='.'||p==='..')||expected.has(item.path))throw new Error('Unsafe or duplicate payload path');expected.add(item.path);}
 async function check(relative=''){for(const name of await fs.readdir(path.join(root,relative))){const p=relative?`${relative}/${name}`:name,stat=await fs.lstat(path.join(root,p));if(stat.isSymbolicLink())throw new Error('Symlink in mobile export');if(stat.isDirectory())await check(p);else if(!stat.isFile()||!expected.has(p))throw new Error(`Unexpected export file: ${p}`);}}
 await check();
 for(const item of manifest.files){const bytes=await fs.readFile(path.join(root,item.path));if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw new Error(`Payload mismatch: ${item.path}`);}
 const graph=JSON.parse(await fs.readFile(path.join(root,'IMPORT-GRAPH.json'),'utf8'));
 const actual=analyzeMobileExperience(path.join(root,'source'));
 if(json(graph)!==json(actual))throw new Error('Source graph mismatch');
 const inventory=await inventoryExperience(path.join(root,'source'),actual);
 if(json(inventory)!==await fs.readFile(path.join(root,'RESOURCE-INVENTORY.json'),'utf8'))throw new Error('Resource inventory mismatch');
 const lock=resolveExperienceDependencies(await fs.readFile(path.join(root,'source/pnpm-lock.yaml'),'utf8'),actual.packages,inventory.nativeModules);
 if(json(lock)!==await fs.readFile(path.join(root,'DEPENDENCY-LOCK.json'),'utf8'))throw new Error('Dependency lock mismatch');
 const inventorySet=new Set(inventory.files.map(f=>'source/'+f));
 const runtime=new Set(actual.files.filter(f=>f.runtime).map(f=>'source/'+f.path)),types=new Set(actual.files.map(f=>'source/'+f.path));
 const generated=new Set(['IMPORT-GRAPH.json','DEPENDENCY-LOCK.json','RESOURCE-INVENTORY.json']);
 for(const item of manifest.files){
  if(inventorySet.has(item.path)){const role=runtime.has(item.path)?'runtime-source':types.has(item.path)?'type-source':'support-source';if(item.upstreamPath!==item.path.slice(7)||item.role!==role)throw new Error('Source provenance mismatch');}
  else if(!generated.has(item.path)||item.role!=='generated-metadata'||item.upstreamPath!==undefined)throw new Error('Unexpected provenance record');
 }
 if([...inventorySet,...generated].some(f=>!expected.has(f)))throw new Error('Missing inventoried source or metadata');
 return{files:manifest.files.length,sourceFiles:actual.files.length,packages:actual.packages.length};
}
