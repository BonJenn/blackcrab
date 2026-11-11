// Exact production route expression, real Effect/HTTP runtime, fixture services.
// This is not a complete packaged-server or native-issuer acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';

const here=new URL('.',import.meta.url),nonce='a'.repeat(64),secret='b'.repeat(64);
const effect=new URL('../../../node_modules/effect/dist/',here);
const [Effect,Context,Layer,HttpServer]=await Promise.all([
 import(new URL('Effect.js',effect)),import(new URL('Context.js',effect)),
 import(new URL('Layer.js',effect)),import(new URL('http/HttpServer.js',effect))]);
const HttpRouter=await import(new URL('http/HttpRouter.js',effect));
const registry=JSON.parse(await fs.readFile(new URL('registry.json',here)));
const source=registry.patches.find(r=>r.id==='owned-types-http').replacements[0].after;
const start=source.indexOf('class ManagedHostProofError extends');
const end=source.indexOf('\nconst layerEnvironmentMetadata =',start);
assert.ok(start>0&&end>start);
const directory=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'blackcrab-proof-http-'));
const moduleFile=path.join(directory,'route.mjs');
await fs.writeFile(path.join(directory,'OwnedServiceProof.ts'),registry.patches.find(r=>r.id==='owned-types-OwnedServiceProof').replacements[0].after);
const {captureOwnedServiceProof}=await import(pathToFileURL(path.join(directory,'OwnedServiceProof.ts')));
await fs.writeFile(moduleFile,`
import * as Context from ${JSON.stringify(new URL('Context.js',effect).href)};
import * as Effect from ${JSON.stringify(new URL('Effect.js',effect).href)};
import * as Layer from ${JSON.stringify(new URL('Layer.js',effect).href)};
import * as Schema from ${JSON.stringify(new URL('Schema.js',effect).href)};
import * as HttpRouter from ${JSON.stringify(new URL('http/HttpRouter.js',effect).href)};
import * as HttpServerRequest from ${JSON.stringify(new URL('http/HttpServerRequest.js',effect).href)};
import * as HttpServerResponse from ${JSON.stringify(new URL('http/HttpServerResponse.js',effect).href)};
import {createHmac} from 'node:crypto';
import {isOwnedServiceConfig,proveOwnedServiceIdentity} from ${JSON.stringify(pathToFileURL(path.join(directory,'OwnedServiceProof.ts')).href)};
export const ServerConfig={ServerConfig:Context.Service('blackcrab/test/proof/config')};
export const ServerEnvironment={ServerEnvironment:Context.Service('blackcrab/test/proof/environment')};
${stripTypeScriptTypes(source.slice(start,end))}
`,{mode:0o600});
const route=await import(pathToFileURL(moduleFile));
test.after(()=>fs.rm(directory,{recursive:true,force:true}));
const descriptor={environmentId:'legacy-env',serverVersion:'0.1.7',orchestrationProtocolVersion:2};
function owned(){
 const config={port:43123,host:'0.0.0.0',desktopBootstrapSecret:secret};
 captureOwnedServiceProof(config,{schema:1,kind:'blackcrab-owned-service-auth-v1',binding:{profile:'blackcrab-local-service-layout-v1',generation:7,manifestSha256:'c'.repeat(64),environmentId:'legacy-env'},desktopBootstrapSecret:secret,desktopBootstrapToken:'d'.repeat(64)},'0.1.7');
 return config;
}
async function app(t,config,current=descriptor){
 const dependencies=Layer.mergeAll(
  Layer.succeed(route.ServerConfig.ServerConfig,config),
  Layer.succeed(route.ServerEnvironment.ServerEnvironment,{getDescriptor:Effect.succeed(current)}),
  HttpServer.layerServices);
 const app=HttpRouter.toWebHandler(route.layerManagedHostProof.pipe(Layer.provideMerge(dependencies)),{disableLogger:true});
 t.after(()=>app.dispose());return query=>app.handler(new Request('http://localhost/.well-known/blackcrab/managed-host-proof'+query,{headers:{Host:'attacker.invalid',Origin:'https://attacker.invalid'}}));
}
test('actual route returns captured service v2 with no-store and canonical control origin',async t=>{
 const request=await app(t,owned()),response=await request(`?version=2&nonce=${nonce}`);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const proof=await response.json();assert.equal(proof.proof,'f49094a56ee5426748393b93695f50117171c5791d4095aaf978fb9f9335407e');
 assert.equal(proof.origin,'http://127.0.0.1:43123/');assert.equal(Object.keys(proof).length,10);
});
test('actual route rejects duplicate/extra parameters and service downgrade',async t=>{
 const request=await app(t,owned());
 for(const query of [`?version=2&version=2&nonce=${nonce}`,`?version=2&nonce=${nonce}&nonce=${nonce}`,`?version=2&nonce=${nonce}&manifestSha256=x`,'?version=2&nonce=bad','?version=3'])assert.equal((await request(query)).status,400);
 for(const query of [`?version=1&nonce=${nonce}`,`?nonce=${nonce}`])assert.equal((await request(query)).status,404);
});
test('actual route refuses changed descriptor and uncaptured configuration',async t=>{
 const request=await app(t,owned(),{...descriptor,environmentId:'other'});assert.equal((await request(`?version=2&nonce=${nonce}`)).status,503);
 const clone=await app(t,{...owned()});assert.equal((await clone(`?version=2&nonce=${nonce}`)).status,404);
});
test('actual route preserves Direct v1 and refuses v2 without private service capture',async t=>{
 const request=await app(t,{port:43123,host:'127.0.0.1',desktopBootstrapSecret:secret});
 assert.equal((await request(`?version=2&nonce=${nonce}`)).status,404);
 const response=await request(`?nonce=${nonce}`);assert.equal(response.status,200);
 const proof=await response.json(),expected=createHmac('sha256',secret).update(JSON.stringify(['blackcrab-managed-host-proof-v1',nonce,'legacy-env','http://127.0.0.1:43123/','0.1.7',2])).digest('hex');
 assert.equal(proof.version,1);assert.equal(proof.proof,expected);assert.equal(Object.keys(proof).length,7);
});

test('actual composed route refuses missing or incompatible descriptor protocols',async t=>{
 for(const orchestrationProtocolVersion of [undefined,1,3]){
  const request=await app(t,owned(),{...descriptor,orchestrationProtocolVersion});
  assert.equal((await request(`?version=2&nonce=${nonce}`)).status,503);
 }
});
