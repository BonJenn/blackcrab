import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedSubmission,validateNotaryCredentials} from './notarize-payloads.mjs';

test('a queued, rejected, or malformed Apple response cannot certify a release',()=>{
 const id='01234567-89ab-cdef-0123-456789abcdef';
 assert.deepEqual(acceptedSubmission({id,status:'Accepted',message:'done'}),{id,status:'Accepted'});
 for(const value of [{id,status:'In Progress'},{id,status:'Invalid'},{id,status:'Rejected'},{status:'Accepted'},{id:'not-an-id',status:'Accepted'},null])assert.throws(()=>acceptedSubmission(value));
});
test('notarization accepts a private file reference, never a key value or implicit account',()=>{
 const valid={key:'/private/signing/AuthKey.p8',keyId:'ABCDEFGHIJ',issuer:'01234567-89ab-cdef-0123-456789abcdef'};
 validateNotaryCredentials(valid);
 for(const delta of [{key:'-----BEGIN PRIVATE KEY-----'},{key:'relative.p8'},{keyId:undefined},{issuer:undefined}])assert.throws(()=>validateNotaryCredentials({...valid,...delta}));
});
