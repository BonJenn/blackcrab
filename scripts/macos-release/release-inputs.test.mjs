import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleChecks,validateAcceptance,validateReleaseInputs} from './release-inputs.mjs';
const options={revision:'a'.repeat(40),tag:'v0.4.0',version:'0.4.0',identity:'Developer ID Application: Example (ABCDEFGHIJ)',teamId:'ABCDEFGHIJ'};
const acceptance={schema:1,state:'PASSED',sourceRevision:options.revision,checks:Object.fromEntries(lifecycleChecks.map(key=>[key,true]))};
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
