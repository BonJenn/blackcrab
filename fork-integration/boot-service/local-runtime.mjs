/** Native-private preparation only: this module never installs, starts, updates or stops a service. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyArtifact,MANIFEST_FILE} from '../../managed-host/artifact.mjs';
import {descriptors} from './index.mjs';
const receipts=new WeakMap();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function readBoundedFile(file,maximum) {
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||!Number.isSafeInteger(stat.size)||stat.size>maximum)throw Error('Invalid bounded runtime metadata');
  const bytes=Buffer.alloc(stat.size+1);let length=0;while(length<bytes.length){const result=await handle.read(bytes,length,bytes.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
  if(length!==stat.size)throw Error('Runtime metadata changed');return bytes.subarray(0,length);
 }finally{await handle.close();}
}
const privateRoot=async directory=>{
 if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||/[\x00-\x1f\x7f]/.test(directory))throw Error('Invalid owned service root');
 const stat=await fs.lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||typeof process.getuid!=='function'||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw Error('Service root is not private and owned');
 const marker=await fs.open(path.join(directory,'.blackcrab-managed-host'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {const meta=await marker.stat(),expected=Buffer.from('blackcrab-managed-host-v1\n'),bytes=Buffer.alloc(expected.length+1);if(!meta.isFile()||meta.nlink!==1||meta.uid!==process.getuid()||(meta.mode&0o777)!==0o600||meta.size!==expected.length)throw Error('Owned service marker differs');const read=await marker.read(bytes,0,bytes.length,0);if(read.bytesRead!==expected.length||!bytes.subarray(0,read.bytesRead).equals(expected))throw Error('Owned service marker differs');}finally{await marker.close();}
};
/** caller obtains the exact manifest SHA from trusted native artifact selection, never renderer RPC. */
export async function prepareLocalRuntimeInstallPlan({artifact,manifestSha256,ownerRoot,platform=process.platform,arch=process.arch}) {
 if(!['darwin','linux'].includes(platform))throw Error('Owned boot service unsupported on this platform');
 if(!/^[a-f0-9]{64}$/.test(manifestSha256)||!path.isAbsolute(artifact))throw Error('Invalid local runtime authority');
 await privateRoot(ownerRoot);
 const root=await fs.realpath(artifact),metadata=await fs.lstat(artifact);
 if(!metadata.isDirectory()||metadata.isSymbolicLink()||root!==artifact)throw Error('Local runtime path is not canonical');
 const bytes=await readBoundedFile(path.join(root,MANIFEST_FILE),64*1024*1024);if(bytes.length>64*1024*1024||sha(bytes)!==manifestSha256)throw Error('Local runtime manifest pin differs');
 const manifest=await verifyArtifact(root,{platform,arch});
 for(const record of descriptors())if(!manifest.sourcePatches.some(x=>x.id===record.id&&x.sha256===record.sha256))throw Error('Local runtime lacks owned boot-service profile');
 if(sha(await readBoundedFile(path.join(root,MANIFEST_FILE),64*1024*1024))!==manifestSha256)throw Error('Local runtime manifest changed');
 const baseDir=path.join(ownerRoot,'host'),versionDir=path.join(baseDir,'runtime/versions',manifest.runtime.version),payload=path.join(versionDir,'payload');
 const receipt=Object.freeze({kind:'blackcrab-local-service-preparation'});
 receipts.set(receipt,{profile:'blackcrab-local-service-layout-v1-candidate',wireProtocol:4,layoutCompatibleWithUpstream:false,
  sourceArtifact:root,manifestSha256,baseDir,version:manifest.runtime.version,versionDir,payload,
  entryPath:path.join(payload,manifest.entry),sentinelPath:path.join(versionDir,'.install-complete'),
  program:[path.join(payload,manifest.entry),'__service-launcher'],
  capabilities:{localInstallPrepared:true,serviceInstalled:false,updaterAvailable:false,remoteExposureApplied:false},
  layoutMarker:{file:path.join(versionDir,'.blackcrab-service-layout.json'),contents:{schema:1,profile:'blackcrab-local-service-layout-v1',protocol:4,version:manifest.runtime.version,manifestSha256}},
  requirements:['native-exclusive-install-lease','verified-payload-copy-and-reverify','original-version-command-validation','durable-completion-sentinel-outside-payload','owned-manager-installation','direct-owner-migration-reconciliation']});
 return receipt;
}
/** No caller-supplied paths/PIDs/commands are accepted after the native-private receipt is minted. */
export function localRuntimeInstallPlan(receipt) {
 const value=receipts.get(receipt);if(!value)throw Error('Unverified local runtime receipt');
 return structuredClone(value);
}
