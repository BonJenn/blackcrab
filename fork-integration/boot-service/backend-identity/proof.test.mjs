import test from 'node:test';
import assert from 'node:assert/strict';
import {captureOwnedServiceProof,isOwnedServiceConfig,proveOwnedServiceIdentity} from './OwnedServiceProof.ts';
const secret='b'.repeat(64),nonce='a'.repeat(64),manifest='c'.repeat(64);
const descriptor={environmentId:'legacy-env',serverVersion:'0.1.7',orchestrationProtocolVersion:2};
function fixture(){
 const config={port:43123,host:'0.0.0.0',privateNetworkOnly:true,desktopBootstrapSecret:secret};
 const auth={schema:1,kind:'blackcrab-owned-service-auth-v1',binding:{profile:'blackcrab-local-service-layout-v1',generation:7,manifestSha256:manifest,environmentId:'legacy-env'},desktopBootstrapToken:'d'.repeat(64),desktopBootstrapSecret:secret};
 return{config,auth};
}
test('captured private configuration issues interoperable v2 proof without changing LAN binding',()=>{
 const {config,auth}=fixture();captureOwnedServiceProof(config,auth,'0.1.7');
 const proof=proveOwnedServiceIdentity(config,nonce,descriptor);
 assert.equal(proof.proof,'f49094a56ee5426748393b93695f50117171c5791d4095aaf978fb9f9335407e');
 assert.equal(proof.origin,'http://127.0.0.1:43123/');assert.equal(Object.keys(proof).length,10);
 assert.equal(config.host,'0.0.0.0');assert.equal(config.privateNetworkOnly,true);
 assert.equal(proof.desktopBootstrapSecret,undefined);assert.equal(proof.desktopBootstrapToken,undefined);
});
test('cloning/serializing config does not transfer capture and direct config has no v2 issuer',()=>{
 const {config,auth}=fixture();captureOwnedServiceProof(config,auth,'0.1.7');
 for(const copy of [{...config},JSON.parse(JSON.stringify(config)),{}]){
  assert.equal(isOwnedServiceConfig(copy),false);assert.equal(proveOwnedServiceIdentity(copy,nonce,descriptor),undefined);
 }
 assert.equal(isOwnedServiceConfig(config),true);assert.throws(()=>captureOwnedServiceProof(config,auth,'0.1.7'));
});
test('default HTTP port uses the same canonical loopback origin as the native verifier',()=>{
 const {config,auth}=fixture();config.port=80;captureOwnedServiceProof(config,auth,'0.1.7');
 assert.equal(proveOwnedServiceIdentity(config,nonce,descriptor).origin,'http://127.0.0.1/');
});
test('fresh descriptor and nonce are checked on every proof request',()=>{
 const{config,auth}=fixture();captureOwnedServiceProof(config,auth,'0.1.7');
 for(const altered of [{...descriptor,environmentId:'other'},{...descriptor,serverVersion:'0.1.8'},{...descriptor,orchestrationProtocolVersion:3}])
  assert.throws(()=>proveOwnedServiceIdentity(config,nonce,altered));
 for(const n of ['',nonce.toUpperCase(),'f'.repeat(63),'é'.repeat(32)])assert.throws(()=>proveOwnedServiceIdentity(config,n,descriptor));
 const next=proveOwnedServiceIdentity(config,'e'.repeat(64),descriptor);
 assert.notEqual(next.proof,proveOwnedServiceIdentity(config,nonce,descriptor).proof);
});
test('later changes to caller-owned envelope/config cannot change captured identity',()=>{
 const{config,auth}=fixture();captureOwnedServiceProof(config,auth,'0.1.7');
 auth.binding.manifestSha256='0'.repeat(64);auth.binding.environmentId='other';auth.desktopBootstrapSecret='0'.repeat(64);config.port=43124;
 const proof=proveOwnedServiceIdentity(config,nonce,descriptor);
 assert.equal(proof.manifestSha256,manifest);assert.equal(proof.environmentId,'legacy-env');
 assert.equal(proof.origin,'http://127.0.0.1:43123/');assert.equal(proof.proof,'f49094a56ee5426748393b93695f50117171c5791d4095aaf978fb9f9335407e');
});
test('malformed issuance fails before installing an identity marker',()=>{
 for(const change of [x=>x.auth.desktopBootstrapSecret='',x=>x.auth.desktopBootstrapToken='x',x=>x.auth.binding.generation=Number.MAX_SAFE_INTEGER+1,
  x=>x.auth.binding.manifestSha256='x',x=>x.auth.binding.environmentId=' bad ',x=>x.config.port=0,x=>x.config.desktopBootstrapSecret='x']){
  const x=fixture();change(x);assert.throws(()=>captureOwnedServiceProof(x.config,x.auth,'0.1.7'));assert.equal(isOwnedServiceConfig(x.config),false);
 }
 const{config,auth}=fixture();assert.throws(()=>captureOwnedServiceProof(config,auth,undefined));assert.equal(isOwnedServiceConfig(config),false);
});
