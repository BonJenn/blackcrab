// Private server module. Captured FD0 issuance stays out of public configuration.
import {createHmac} from 'node:crypto';
import type {OwnedServiceAuthBootstrap} from './OwnedServiceAuthBootstrap.ts';

interface Configuration {readonly port:number;readonly desktopBootstrapSecret?:string}
interface Descriptor {readonly environmentId:string;readonly serverVersion:string;readonly orchestrationProtocolVersion:number}
interface Proof {
 readonly version:2;readonly nonce:string;readonly environmentId:string;readonly origin:string;
 readonly serverVersion:string;readonly orchestrationProtocolVersion:2;readonly manifestSha256:string;
 readonly layoutProfile:'blackcrab-local-service-layout-v1';readonly serviceProtocol:4;readonly proof:string;
}
const PROFILE='blackcrab-local-service-layout-v1';
const hex=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const unavailable=()=>Error('Owned service identity is unavailable');
const issuers=new WeakMap<object,(nonce:string,descriptor:Descriptor)=>Proof>();

/** Only the actual CLI config resolver calls this after its mandatory FD0 read
 * and validated original IPC context. This is not an authority API for JSON,
 * discovery, HTTP, renderer settings, or a caller-supplied native helper path. */
export function captureOwnedServiceProof(config:Configuration,auth:OwnedServiceAuthBootstrap,childVersion:string|undefined):void {
 if(issuers.has(config)||!hex(auth.desktopBootstrapSecret)||!hex(auth.desktopBootstrapToken)||
    auth.schema!==1||auth.kind!=='blackcrab-owned-service-auth-v1'||
    auth.binding.profile!==PROFILE||!Number.isSafeInteger(auth.binding.generation)||auth.binding.generation<1||
    !hex(auth.binding.manifestSha256)||!auth.binding.environmentId||auth.binding.environmentId.length>128||
    auth.binding.environmentId.trim()!==auth.binding.environmentId||/[\x00-\x1f\x7f]/.test(auth.binding.environmentId)||
    typeof childVersion!=='string'||childVersion.length>128||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(childVersion)||
    config.desktopBootstrapSecret!==auth.desktopBootstrapSecret||!Number.isInteger(config.port)||config.port<1||config.port>65535)
  throw unavailable();
 // Copy primitives before installing the closure. Later mutations cannot select
 // another identity; generation remains a native issuance/context fence.
 const secret=auth.desktopBootstrapSecret,environmentId=auth.binding.environmentId;
 const manifestSha256=auth.binding.manifestSha256,serverVersion=childVersion;
 const origin=new URL(`http://127.0.0.1:${config.port}/`).href;
 issuers.set(config,(nonce,descriptor)=>{
  if(!hex(nonce)||descriptor.environmentId!==environmentId||descriptor.serverVersion!==serverVersion||descriptor.orchestrationProtocolVersion!==2)
   throw unavailable();
  const transcript=JSON.stringify(['blackcrab-managed-host-proof-v2',nonce,environmentId,origin,serverVersion,2,manifestSha256,PROFILE,4]);
  return {version:2,nonce,environmentId,origin,serverVersion,orchestrationProtocolVersion:2,manifestSha256,
   layoutProfile:PROFILE,serviceProtocol:4,proof:createHmac('sha256',secret).update(transcript).digest('hex')};
 });
}

/** Restriction marker for the original CLI's mandatory IPC-loss watcher.
 * Object identity matters: serializing/cloning config cannot transfer capture. */
export const isOwnedServiceConfig=(config:object):boolean=>issuers.has(config);
export function proveOwnedServiceIdentity(config:object,nonce:string,descriptor:Descriptor):Proof|undefined {
 return issuers.get(config)?.(nonce,descriptor);
}
