/** Private dispatch candidate. Not registered by this source file. */
import fs from 'node:fs';import path from 'node:path';
import {resolveEffectiveConfiguration} from './EffectiveConfigRuntime.ts';
export const PRIVATE_COMMAND='__blackcrab-effective-config-v1';
function owned(directory:string){const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700||fs.realpathSync(directory)!==directory)throw Error('effective-config-private-root-required')}
function marker(file:string,expected:string){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size!==Buffer.byteLength(expected))throw Error('effective-config-marker');const b=Buffer.alloc(s.size+1);const n=fs.readSync(fd,b,0,b.length,0);if(n!==s.size||b.subarray(0,n).toString()!==expected)throw Error('effective-config-marker')}finally{fs.closeSync(fd)}}
export async function runEffectiveConfigPrivateCli(){
 try{
  if(process.argv.length!==3||process.argv[2]!==PRIVATE_COMMAND)throw Error('effective-config-arguments');
  const bytes=Buffer.alloc(16385);let n=0;
  for(;;){const read=fs.readSync(3,bytes,n,bytes.length-n,null);if(!read)break;n+=read;if(n>16384)throw Error('effective-config-input-bound')}
  const input=JSON.parse(bytes.subarray(0,n).toString('utf8'));
  if(!input||Array.isArray(input)||Object.keys(input).sort().join(',')!=='ownerRoot,port,schema'||input.schema!==1||typeof input.ownerRoot!=='string'||input.ownerRoot.length>4096||!path.isAbsolute(input.ownerRoot)||/[\x00-\x1f\x7f]/.test(input.ownerRoot)||!Number.isInteger(input.port)||input.port<1||input.port>65535)throw Error('effective-config-input');
  owned(input.ownerRoot);marker(path.join(input.ownerRoot,'.blackcrab-managed-host'),'blackcrab-managed-host-v1\n');
  const profile=path.join(input.ownerRoot,'native-desktop-profile-v1');owned(profile);owned(path.join(profile,'home'));marker(path.join(profile,'.blackcrab-managed-desktop'),'blackcrab-managed-desktop-profile-v1\n');
  owned(path.join(input.ownerRoot,'host'));owned(path.join(input.ownerRoot,'host/userdata'));
  const result=await resolveEffectiveConfiguration({ownerRoot:input.ownerRoot,port:input.port});const output=JSON.stringify(result)+'\n';if(Buffer.byteLength(output)>4096)throw Error('effective-config-output-bound');process.stdout.write(output);
 }catch{process.stderr.write('Blackcrab effective configuration unavailable\n');process.exitCode=78}
}
