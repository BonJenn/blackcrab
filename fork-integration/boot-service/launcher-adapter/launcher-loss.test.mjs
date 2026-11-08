import test from'node:test';import assert from'node:assert/strict';import*as fs from'node:fs/promises';import path from'node:path';import os from'node:os';import*as cp from'node:child_process';import{once}from'node:events';
const moduleUrl=new URL('OwnedServiceLauncherLoss.ts',import.meta.url).href;
async function fixture(ipc){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'blackcrab-owned-loss-'));const result=path.join(root,'result.json'),started=path.join(root,'started');const entry=path.join(root,'child.mjs');
 const effect=new URL('../../../node_modules/effect/dist/Effect.js',import.meta.url).href;
 await fs.writeFile(entry,`import*as fs from'node:fs';import*as Effect from ${JSON.stringify(effect)};import{withOwnedServiceLauncherLifetime}from ${JSON.stringify(moduleUrl)};const before=process.listenerCount('disconnect');const run=Effect.sync(()=>{fs.writeFileSync(${JSON.stringify(started)},'started');process.send?.('started');}).pipe(Effect.andThen(Effect.never));try{await Effect.runPromise(withOwnedServiceLauncherLifetime(run));}catch{}fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({before,after:process.listenerCount('disconnect')}));`);
 const child=cp.spawn(process.execPath,[entry],{stdio:ipc?['ignore','ignore','pipe','ipc']:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);const exit=once(child,'exit');return{root,result,started,child,exit,errors:()=>errors,cleanup:async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}await fs.rm(root,{recursive:true,force:true});}};
}
test('owned web/headless lifetime interrupts on real IPC disconnect and removes watcher',async()=>{
 const f=await fixture(true);const sentinel=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const sentinelExit=once(sentinel,'exit');
 try{await once(f.child,'message');f.child.disconnect();const[code]=await f.exit;assert.equal(code,0,f.errors());const result=JSON.parse(await fs.readFile(f.result));assert.equal(result.before,result.after);assert.equal(sentinel.exitCode,null);}finally{await f.cleanup();sentinel.kill('SIGTERM');await sentinelExit;}
});
test('already disconnected owned child refuses startup before server effect',async()=>{
 const f=await fixture(false);try{const[code]=await f.exit;assert.equal(code,0,f.errors());await assert.rejects(fs.stat(f.started),{code:'ENOENT'});const result=JSON.parse(await fs.readFile(f.result));assert.equal(result.before,result.after);}finally{await f.cleanup();}
});
