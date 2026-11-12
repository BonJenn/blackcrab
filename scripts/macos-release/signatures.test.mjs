import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateSigningIdentity, validateSignatureDetails, verifySigningDelta, machoFiles} from './signatures.mjs';

const options = {identity: 'Developer ID Application: Example (ABCDEFGHIJ)', teamId: 'ABCDEFGHIJ'};
const valid = `CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1+1 location=embedded
Authority=${options.identity}
TeamIdentifier=ABCDEFGHIJ
Timestamp=Nov 12, 2026 at 12:00:00 PM`;

test('distribution requires the intended Developer ID team, a secure timestamp and hardened runtime', () => {
  validateSignatureDetails(valid, options);
  for (const value of [
    valid.replace('ABCDEFGHIJ\nTimestamp', 'WRONGTEAM1\nTimestamp'),
    valid.replace('Developer ID Application:', 'Apple Development:'),
    valid.replace('flags=0x10000(runtime)', 'flags=0x0(none)'),
    valid.replace(/Timestamp=.*/, 'Timestamp=none'),
    valid.replace(/Timestamp=.*/, 'Signature=adhoc'),
  ]) assert.throws(() => validateSignatureDetails(value, options));
  for (const identity of ['-', 'Developer ID Application: Example (WRONGTEAM1)', options.identity + '\n']) {
    assert.throws(() => validateSigningIdentity(identity, options.teamId));
  }
});

test('signing cannot conceal application, source-patch, topology, or executable-mode changes', () => {
  const file = (name, hash = 'before', executable = false) => ({path:name,type:'file',sha256:hash,bytes:10,executable});
  const before = [file('App.app/Contents/MacOS/App', 'before', true), file('App.app/Contents/Resources/main.cjs'), file('source-patches/registry.json')];
  const signed = [file(before[0].path, 'signed', true), ...before.slice(1), {path:'App.app/Contents/_CodeSignature',type:'directory'},file('App.app/Contents/_CodeSignature/CodeResources','seal')];
  assert.equal(verifySigningDelta(before, signed, [before[0].path]).length, 3);
  for (const changed of [
    signed.map(entry => entry.path.endsWith('main.cjs') ? {...entry,sha256:'changed'} : entry),
    signed.map(entry => entry.path === before[0].path ? {...entry,executable:false} : entry),
    signed.filter(entry => entry.path !== 'source-patches/registry.json'),
    [...signed, {path:'escape',type:'symlink',target:'/tmp'}],
  ]) assert.throws(() => verifySigningDelta(before, changed, [before[0].path]));
});

test('native discovery uses Mach-O headers and does not traverse links or sign text launchers', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'release-macho-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'native.node'),Buffer.from('cffaedfe01020304','hex'));
  await fs.writeFile(path.join(root,'universal'),Buffer.from('cafebabe00000002','hex'));
  await fs.writeFile(path.join(root,'launch'),'#!/bin/sh\nexit 0',{mode:0o755});
  await fs.symlink('native.node',path.join(root,'alias'));
  assert.deepEqual(await machoFiles(root),['native.node','universal']);
});
