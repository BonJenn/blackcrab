import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {createOwnerSupervisor} from './supervisor.mjs';
import {createFileJournal} from './journal.mjs';
const request=(revision,id,operation)=>({protocol:1,environmentId:'env',epoch:'epoch',revision,requestId:id,operation});
async function fixture(t, options={}) {
 const dir=await mkdtemp(join(tmpdir(),'owner-core-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const handles=[]; let ownership=true;
 const children={assertAvailable:async()=>{},assertOwnership:async()=>{if(!ownership)throw new Error('ownership gone');},
  start:async()=>{const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(child,'spawn');
   const callbacks=[];child.once('exit',()=>callbacks.forEach(f=>f()));const handle={child,onExit:f=>callbacks.push(f),stale:()=>callbacks.forEach(f=>f())};handles.push(handle);return handle;},
  stop:async handle=>{const exit=once(handle.child,'exit');handle.child.kill('SIGTERM');await exit;}};
 t.after(async()=>{for(const h of handles)if(h.child.exitCode===null&&h.child.signalCode===null){const exit=once(h.child,'exit');h.child.kill();await exit;}});
 const journal=createFileJournal(join(dir,'journal.json'));
 const core=await createOwnerSupervisor({environmentId:'env',epoch:'epoch',journal,sessions:{assertVerified:async s=>{if(s!=='verified')throw new Error('unverified');},detach:async()=>{}},children,
 exposure:{setMode:async()=>({state:{mode:'network-accessible'},requiresRelaunch:true}),setTailscaleServeEnabled:async()=>({requiresRelaunch:false})},...options});
 await core.start();return {core,handles,journal,dir,lose:()=>{ownership=false;}};
}
test('captured subprocess survives client detach; restart ignores stale child event and stop touches only captured host',async t=>{
 const f=await fixture(t);const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(unrelated,'spawn');t.after(()=>unrelated.kill());
 await f.core.detach('verified');assert.equal(f.handles[0].child.exitCode,null);
 await f.core.request('verified',request(0,'restart',{type:'restart'}));assert.equal(f.handles.length,2);
 f.handles[0].stale();assert.equal(f.core.snapshot().running,true);
 await f.core.request('verified',request(1,'stop',{type:'stop'}));assert.equal(f.core.snapshot().running,false);assert.equal(unrelated.exitCode,null);
});
test('concurrent stale setters/restarts are fenced after one serialized mutation',async t=>{
 const {core,handles}=await fixture(t);const results=await Promise.allSettled([
 core.request('verified',request(0,'a',{type:'setExposure',mode:'network-accessible'})),core.request('verified',request(0,'b',{type:'restart'}))]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(handles.length,2);
 await assert.rejects(core.request('verified',request(1,'a',{type:'stop'})),/replay/);
 await assert.rejects(core.request('unverified',request(1,'c',{type:'stop'})),/unverified/);
});
test('uncertain write fences live supervisor and pending journal blocks recovery without replay',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'owner-uncertain-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const disk=createFileJournal(join(dir,'journal'));let writes=0,starts=0;
 const options={environmentId:'env',epoch:'epoch',journal:{load:()=>disk.load(),commit:async(...args)=>{await disk.commit(...args);if(++writes===2)throw new Error('uncertain fsync reply');}},
 sessions:{assertVerified:async()=>{},detach:async()=>{}},children:{assertAvailable:async()=>{},assertOwnership:async()=>{},start:async()=>{starts++;return {onExit:()=>{}};},stop:async()=>{}},exposure:{}};
 const core=await createOwnerSupervisor(options);await core.start();await assert.rejects(core.request('ok',request(0,'a',{type:'restart'})),/uncertain/);
 assert.equal(starts,1);await assert.rejects(core.request('ok',request(0,'b',{type:'restart'})),/lost ownership/);
 await assert.rejects(createOwnerSupervisor({...options,journal:createFileJournal(join(dir,'journal'))}),/reconciliation/);
});
test('lost ownership prevents captured child effects and service errors retain exact identity',async t=>{
 const f=await fixture(t);f.lose();await assert.rejects(f.core.request('verified',request(0,'a',{type:'stop'})),/ownership gone/);assert.equal(f.core.snapshot().lostOwnership,true);
 const original=new Error('original typed persistence error');const g=await fixture(t,{exposure:{setMode:async()=>{throw original;}}});
 await assert.rejects(g.core.request('verified',request(0,'a',{type:'setExposure',mode:'local-only'})),error=>error===original);
 assert.equal(g.handles.length,1);assert.equal(g.core.snapshot().lostOwnership,true);
});
test('stop arriving during startup waits for and stops the captured child', async () => {
 let release, started = false, stopped = false, committed = null;
 const gate = new Promise(resolve => { release = resolve; });
 const handle = {onExit:()=>{}};
 const core = await createOwnerSupervisor({environmentId:'env',epoch:'epoch',
  journal:{load:async()=>null,commit:async(_,value)=>{committed=structuredClone(value);}},
  sessions:{assertVerified:async()=>{},detach:async()=>{}},exposure:{},
  children:{assertAvailable:async()=>{},assertOwnership:async()=>{},
   start:async()=>{await gate;started=true;return handle;},
   stop:async captured=>{assert.equal(captured,handle);assert.equal(started,true);stopped=true;}}});
 const start = core.start();
 let answered = false;
 const stop = core.request('verified',request(0,'during-start',{type:'stop'})).then(value=>{answered=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(answered,false);assert.equal(stopped,false);
 release();await start;await stop;
 assert.equal(stopped,true);assert.equal(core.snapshot().running,false);
 assert.equal(committed.requests[0].phase,'complete');
});
