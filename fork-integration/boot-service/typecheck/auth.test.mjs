import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const here=new URL('.',import.meta.url);
const registry=JSON.parse(await fs.readFile(new URL('registry.json',here)));
const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'blackcrab-typed-auth-'));
await fs.mkdir(path.join(root,'cloud'));
await fs.symlink(fileURLToPath(new URL('../../../node_modules',here)),path.join(root,'node_modules'),'junction');
await fs.writeFile(path.join(root,'OwnedServiceAuthBootstrap.ts'),registry.patches.find(r=>r.id==='owned-types-OwnedServiceAuthBootstrap').replacements[0].after);
await fs.copyFile(new URL('../browser-channel/OwnedServiceBrowser.ts',here),path.join(root,'OwnedServiceBrowser.ts'));
await fs.copyFile(new URL('../owned-auth/fixtures/serviceProtocol.after.ts',here),path.join(root,'cloud/serviceProtocol.ts'));
const binding={profile:'blackcrab-local-service-layout-v1',generation:7,manifestSha256:'a'.repeat(64),environmentId:'private-test-environment'};
const envelope={schema:1,kind:'blackcrab-owned-service-auth-v1',binding,desktopBootstrapToken:'b'.repeat(64),desktopBootstrapSecret:'c'.repeat(64)};
await fs.writeFile(path.join(root,'read.mjs'),`
import * as Effect from 'effect/Effect';
import {readOwnedServiceAuthBootstrap} from './OwnedServiceAuthBootstrap.ts';
const result=await Effect.runPromise(readOwnedServiceAuthBootstrap(${JSON.stringify(binding)}).pipe(Effect.match({
 onSuccess:auth=>({ok:true,environmentId:auth.binding.environmentId,hasSocket:auth.desktopBrowserSocket!==undefined}),
 onFailure:error=>({ok:false,tag:error._tag,message:error.message})
})));
process.stdout.write(JSON.stringify(result));
`);
test.after(()=>fs.rm(root,{recursive:true,force:true}));

async function read(input){
 const child=spawn(process.execPath,[path.join(root,'read.mjs')],{cwd:root,env:{PATH:path.dirname(process.execPath)},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';
 const timer=setTimeout(()=>child.kill('SIGTERM'),5000);
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>4096)child.kill('SIGTERM');});
 child.stderr.on('data',b=>{stderr+=b;if(stderr.length>4096)child.kill('SIGTERM');});
 child.stdin.on('error',()=>{});
 child.stdin.end(typeof input==='string'?input:JSON.stringify(input));
 try{
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,0,stderr);
  assert(!stdout.includes(envelope.desktopBootstrapToken)&&!stdout.includes(envelope.desktopBootstrapSecret));
  return JSON.parse(stdout);
 }finally{clearTimeout(timer);}
}

test('composed FD0 decoder accepts valid owned identity and browser capability',async()=>{
 assert.deepEqual(await read(envelope),{ok:true,environmentId:binding.environmentId,hasSocket:false});
 const desktopBrowserSocket={path:'/private/tmp/blackcrab-browser-'+'d'.repeat(32)+'/b.sock',key:'e'.repeat(64),generation:7};
 assert.deepEqual(await read({...envelope,desktopBrowserSocket}),{ok:true,environmentId:binding.environmentId,hasSocket:true});
});

test('composed FD0 decoder rejects malformed, excessive, stale and configuration-bearing input',async t=>{
 const invalid={
  empty:'', malformed:'{broken', oversized:'x'.repeat(17000),
  stale:{...envelope,binding:{...binding,generation:8}},
  configuration:{...envelope,host:'0.0.0.0'},
  nestedExtra:{...envelope,binding:{...binding,unexpected:true}},
  missingSecret:{...envelope,desktopBootstrapSecret:undefined},
  emptyToken:{...envelope,desktopBootstrapToken:''},
  socket:{...envelope,desktopBrowserSocket:{path:'/foreign/b.sock',key:'e'.repeat(64),generation:7}},
  incompleteDescriptors:{...envelope,desktopBrowserFd:5},
 };
 for(const [name,input] of Object.entries(invalid))await t.test(name,async()=>{
  assert.deepEqual(await read(input),{ok:false,tag:'OwnedServiceAuthError',message:'owned-auth-unavailable'});
 });
});
