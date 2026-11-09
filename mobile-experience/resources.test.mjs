import test from 'node:test';import assert from 'node:assert/strict';
import {RESOURCE_PATHS,validateResourceRecords} from './resources-check.mjs';
const valid=()=>RESOURCE_PATHS.map(path=>({path,sha256:'a'.repeat(64),bytes:5}));
test('native resources retain all13 exact output identities',()=>{const records=valid();assert.equal(validateResourceRecords(records).length,13);assert.equal(new Set(RESOURCE_PATHS).size,13)});
test('resource verification rejects duplicate, traversal, extra, missing, unbounded and malformed records',()=>{
 for(const mutate of [r=>r[1]=r[0],r=>r[0].path='apps/mobile/.generated/../../secret',r=>r.push(r[0]),r=>r.pop(),r=>r[0].bytes=Infinity,r=>r[0].bytes=64*1024*1024+1,r=>r[0].sha256='x'.repeat(64)]){const records=valid();mutate(records);assert.throws(()=>validateResourceRecords(records));}
});
