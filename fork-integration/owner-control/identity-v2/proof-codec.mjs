// Pure candidate crypto/schema contract; NOT an issuer, authority receipt or active route.
import {createHmac,timingSafeEqual} from 'node:crypto';
export const SERVICE_PROFILE='blackcrab-local-service-layout-v1';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
function identity(x,version){
 if(!x||typeof x.environmentId!=='string'||!x.environmentId||x.environmentId.length>128||/[\0\r\n]/.test(x.environmentId)||(version===1?x.serverVersion!=='0.1.7':typeof x.serverVersion!=='string'||x.serverVersion.length>128||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(x.serverVersion))||x.orchestrationProtocolVersion!==2)throw Error('Identity unavailable');
 const u=new URL(x.origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.href!==x.origin)throw Error('Identity unavailable');
}
function service(x){if(!hex(x.manifestSha256)||x.layoutProfile!==SERVICE_PROFILE||x.serviceProtocol!==4)throw Error('Service identity unavailable');}
export function transcript(version,nonce,selected){
 if(!hex(nonce))throw Error('Invalid challenge');identity(selected,version);
 const fields=[`blackcrab-managed-host-proof-v${version}`,nonce,selected.environmentId,selected.origin,selected.serverVersion,selected.orchestrationProtocolVersion];
 if(version===2){service(selected);fields.push(selected.manifestSha256,selected.layoutProfile,selected.serviceProtocol);}else if(version!==1)throw Error('Unsupported proof');
 return JSON.stringify(fields);
}
/** A low-level testable codec. Calling this does not authenticate an issuance or artifact. */
export function encodeProof(secret,version,nonce,selected){
 if(typeof secret!=='string'||!secret||(version===2&&!hex(secret)))throw Error('Owner secret unavailable');
 const message=transcript(version,nonce,selected),proof=createHmac('sha256',secret).update(message).digest('hex');
 return {version,nonce,environmentId:selected.environmentId,origin:selected.origin,serverVersion:selected.serverVersion,orchestrationProtocolVersion:selected.orchestrationProtocolVersion,...(version===2?{manifestSha256:selected.manifestSha256,layoutProfile:selected.layoutProfile,serviceProtocol:selected.serviceProtocol}:{}),proof};
}
/** selected is native-private verified configuration, NEVER response/request-derived JSON. */
export function verifyProof(secret,ownership,nonce,selected,response){
 const version=ownership==='direct'?1:ownership==='service'?2:0;
 if(!version)throw Error('Unknown owner policy');
 const keys=['version','nonce','environmentId','origin','serverVersion','orchestrationProtocolVersion','proof',...(version===2?['manifestSha256','layoutProfile','serviceProtocol']:[])];
 if(!exact(response,keys)||response.version!==version||response.nonce!==nonce)throw Error('Host proof refused');
 const expected=encodeProof(secret,version,nonce,selected);
 for(const key of keys)if(key!=='proof'&&response[key]!==expected[key])throw Error('Host proof refused');
 if(!hex(response.proof)||!timingSafeEqual(Buffer.from(response.proof,'hex'),Buffer.from(expected.proof,'hex')))throw Error('Host proof refused');
 return true;
}
