import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReleaseProvenance,verifyManagedReleasePayloads} from './verify-payloads.mjs';

const options={identity:'Developer ID Application: Example (ABCDEFGHIJ)',teamId:'ABCDEFGHIJ'};
const valid={schema:1,kind:'developer-id',...options,notarized:true,submissionId:'01234567-89ab-cdef-0123-456789abcdef'};
test('a locally built or merely signed payload cannot enter the signed native release path',()=>{
 validateReleaseProvenance({distributionSigning:valid},options);
 for(const proof of [undefined,{...valid,notarized:false},{...valid,kind:'ad-hoc'},{...valid,teamId:'WRONGTEAM1'},{...valid,submissionId:undefined},{...valid,identity:'-'}]){
  assert.throws(()=>validateReleaseProvenance({distributionSigning:proof},options));
 }
});
test('legacy native releases without managed payloads do not require a managed signing profile',async()=>{
 await verifyManagedReleasePayloads({});
});
