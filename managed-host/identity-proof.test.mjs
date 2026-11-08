import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, createHmac } from 'node:crypto';
const registry = JSON.parse(fs.readFileSync(new URL('./patches/registry.json', import.meta.url)));
const patch = registry.find(p => p.id === 'managed-host-identity-proof');
const sha = s => createHash('sha256').update(s).digest('hex');
function applied() {
 let source = fs.readFileSync(new URL('./fixtures/http-proof.before.ts', import.meta.url), 'utf8');
 assert.equal(sha(source), patch.beforeSha256);
 for (const r of patch.replacements) { assert.equal(source.split(r.before).length, 2); source = source.replace(r.before, r.after); }
 assert.equal(sha(source), patch.afterSha256); return source;
}
function invoke({ nonce = 'a'.repeat(64), host = '127.0.0.1', port = 45678, secret = 'owner', requestOrigin = 'http://attacker.invalid' } = {}) {
 const source = applied();
 const route = source.slice(source.indexOf('export const layerManagedHostProof'), source.indexOf('const layerEnvironmentMetadata')).replace('export const layerManagedHostProof', 'globalThis.route');
 const descriptor = { environmentId:'env_owned', serverVersion:'0.1.7', orchestrationProtocolVersion:2 };
 const ctx = { createHmac, URL, ServerConfig:{ServerConfig:{host,port,desktopBootstrapSecret:secret}}, HttpServerRequest:{HttpServerRequest:{url:`/.well-known/blackcrab/managed-host-proof?nonce=${nonce}`,headers:{host:'attacker.invalid',origin:requestOrigin}}}, ServerEnvironment:{ServerEnvironment:{getDescriptor:descriptor}}, Effect:{gen:f=>f}, HttpRouter:{add:(_method,_path,handler)=>handler}, HttpServerResponse:{empty:({status})=>({status}),jsonUnsafe:(body,opts)=>({status:200,body,...opts})} };
 const effect = value => ({ *[Symbol.iterator]() { return yield value; } });
 ctx.ServerConfig.ServerConfig = effect(ctx.ServerConfig.ServerConfig);
 ctx.HttpServerRequest.HttpServerRequest = effect(ctx.HttpServerRequest.HttpServerRequest);
 ctx.ServerEnvironment.ServerEnvironment.getDescriptor = effect(descriptor);
 ctx.ServerEnvironment.ServerEnvironment = effect(ctx.ServerEnvironment.ServerEnvironment);
 vm.runInNewContext(route, ctx); const gen = ctx.route(); let step = gen.next(); while(!step.done) step = gen.next(step.value); return step.value;
}
test('exact source patch and nonce HMAC bind actual identity/configuration, never request origin',()=>{
 const result=invoke(); assert.equal(result.status,200); const b=result.body;
 const fields=['blackcrab-managed-host-proof-v1','a'.repeat(64),'env_owned','http://127.0.0.1:45678/','0.1.7',2];
 assert.equal(b.proof,createHmac('sha256','owner').update(JSON.stringify(fields)).digest('hex'));
 assert.equal(b.origin,fields[3]); assert.equal(result.headers['Cache-Control'],'no-store'); assert.equal(Object.keys(b).length,7);
 assert(!JSON.stringify(b).includes('owner'));
});
test('challenge rejects malformed nonce and non-owned binding configuration',()=>{
 for(const nonce of ['', 'a'.repeat(63), 'A'.repeat(64), '%0A'+'a'.repeat(64)]) assert.equal(invoke({nonce}).status,400);
 for(const args of [{host:'0.0.0.0'},{host:undefined},{port:0},{port:65536},{secret:''}]) {
   if ('host' in args && args.host===undefined) args.host='localhost';
   assert.equal(invoke(args).status,404);
 }
});
