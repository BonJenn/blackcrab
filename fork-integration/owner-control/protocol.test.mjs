import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOwnerRequest, assertOwnerFence } from './protocol.mjs';
const message = (operation = {type:'status'}) => ({protocol:1,environmentId:'env-1',epoch:'epoch-1',revision:3,requestId:'req-1',operation});
const state = () => ({environmentId:'env-1',epoch:'epoch-1',revision:3,completedRequestIds:new Set()});
test('accepts exact exposure and lifecycle proposal inputs; clones caller data', () => {
  for (const operation of [{type:'status'},{type:'restart'},{type:'stop'},{type:'setExposure',mode:'local-only'},
    {type:'setExposure',mode:'network-accessible'},{type:'setTailscaleServe',enabled:true,port:443},
    {type:'setTailscaleServe',enabled:false}]) {
    const input=message(operation); const output=assertOwnerFence(input,state());
    assert.deepEqual(output,input); assert.notEqual(output.operation,input.operation);
  }
});
test('rejects ambient authority, unknown fields and unsupported update commands', () => {
  for (const extra of ['pid','secret','path','command','bootstrapToken']) assert.throws(()=>validateOwnerRequest({...message(),[extra]:1}));
  for (const operation of [{type:'upgrade',url:'https://evil.test'}, {type:'stop',pid:42},
    {type:'setExposure',mode:'all'}, {type:'setTailscaleServe',enabled:1},
    {type:'setTailscaleServe',enabled:true,port:0},{type:'setTailscaleServe',enabled:true,port:65536},
    {type:'setTailscaleServe',enabled:true,port:1.5}]) assert.throws(()=>validateOwnerRequest(message(operation)));
});
test('rejects stale incarnation, environment, revision and replay before effects', () => {
  for (const update of [{epoch:'old'},{environmentId:'other'},{revision:2},{revision:4},{revision:NaN},{protocol:2},{requestId:'../socket'}])
    assert.throws(()=>assertOwnerFence({...message(),...update},state()));
  const current=state(); current.completedRequestIds.add('req-1'); assert.throws(()=>assertOwnerFence(message(),current));
});
test('rejects inherited/non-object payloads and does not mutate the owner state', () => {
  for (const input of [null,[],Object.create(message())]) assert.throws(()=>validateOwnerRequest(input));
  const current=state(); assertOwnerFence(message(),current); assert.equal(current.revision,3); assert.equal(current.completedRequestIds.size,0);
});
