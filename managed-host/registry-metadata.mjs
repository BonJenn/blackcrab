/** Explicit public metadata preparation, then verified independent offline seeding. */
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
const PLAN_SHA='0ec4b4c5e81d3db6117dca9c2c65dc0845dcc45568c9f674b5466a857ae5a74a';
const REGISTRY='https://registry.npmjs.org/';
const REGISTRY_DIRECTORY='https%3A+registry.npmjs.org';
const MAX_DOCUMENT=64*1024*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
const encode=v=>Buffer.from(JSON.stringify(v));
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function metadataRelativePath(name){
 if(typeof name!=='string'||!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)||name.split('/').some(p=>p==='.'||p==='..'))throw Error('Invalid fixed registry package');
 return `${name}.jsonl`;
}
export function encodeFullMetadata(document,validators){
 if(!document||typeof document!=='object'||Array.isArray(document)||typeof document.name!=='string'||!document.versions||typeof document.versions!=='object'||Array.isArray(document.versions)||!document.time||typeof document.time!=='object')throw Error('Full registry packument required');
 metadataRelativePath(document.name);
 const chunks=[],versions=[];let offset=0;
 for(const [version,manifest]of Object.entries(document.versions)){
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.version!==version)throw Error('Version record differs');
  const bytes=encode(manifest);versions.push([version,offset,bytes.length]);chunks.push(bytes);offset+=bytes.length;
 }
 if(!versions.length)throw Error('Empty registry packument');
 const info=encode({etag:validators.etag??null,modified:document.time.modified??null});
 const index=encode({name:document.name,distTags:document['dist-tags']??{},time:document.time,homepage:document.homepage??'',versions});
 return Buffer.concat([Buffer.from(`pnpm-meta-v1 ${info.length} ${index.length}\n`),info,index,...chunks]);
}
export function validateLockedMetadata(document,entry){
 if(document.name!==entry.name)throw Error('Registry name differs');
 for(const locked of entry.versions){
  if(document.versions?.[locked.version]?.dist?.integrity!==locked.integrity||typeof document.time?.[locked.version]!=='string'||!Number.isFinite(Date.parse(document.time[locked.version])))throw Error('Locked metadata/integrity missing or changed');
 }
}
async function regular(file){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid?.()||s.size>MAX_DOCUMENT)throw Error('Owned bounded regular metadata file required');return fs.readFile(file);}
async function rootDirectory(root){const s=await fs.lstat(root);if(!path.isAbsolute(root)||await fs.realpath(root)!==root||!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw Error('Canonical private metadata root required');}
async function noLinks(file,root){let p=file;for(;;){const s=await fs.lstat(p);if(s.isSymbolicLink())throw Error('Metadata alias refused');if(p===root)break;const parent=path.dirname(p);if(parent===p||!p.startsWith(root+path.sep))throw Error('Metadata path escaped');p=parent;}}
async function fixedPlan(){const b=await fs.readFile(new URL('./registry-metadata-lock.json',import.meta.url));if(sha(b)!==PLAN_SHA)throw Error('Fixed metadata lock plan changed');return JSON.parse(b);}
async function filesBelow(root,relative=''){const result=[];for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){const name=relative?relative+'/'+item.name:item.name;if(item.isSymbolicLink())throw Error('Metadata link refused');if(item.isDirectory())result.push(...await filesBelow(root,name));else if(item.isFile())result.push(name);else throw Error('Metadata special entry refused');}return result.sort();}
function fetchPackument(name){
 const url=new URL(encodeURIComponent(name),REGISTRY);
 return new Promise((resolve,reject)=>{
  const request=https.get(url,{headers:{Accept:'application/json','User-Agent':'Blackcrab-owned-metadata-preparation/1'},timeout:120000},response=>{
   if(response.statusCode!==200){response.resume();reject(Error('Official metadata request refused; redirects disabled'));return;}
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>MAX_DOCUMENT){request.destroy(Error('Metadata document bound'));return;}chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>resolve({url:url.href,bytes:Buffer.concat(chunks),etag:response.headers.etag??null}));
  });
  const deadline=setTimeout(()=>request.destroy(Error('Metadata total request deadline')),120000);
  request.once('close',()=>clearTimeout(deadline));
  request.on('timeout',()=>request.destroy(Error('Metadata request deadline')));request.on('error',reject);
 });
}
/** Network is explicit and only here. No package tarballs, installs, scripts or redirects. */
export async function prepareRegistryMetadata(output){
 if(process.version!=='v26.12.1')throw Error('Pinned Node26.12.1 required');
 if(Object.keys(process.env).some(k=>!['PATH','LANG','LC_ALL','__CF_USER_TEXT_ENCODING'].includes(k)))throw Error('Metadata prepare requires clean env -i');
 const plan=await fixedPlan();await fs.mkdir(output,{mode:0o700});await rootDirectory(output);const rows=[];
 // An interrupted or failed seed has no manifest and is never resumed or adopted.
 for(const entry of plan.packages){
  const disk=await fs.statfs(output,{bigint:true});if(disk.bavail*disk.bsize<2n*1024n**3n)throw Error('Metadata preparation external low-water stop');
  const got=await fetchPackument(entry.name),document=JSON.parse(got.bytes);validateLockedMetadata(document,entry);const native=encodeFullMetadata(document,{etag:got.etag});
  const raw=`raw/${metadataRelativePath(entry.name)}`,cache=`metadata-full/${REGISTRY_DIRECTORY}/${metadataRelativePath(entry.name)}`;
  for(const [relative,bytes]of[[raw,got.bytes],[cache,native]]){const file=path.join(output,relative);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
  rows.push({name:entry.name,url:got.url,etag:got.etag,raw,rawSha256:sha(got.bytes),rawBytes:got.bytes.length,cache,cacheSha256:sha(native),cacheBytes:native.length});
 }
 const manifest={schema:1,kind:'blackcrab-pnpm-full-metadata-seed-v1',registry:REGISTRY,pnpmVersion:'12.14.0',planSha256:PLAN_SHA,lockSha256:plan.lockSha256,policySha256:plan.policySha256,rows};
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await fs.writeFile(path.join(output,'manifest.json'),bytes,{flag:'wx',mode:0o600});return {root:output,manifestSha256:sha(bytes),packages:rows.length,bytes:rows.reduce((n,r)=>n+r.rawBytes+r.cacheBytes,0)};
}
/** Recompute every full cache envelope from its preserved full official response. */
export async function verifyRegistryMetadata(root,expectedManifestSha256,control){
 if(!digest(expectedManifestSha256))throw Error('Pinned metadata manifest required');await rootDirectory(root);const bytes=await regular(path.join(root,'manifest.json'));if(sha(bytes)!==expectedManifestSha256)throw Error('Metadata manifest changed');
 const m=JSON.parse(bytes),plan=await fixedPlan();
 if(m.schema!==1||m.kind!=='blackcrab-pnpm-full-metadata-seed-v1'||m.registry!==REGISTRY||m.pnpmVersion!=='12.14.0'||m.planSha256!==PLAN_SHA||m.lockSha256!==plan.lockSha256||m.policySha256!==plan.policySha256||!Array.isArray(m.rows)||m.rows.length!==plan.packages.length)throw Error('Metadata seed purpose differs');
 const expectedFiles=['manifest.json'];
 for(let i=0;i<plan.packages.length;i++){
  control?.assertRunning();const entry=plan.packages[i],row=m.rows[i],raw=`raw/${metadataRelativePath(entry.name)}`,cache=`metadata-full/${REGISTRY_DIRECTORY}/${metadataRelativePath(entry.name)}`;
  if(row.name!==entry.name||row.url!==new URL(encodeURIComponent(entry.name),REGISTRY).href||row.raw!==raw||row.cache!==cache)throw Error('Metadata seed record differs');
  for(const relative of[raw,cache])await noLinks(path.join(root,relative),root);
  const source=await regular(path.join(root,raw)),native=await regular(path.join(root,cache));if(sha(source)!==row.rawSha256||source.length!==row.rawBytes||sha(native)!==row.cacheSha256||native.length!==row.cacheBytes)throw Error('Metadata seed bytes changed');
  const document=JSON.parse(source);validateLockedMetadata(document,entry);if(!native.equals(encodeFullMetadata(document,{etag:row.etag})))throw Error('Full metadata envelope differs');expectedFiles.push(raw,cache);
 }
 if(JSON.stringify(await filesBelow(root))!==JSON.stringify(expectedFiles.sort()))throw Error('Metadata seed has missing/extra files');
 return {manifestSha256:expectedManifestSha256,packages:m.rows.length,cacheBytes:m.rows.reduce((n,r)=>n+r.cacheBytes,0),rows:m.rows};
}
export async function copyRegistryMetadata(root,manifestSha256,privateCacheRoot,control){
 const verified=await verifyRegistryMetadata(root,manifestSha256,control),destination=path.join(privateCacheRoot,'pnpm/v12/metadata-full');await rootDirectory(privateCacheRoot);await fs.mkdir(destination,{recursive:true,mode:0o700});await noLinks(destination,privateCacheRoot);
 for(const row of verified.rows){
  control?.assertRunning();const source=path.join(root,row.cache),target=path.join(destination,row.cache.slice('metadata-full/'.length));await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await noLinks(path.dirname(target),privateCacheRoot);const before=await fs.lstat(source);await fs.copyFile(source,target,constants.COPYFILE_EXCL);await fs.chmod(target,0o600);const after=await fs.lstat(target);
  if(after.nlink!==1||after.isSymbolicLink()||(before.dev===after.dev&&before.ino===after.ino)||sha(await fs.readFile(target))!==row.cacheSha256||sha(await fs.readFile(source))!==row.cacheSha256)throw Error('Metadata copy is not independent and identical');
 }
 await verifyRegistryMetadata(root,manifestSha256,control);return {packages:verified.packages,manifestSha256,destination};
}
