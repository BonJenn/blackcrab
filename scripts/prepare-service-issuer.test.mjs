import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareServiceIssuer} from './prepare-service-issuer.mjs';

async function fixture(t, signed = false) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'issuer-build-test-'));
  t.after(() => fs.rm(cwd, {recursive:true,force:true}));
  const target = 'aarch64-apple-darwin';
  const built = path.join(cwd, 'target', target, 'release/blackcrab-service-issuer');
  await fs.mkdir(path.dirname(built), {recursive:true});
  await fs.writeFile(built, 'standalone helper bytes');
  const calls = [];
  const env = {CARGO_TARGET_DIR:'target', BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256:'a'.repeat(64), BLACKCRAB_SERVICE_ISSUER_PATH:'/stale/helper',
    APPLE_SIGNING_IDENTITY:'Developer ID Application: Fixture (ABCDEFGHIJ)', APPLE_TEAM_ID:'ABCDEFGHIJ',
    APPLE_API_KEY:'key-id', APPLE_API_ISSUER:'issuer-id', APPLE_API_KEY_PATH:'/private/key', TAURI_SIGNING_PRIVATE_KEY:'private-value'};
  const run = async (command,args,options) => {
    calls.push({command,args,options});
    if (command === '/usr/bin/codesign' && args[0] === '-d') return {stderr:'Authority='+env.APPLE_SIGNING_IDENTITY+'\nTeamIdentifier=ABCDEFGHIJ\nTimestamp=fixture\nCodeDirectory v=20500 flags=0x10000(runtime)\n'};
    return {stdout:JSON.stringify({status:'Accepted'})};
  };
  return {cwd,target,built,calls,env,run,signed};
}

test('embeds a separately built standalone helper and strips stale embedding/signing inputs during compilation', async t => {
  const f = await fixture(t);
  const result = await prepareServiceIssuer(f);t.after(result.cleanup);
  assert.equal(await fs.readFile(result.path,'utf8'), 'standalone helper bytes');
  assert.equal((await fs.stat(result.path)).mode & 0o777, 0o700);
  const compile = f.calls.find(c=>c.command==='cargo');
  assert(compile.args.includes('blackcrab-service-issuer'));
  assert(compile.args.includes('--locked'));
  assert.equal(compile.options.env.BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256, f.env.BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256);
  assert.equal(compile.options.env.BLACKCRAB_SERVICE_ISSUER_PATH, undefined);
  assert.equal(compile.options.env.TAURI_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(compile.options.env.APPLE_API_KEY_PATH, undefined);
  assert(f.calls.some(c=>c.command==='/usr/bin/codesign' && c.args.includes('--strict')));
  assert(!f.calls.some(c=>c.command==='/usr/bin/xcrun'));
  await result.cleanup();await assert.rejects(fs.stat(result.path),{code:'ENOENT'});
});

test('signed delivery requires the expected Developer ID and accepted standalone notarization', async t => {
  const f = await fixture(t,true);const result = await prepareServiceIssuer(f);t.after(result.cleanup);
  assert(f.calls.some(c=>c.command==='/usr/bin/codesign' && c.args.includes('--timestamp')));
  assert(f.calls.some(c=>c.command==='/usr/bin/xcrun' && c.args.includes('--key')));
  await assert.rejects(prepareServiceIssuer({...f,run:async(...args)=>args[0]==='/usr/bin/xcrun'?{stdout:'{"status":"Invalid"}'}:f.run(...args)}),/not accepted/);
});

test('tool errors cannot disclose notarization credentials or select the previous app executable', async t => {
  const f = await fixture(t,true);
  await assert.rejects(prepareServiceIssuer({...f,run:async(command,args,options)=> {
    if(command==='/usr/bin/xcrun') throw Error('private-value /private/key');
    return f.run(command,args,options);
  }}), error=>error.message==='Standalone service helper notarization failed');
  assert(!f.calls.some(c=>c.args.some(a=>a.includes('Blackcrab.app'))));
});

test('Linux embeds the native ELF helper without invoking Apple signing or notarization', async t => {
  const f = await fixture(t, true);
  f.target = 'x86_64-unknown-linux-gnu';
  const built = path.join(f.cwd, 'target', f.target, 'release/blackcrab-service-issuer');
  await fs.mkdir(path.dirname(built), {recursive:true});
  const elf = Buffer.alloc(64);
  Buffer.from([0x7f,0x45,0x4c,0x46,2,1,1]).copy(elf);
  elf.writeUInt16LE(3,16); elf.writeUInt16LE(62,18);
  await fs.writeFile(built, elf);
  const result = await prepareServiceIssuer(f); t.after(result.cleanup);
  assert((await fs.readFile(result.path)).equals(elf));
  assert.equal((await fs.stat(path.dirname(result.path))).mode & 0o777, 0o700);
  assert.equal(f.calls.some(c=>c.command.startsWith('/usr/bin/')),false);
  assert.equal(result.notarizationSubmissionId,undefined);
  // A successful compiler exit cannot substitute another architecture/object.
  for (const [offset, value] of [[4,1],[5,2],[16,1],[18,183]]) {
    const wrong=Buffer.from(elf); wrong[offset]=value; await fs.writeFile(built,wrong);
    await assert.rejects(prepareServiceIssuer(f), /ELF64 x86-64/);
  }
  await fs.writeFile(built, 'short');
  await assert.rejects(prepareServiceIssuer(f), /ELF64 x86-64/);
  const before=f.calls.length;
  await assert.rejects(prepareServiceIssuer({...f,target:'x86_64-pc-windows-msvc'}), /darwin-arm64 or linux-x64/);
  assert.equal(f.calls.length,before);
});
