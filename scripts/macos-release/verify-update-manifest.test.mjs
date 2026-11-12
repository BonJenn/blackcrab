import test from 'node:test';
import assert from 'node:assert/strict';
import {validateArm64Updater} from './verify-update-manifest.mjs';
test('an Apple-silicon release cannot carry stale Intel/Windows updates or a foreign signature',()=>{
 const options={tag:'v0.4.0',signature:'fixture-signature'};
 const entry={url:'https://github.com/BonJenn/blackcrab/releases/download/v0.4.0/Blackcrab_aarch64.app.tar.gz',signature:options.signature};
 const value={version:'0.4.0',platforms:{'darwin-aarch64':entry,'darwin-aarch64-app':entry}};
 validateArm64Updater(value,options);
 for(const extra of ['darwin-x86_64','windows-x86_64','linux-x86_64'])assert.throws(()=>validateArm64Updater({...value,platforms:{...value.platforms,[extra]:entry}},options));
 for(const replacement of [{...entry,signature:'wrong'},...['https://example.com/file','https://github.com/BonJenn/blackcrab/releases/download/v0.3.0/Blackcrab_aarch64.app.tar.gz',entry.url.replace('aarch64','universal')].map(url=>({...entry,url}))])assert.throws(()=>validateArm64Updater({...value,platforms:{...value.platforms,'darwin-aarch64-app':replacement}},options));
 assert.throws(()=>validateArm64Updater({...value,version:'0.3.0'},options));
});
