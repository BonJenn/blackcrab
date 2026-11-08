/** Serialized per-native-client sessions. No owner bootstrap secret or static bearer is accepted. */
export function createAccessSession({ credential, renew, exchange, validate, now = Date.now,onRevoked=()=>{} }) {
 let initial=credential, cached=null, pending=null,revoked=false;
 return Object.freeze({async get(){
  if(pending)return pending;
  pending=(async()=>{
   if(revoked)throw Error('Native authorization revoked; explicit owner reauthorization required');
   if(cached&&now()<cached.expiresAt-30000){if(await validate(cached.token))return cached.token;cached=null;revoked=true;onRevoked();throw Error('Native authorization revoked; explicit owner reauthorization required');}
   cached=null;
   const grant=initial??await renew();initial=null; // Pairing grants are consumed exactly once.
   const result=await exchange(grant);
   if(typeof result.access_token!=='string'||!result.access_token||!Number.isSafeInteger(result.expires_in)||result.expires_in<=30||result.expires_in>366*86400)throw Error('Invalid native client session lifetime');
   cached={token:result.access_token,expiresAt:now()+result.expires_in*1000};return cached.token;
  })();try{return await pending;}finally{pending=null;}
 }});
}
