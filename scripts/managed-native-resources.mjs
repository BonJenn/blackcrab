import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyArtifact as verifyDesktop, MANIFEST as DESKTOP_MANIFEST} from '../managed-desktop/artifact.mjs';
import {verifyArtifact as verifyHost, MANIFEST_FILE as HOST_MANIFEST, NODE_VERSION, PNPM_VERSION} from '../managed-host/artifact.mjs';
import {verifyServiceProfileArtifact, SERVICE_PROFILE} from '../managed-host/service-profile.mjs';
const run=promisify(execFile);
async function fileSha(file){const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');}
async function checkArchiveTree(root){
 const entries=[];
 const visit=async(directory)=>{for(const name of (await fs.readdir(directory)).sort()){
  if(/[\x00-\x1f\x7f]/.test(name))throw Error('Control character in resource path');
  const file=path.join(directory,name),stat=await fs.lstat(file),relative=path.relative(root,file);
  if(stat.isSymbolicLink()){
   const target=await fs.readlink(file);if(/[\x00-\x1f\x7f]/.test(target))throw Error('Control character in resource link');
   entries.push({path:relative,type:'symlink',target});
  }else{
   if(stat.mode & 0o7000)throw Error('Privileged resource mode is unsupported');
   if(stat.isDirectory()){entries.push({path:relative,type:'directory',mode:stat.mode & 0o777});await visit(file);}
   else if(stat.isFile()&&stat.nlink===1)entries.push({path:relative,type:'file',mode:stat.mode & 0o777});
   else throw Error('Resource special file or hard link is unsupported');
  }
 }};await visit(root);return entries;
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function parseManagedResourceArgs(args) {
 const result={args:[],desktop:undefined,host:undefined};
 for(let i=0;i<args.length;i++) {
  const key=args[i]==='--managed-desktop'?'desktop':args[i]==='--managed-host'?'host':args[i]==='--managed-service-host'?'serviceHost':null;
  if(!key){result.args.push(args[i]);continue;}
  if(result[key]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error(`Expected one directory after ${args[i]}`);
  result[key]=args[++i];
 }
 if(result.host!==undefined&&result.serviceHost!==undefined)throw Error('Choose either --managed-host or --managed-service-host');
 return result;
}
/** Verify producer contracts before supplying Tauri's documented source->destination resource map.
 * Input directories must remain immutable during archive preparation. Returned cleanup owns only private staging.
 */
export async function prepareManagedNativeResources({desktop,host,serviceHost,env=process.env,platform=process.platform,arch=process.arch,target=""}={}) {
 if(host!==undefined&&serviceHost!==undefined)throw Error('Choose either a direct host or a service host');
 host=serviceHost??host;
 if ((desktop !== undefined || host !== undefined) && target) {
  const match=/^(aarch64|x86_64)-(apple-darwin|unknown-linux-gnu|pc-windows-msvc)$/.exec(target);
  if(!match)throw Error('Managed resources require a supported single-architecture target');
  arch=match[1]==='aarch64'?'arm64':'x64';platform=match[2]==='apple-darwin'?'darwin':match[2]==='pc-windows-msvc'?'win32':'linux';
 }
 if(desktop!==undefined && (platform!=='darwin'||arch!=='arm64'))throw Error('Managed desktop package requires darwin-arm64 target');
 if(serviceHost!==undefined&&(platform!=='darwin'||arch!=='arm64'))throw Error('Managed service package requires the verified darwin-arm64 target');
 const nextEnv={...env};
 delete nextEnv.BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256;
 delete nextEnv.BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256;
 delete nextEnv.BLACKCRAB_EMBEDDED_DESKTOP_ARCHIVE_SHA256;
 delete nextEnv.BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256;
 delete nextEnv.BLACKCRAB_EMBEDDED_HOST_SERVICE_PROFILE;
 const resources={};
 let stage;
 const cleanup=async()=>{if(stage)await fs.rm(stage,{recursive:true,force:true});};
 try {
 for(const [role,input,manifestName,variable] of [
  ['desktop',desktop,DESKTOP_MANIFEST,'BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256'],
  ['host',host,HOST_MANIFEST,'BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256']]) {
  if(input===undefined)continue;
  const root=path.resolve(input);
  if(/[\x00-\x1f\x7f]/.test(root))throw Error('Control character in resource root path');
  const before=await fs.readFile(path.join(root,manifestName));
  const verify=async root=>{
  if(role==='desktop')return verifyDesktop(root);
  else {
   const manifest=serviceHost!==undefined?await verifyServiceProfileArtifact(root,{platform,arch}):await verifyHost(root,{platform,arch});
   if(serviceHost===undefined){
   const registryBytes=await fs.readFile(new URL('../managed-host/patches/registry.json',import.meta.url));
   const registry=JSON.parse(registryBytes);
   if(JSON.stringify(manifest.sourcePatches)!==JSON.stringify(registry.map(({id,sha256})=>({id,sha256}))))throw Error('Host source patch provenance mismatch');
   if(!registryBytes.equals(await fs.readFile(path.join(root,'source-patches/registry.json'))))throw Error('Host source registry mismatch');
   for(const patch of registry)if(sha(await fs.readFile(path.join(root,'source-patches',patch.file)))!==patch.sha256)throw Error('Host source patch bytes mismatch');
   }
   const provenance=JSON.parse(await fs.readFile(path.join(root,'BUILD-PROVENANCE.json'),'utf8'));
   if(JSON.stringify(provenance.upstream)!==JSON.stringify(manifest.upstream)||JSON.stringify(provenance.sourcePatches)!==JSON.stringify(manifest.sourcePatches)||provenance.target!==`${platform}-${arch}`||provenance.node!==NODE_VERSION||provenance.pnpm!==PNPM_VERSION||provenance.signing!=='local-only')throw Error('Host build provenance mismatch');
   return manifest;
  }};
  await verify(root);
  const tree=await checkArchiveTree(root);
  const after=await fs.readFile(path.join(root,manifestName));
  if(!before.equals(after))throw Error('Artifact manifest changed during verification');
  stage ??= await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-managed-payloads-')));
  await fs.chmod(stage,0o700);
  const name=`managed-${role}-payload.tar.gz`, archive=path.join(stage,name);
  const metadataFlags=process.platform==='darwin'?['--no-fflags','--no-mac-metadata']:[];
  const ownerFlags=process.platform==='darwin'?['--uid','0','--gid','0','--uname','root','--gname','wheel']:['--owner=0','--group=0','--numeric-owner'];
  await run('/usr/bin/tar',['-czf',archive,'--format','pax','--no-xattrs','--no-acls',...metadataFlags,...ownerFlags,'-C',root,'--',...(await fs.readdir(root)).sort()],{env:{...process.env,COPYFILE_DISABLE:'1'},maxBuffer:1024*1024});
  // Roundtrip into private staging before exposing a resource map; native extraction has its own bounded parser.
  const unpack=path.join(stage,`roundtrip-${role}`);await fs.mkdir(unpack,{mode:0o700});
  await run('/usr/bin/tar',['-xzpf',archive,'--no-same-owner','--no-acls','--no-xattrs',...metadataFlags,'-C',unpack],{env:{...process.env,COPYFILE_DISABLE:'1'},maxBuffer:1024*1024});
  await verify(unpack);
  if(JSON.stringify(tree)!==JSON.stringify(await checkArchiveTree(unpack)))throw Error('Archive mode/link topology changed');
  if(!after.equals(await fs.readFile(path.join(unpack,manifestName)))||!after.equals(await fs.readFile(path.join(root,manifestName))))throw Error('Artifact manifest changed during archive roundtrip');
  await verify(root);
  await fs.rm(unpack,{recursive:true,force:true});
  nextEnv[variable]=sha(after);
  if(role==='host'&&serviceHost!==undefined)nextEnv.BLACKCRAB_EMBEDDED_HOST_SERVICE_PROFILE=SERVICE_PROFILE;
  nextEnv[`BLACKCRAB_EMBEDDED_${role.toUpperCase()}_ARCHIVE_SHA256`]=await fileSha(archive);
  resources[archive]=name;
 }
 return {env:nextEnv,config:{bundle:{resources}},cleanup};
 }catch(error){await cleanup();throw error;}
}
