import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createUpdateClient,validateUpdateReply,openUpdateClient} from './update-client.mjs';
function fixture(){const stream=new EventEmitter();stream.sent=[];stream.write=(value,done)=>{stream.sent.push(JSON.parse(value));done();};stream.destroy=()=>{stream.destroyed=true;};stream.unref=()=>{};return stream;}
const reply=(overrides={})=>({accepted:true,state:{status:'available',currentVersion:'0.4.4',availableVersion:'0.4.5',downloadPercent:null,message:null,installing:false,...overrides}});
test('serializes status and mutations, accepts fragmented replies and forwards only fixed actions',async()=>{
 const stream=fixture(),client=createUpdateClient(stream);
 const check=client.request('check'),poll=client.request('status');await new Promise(setImmediate);
 assert.deepEqual(stream.sent,[{action:'check',expectedVersion:null}]);
 const bytes=JSON.stringify(reply());stream.emit('data',bytes.slice(0,20));stream.emit('data',bytes.slice(20)+'\n');assert.equal((await check).state.availableVersion,'0.4.5');await new Promise(setImmediate);
 assert.equal(stream.sent.length,2);stream.emit('data',JSON.stringify(reply())+'\n');await poll;
 await assert.rejects(()=>client.request('custom-feed'));client.close();assert.equal(stream.destroyed,true);
});
test('EOF rejects pending and queued commands without replaying an install',async()=>{
 const stream=fixture(),client=createUpdateClient(stream);
 const install=client.request('install','0.4.5'),queued=client.request('check');
 const assertions=[assert.rejects(install,/closed/),assert.rejects(queued,/closed/)];await new Promise(setImmediate);stream.emit('end');await Promise.all(assertions);assert.equal(stream.sent.length,1);
});
test('rejects invalid or oversized responses and wrong capabilities',async()=>{
 assert.throws(()=>validateUpdateReply(reply({downloadPercent:Infinity})));assert.throws(()=>validateUpdateReply(reply({status:'execute'})));
 assert.throws(()=>openUpdateClient({kind:'unavailable'}));assert.throws(()=>openUpdateClient({kind:'launcher-updates-fd-v1',fd:3}));
 const stream=fixture(),client=createUpdateClient(stream),pending=client.request('status');const rejected=assert.rejects(pending);await new Promise(setImmediate);stream.emit('data','x'.repeat(16385));await rejected;assert.equal(stream.destroyed,true);
});
