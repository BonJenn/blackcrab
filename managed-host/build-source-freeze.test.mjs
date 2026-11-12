import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serviceProfilePlan} from './service-profile.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const repository=new URL('../',import.meta.url);
const freeze=JSON.parse(await fs.readFile(new URL('./build-controller-source-freeze.json',import.meta.url),'utf8'));
test('committed producer code matches the recorded real-build inputs',async()=>{
 assert.equal(Object.keys(freeze.files).length,17);
 for(const [name,digest] of Object.entries(freeze.files))assert.equal(sha(await fs.readFile(new URL(name,repository))),digest,name);
});
test('committed raw service evidence and normalized graph match the real-build input freeze',async()=>{
 const plan=await serviceProfilePlan();
 assert.deepEqual(Object.fromEntries([...plan.data].map(([name,bytes])=>[name,sha(bytes)])),freeze.rawSourceData);
 assert.equal(sha(JSON.stringify(plan.records)),freeze.recordGraphSha256);
});
