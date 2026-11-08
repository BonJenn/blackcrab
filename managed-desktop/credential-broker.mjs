import fs from 'node:fs';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
const credentialPattern=/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;
export function validateCredentialReply(value,request,now=Date.now()){
 if(!value||typeof value!=='object'||Object.keys(value).length!==7||value.version!==1||value.kind!=='paired-credential'||value.requestId!==request.requestId||value.generation!==request.generation||value.environmentId!==request.environmentId||!credentialPattern.test(value.credential)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+86400000)throw Error('Invalid owner credential reply');return value.credential;
}
/** Private full-duplex inherited FD4. Root must implement this contract before adoption. */
export function createCredentialBroker(descriptor,onFailure=()=>{}){
 if(!fs.fstatSync(4).isSocket())throw Error('Owner credential broker requires inherited private duplex socket FD4');
 let stopped=false,pending=null,buffer='';const stream=new net.Socket({fd:4,readable:true,writable:true});
 const fail=(notify=true)=>{if(stopped)return;stopped=true;if(pending){clearTimeout(pending.timer);pending.reject(Error('Owner credential broker unavailable'));pending=null;}if(notify)onFailure();};
 stream.on('data',chunk=>{buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>16384){fail();stream.destroy();return;}const index=buffer.indexOf('\n');if(index<0)return;const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(buffer||!pending){fail();return;}const current=pending;pending=null;clearTimeout(current.timer);try{current.resolve(validateCredentialReply(JSON.parse(line),current.request));}catch{current.reject(Error('Owner credential reply refused'));fail();}});stream.on('error',()=>fail());stream.on('end',()=>fail());stream.unref();
 return Object.freeze({renew(){if(stopped||pending)return Promise.reject(Error('Owner credential broker unavailable'));const request={version:1,kind:'native-client-credential',requestId:randomUUID(),generation:descriptor.owner.generation,environmentId:descriptor.owner.environmentId};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending=null;reject(Error('Owner credential broker timed out'));fail();},10000);timer.unref();pending={request,resolve,reject,timer};stream.write(JSON.stringify(request)+'\n',error=>{if(error)fail();});});},close(){fail(false);stream.destroy();}});
}
