import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleChecks,ownerTestingAuthorization,validateAcceptance,validateReleaseInputs} from './release-inputs.mjs';
const options={revision:'a'.repeat(40),tag:'v0.4.0',version:'0.4.0',identity:'Developer ID Application: Example (ABCDEFGHIJ)',teamId:'ABCDEFGHIJ'};
const acceptance={schema:1,state:'PASSED',sourceRevision:options.revision,checks:Object.fromEntries(lifecycleChecks.map(key=>[key,true]))};
test('explicit owner testing is source-bound, limited to the initial release without follow-up evidence, and never records passing checks',()=>{
 const value={schema:1,state:'OWNER_TESTING_AUTHORIZED',sourceRevision:options.revision,tag:options.tag,authorization:ownerTestingAuthorization,deferredChecks:[...lifecycleChecks]};
 assert.equal(validateAcceptance(value,options.revision,options),'OWNER_TESTING_AUTHORIZED');
 for(const mutation of [{schema:2},{sourceRevision:'b'.repeat(40)},{tag:'v0.5.0'},{authorization:null},{checks:acceptance.checks},{deferredChecks:[]},{deferredChecks:lifecycleChecks.slice(1)}])assert.throws(()=>validateAcceptance({...value,...mutation},options.revision,options));
 for(const context of [{},{...options,tag:'v0.5.0',version:'0.5.0'},{...options,version:'0.3.0'}])assert.throws(()=>validateAcceptance(value,options.revision,context));
});
test('0.4.1 corrective delivery binds the published baseline and keeps lifecycle tests deferred',()=>{
 const patch={...options,tag:'v0.4.1',version:'0.4.1'};
 const value={schema:1,state:'OWNER_TESTING_AUTHORIZED',sourceRevision:patch.revision,tag:patch.tag,
  authorization:ownerTestingAuthorization,deferredChecks:[...lifecycleChecks],
  followUpOf:'v0.4.0',followUpSourceRevision:'caf57b6fab1b4391836c6635882a15a88edfac0d'};
 assert.equal(validateAcceptance(value,patch.revision,patch),'OWNER_TESTING_AUTHORIZED');
 for(const mutation of [{followUpOf:undefined},{followUpOf:'v0.3.0'},{followUpSourceRevision:undefined},{followUpSourceRevision:'b'.repeat(40)},{checks:acceptance.checks},{sourceRevision:'b'.repeat(40)},{deferredChecks:[]}])assert.throws(()=>validateAcceptance({...value,...mutation},patch.revision,patch));
 for(const version of ['0.4.2','0.5.0','0.4.1-beta.1'])assert.throws(()=>validateAcceptance({...value,tag:`v${version}`},patch.revision,{...patch,tag:`v${version}`,version}));
});
test('release preparation rejects blocked, partial or stale native lifecycle evidence',()=>{
 validateAcceptance(acceptance,options.revision);
 for(const value of [{...acceptance,state:'CAPTURE_BLOCKED'},{...acceptance,sourceRevision:'b'.repeat(40)},...lifecycleChecks.map(key=>({...acceptance,checks:{...acceptance.checks,[key]:false}}))])assert.throws(()=>validateAcceptance(value,options.revision));
});
test('arm64 release inputs bind source, version, identity, evidence and both manifests',()=>{
 const value={schema:1,target:'darwin-arm64',sourceRevision:options.revision,version:options.version,tag:options.tag,bundleIdentifier:'com.bonjenn.blackcrab',identity:options.identity,teamId:options.teamId,desktopManifestSha256:'1'.repeat(64),serviceHostManifestSha256:'2'.repeat(64),acceptanceSha256:'3'.repeat(64)};
 validateReleaseInputs(value,options);
 for(const mutation of [{target:'darwin-universal'},{sourceRevision:'b'.repeat(40)},{version:'0.3.0'},{tag:'v0.5.0'},{teamId:'OTHERTEAM1'},{bundleIdentifier:'com.example.qa'},{desktopManifestSha256:null},{serviceHostManifestSha256:null},{acceptanceSha256:null}])assert.throws(()=>validateReleaseInputs({...value,...mutation},options));
 for(const mutation of [{revision:'stage'},{tag:'v0.4.0\ninvalid'},{version:'0.4.0-beta.1'},{version:'00.4.0'}])assert.throws(()=>validateReleaseInputs(value,{...options,...mutation}));
});

test('pending lifecycle validation allows only explicit draft building and never publication',()=>{
 const draft={...options,version:'0.4.2',tag:'v0.4.2',draftBuild:true};
 const value={schema:1,state:'DRAFT_VALIDATION_PENDING',sourceRevision:draft.revision,tag:draft.tag,deferredChecks:[...lifecycleChecks]};
 assert.equal(validateAcceptance(value,draft.revision,draft),'DRAFT_VALIDATION_PENDING');
 assert.throws(()=>validateAcceptance(value,draft.revision,{...draft,draftBuild:false}));
 assert.throws(()=>validateAcceptance(value,draft.revision,{tag:draft.tag,version:draft.version}));
 for(const mutation of [{schema:2},{sourceRevision:'b'.repeat(40)},{tag:'v0.4.1'},{checks:acceptance.checks},{deferredChecks:[]},{deferredChecks:lifecycleChecks.slice(1)}])assert.throws(()=>validateAcceptance({...value,...mutation},draft.revision,draft));
 for(const mutation of [{revision:'stage'},{tag:'v0.4.3'},{version:'0.4.2-beta.1'},{draftBuild:'true'}]){const selected={...draft,...mutation};assert.throws(()=>validateAcceptance(value,selected.revision,selected));}
});
