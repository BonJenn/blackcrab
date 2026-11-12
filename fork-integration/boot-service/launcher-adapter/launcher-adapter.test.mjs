import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,until} from './launcher-fixture.mjs';
for(const trial of [false,true])test('original launcher FD0 auth + IPC3 preserved '+(trial?'trial commit':'active'),async()=>{
 const f=await fixture({trial});let run;
 try{run=f.launcher.run();const state=await until(async()=>{const x=JSON.parse(await fs.readFile(f.output,'utf8'));return(!trial||x.committed==='trial-fixture')&&x;});assert.equal(state.ipc,true);assert.equal(state.auth.kind,'blackcrab-owned-service-auth-v1');assert.deepEqual(Object.keys(state.auth).sort(),['binding','desktopBootstrapSecret','desktopBootstrapToken','kind','schema']);assert.deepEqual(state.context.ownedAuth,state.auth.binding);assert.equal(state.context.protocol,4);await f.launcher.stop('SIGTERM');await run;const stopped=JSON.parse(await fs.readFile(f.output,'utf8'));assert.equal(stopped.stopped,true);const phases=(await fs.readFile(f.transcript,'utf8')).trim().split('\n').map(x=>JSON.parse(x).type);assert.deepEqual(phases,['begin','issued','retire']);}finally{await f.launcher.stop('SIGTERM').catch(()=>{});await run?.catch(()=>{});await f.cleanup();}
});
test('helper EOF kills only captured child and never starts replacement',async()=>{
 const f=await fixture({helperMode:'dieAfterIssue'});try{const run=f.launcher.run();await assert.rejects(run,/bootstrap/);const state=JSON.parse(await fs.readFile(f.output,'utf8'));assert.equal(state.stopped,true);const phases=(await fs.readFile(f.transcript,'utf8')).trim().split('\n').map(x=>JSON.parse(x).type);assert.equal(phases.filter(x=>x==='begin').length,1);}finally{await f.cleanup();}
});
test('native malformed/network envelope is rejected before any child exists',async()=>{
 const f=await fixture({helperMode:'networkInjection'});try{await assert.rejects(f.launcher.run(),/bootstrap/);await assert.rejects(fs.stat(f.output),{code:'ENOENT'});}finally{await f.cleanup();}
});
test('fixed helper copy is byte-pinned and service.env cannot select helper path',async()=>{
 const f=await fixture();try{const binding=JSON.parse(await fs.readFile(path.join(f.owner,'native-issuer-binding.json'),'utf8'));await fs.appendFile(path.join(f.owner,'issuer',binding.selfSha256,'blackcrab-issuer'),'# tamper');await assert.rejects(f.OwnedLauncherBootstrap.open(f.base,()=>{}),/bootstrap/);}finally{await f.cleanup();}
});

for(const fatal of [false,true])test('terminal settles without retirement when captured cleanup fails '+(fatal?'fatal':'stop'),async()=>{
 const f=await fixture({helperMode:fatal?'dieAfterIssue':'normal',cleanupFailure:true});let captured;let run;
 try{run=f.launcher.run();run.catch(()=>{});await until(async()=>JSON.parse(await fs.readFile(f.output,'utf8')));if(!fatal)await f.launcher.stop('SIGTERM');await assert.rejects(Promise.race([run,new Promise((_,reject)=>setTimeout(()=>reject(Error('terminal hung')),4000))]),/bootstrap/);captured=globalThis.__fixtureCapturedChild;assert.ok(captured?.pid);const phases=(await fs.readFile(f.transcript,'utf8')).trim().split('\n').map(x=>JSON.parse(x).type);assert.equal(phases.includes('retire'),false);assert.equal(phases.filter(x=>x==='begin').length,1);}
 finally{captured??=globalThis.__fixtureCapturedChild;if(captured&&captured.exitCode===null&&captured.signalCode===null){const exited=new Promise(resolve=>captured.once('exit',resolve));captured.kill('SIGKILL');await exited;}delete globalThis.__fixtureCapturedChild;await run?.catch(()=>{});await f.cleanup();}
});

test('native preflight failure precedes original trial database recovery',async()=>{
 const f=await fixture({helperMode:'failPreflight',trial:true});try{await assert.rejects(f.launcher.run(),/bootstrap/);await assert.rejects(fs.stat(path.join(f.base,'runtime','db-backup')),{code:'ENOENT'});await assert.rejects(fs.stat(f.output),{code:'ENOENT'});}finally{await f.cleanup();}
});
test('slow native preflight happens before child bootstrap timeout and recovery',async()=>{
 const f=await fixture({helperMode:'delayedReady',trial:true});let run;try{run=f.launcher.run();run.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,150));await assert.rejects(fs.stat(f.output),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(f.base,'runtime','db-backup')),{code:'ENOENT'});await until(async()=>{const x=JSON.parse(await fs.readFile(f.output,'utf8'));return x.committed;});await f.launcher.stop('SIGTERM');await run;}finally{await f.launcher.stop('SIGTERM').catch(()=>{});await run?.catch(()=>{});await f.cleanup();}
});
