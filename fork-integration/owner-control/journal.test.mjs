import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, chmod, symlink, link, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileJournal} from './journal.mjs';

const record = (sequence = 1) => ({environmentId:'owned-environment', epoch:'owned-epoch',
  sequence, revision:0, requests:[]});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'blackcrab-owner-journal-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  return {dir, path:join(dir, 'journal.json')};
}
test('durable journal survives a fresh writer and captures input before async writes', async t => {
  const {path} = await fixture(t), writer = createFileJournal(path);
  assert.equal(await writer.load(), null);
  const value = record(), pending = writer.commit(0, value);
  value.sequence = 999; value.requests.push({id:'unexpected', phase:'pending'});
  await pending;
  assert.deepEqual(await createFileJournal(path).load(), record());
  await assert.rejects(writer.load(), /already initialized/);
});
test('journal refuses symlink and hardlink aliases without touching their bytes', async t => {
  const {dir, path} = await fixture(t), original = join(dir, 'original');
  const bytes = JSON.stringify(record());
  await writeFile(original, bytes, {mode:0o600});
  await symlink(original, path);
  await assert.rejects(createFileJournal(path).load());
  await rm(path); await link(original, path);
  await assert.rejects(createFileJournal(path).load(), /private owner journal/);
  assert.equal(await readFile(original, 'utf8'), bytes);
});
test('journal refuses permissive modes and oversized records', async t => {
  const {path} = await fixture(t);
  await writeFile(path, JSON.stringify(record()), {mode:0o600});
  await chmod(path, 0o644);
  await assert.rejects(createFileJournal(path).load(), /private owner journal/);
  await chmod(path, 0o600);
  await writeFile(path, Buffer.alloc(1024*1024+1));
  await assert.rejects(createFileJournal(path).load(), /private owner journal/);
});
test('journal rejects corrupted authority, revisions, duplicate IDs and extra fields', async t => {
  const {path} = await fixture(t);
  const invalid = [
    {...record(), environmentId:'bad\nidentity'}, {...record(), revision:2},
    {...record(), sequence:Number.MAX_SAFE_INTEGER+1}, {...record(), arbitraryPid:123},
    {...record(), requests:[{id:'same', phase:'pending'}, {id:'same', phase:'complete'}]},
    {...record(), requests:[{id:'id', phase:'complete', arbitraryPath:'/tmp'}]},
  ];
  for (const value of invalid) {
    await writeFile(path, JSON.stringify(value), {mode:0o600});
    await assert.rejects(createFileJournal(path).load(), /Invalid owner journal/);
  }
});
test('concurrent commits cannot both apply the same sequence', async t => {
  const {path} = await fixture(t), writer = createFileJournal(path);
  await writer.load();
  const results = await Promise.allSettled([writer.commit(0, record()), writer.commit(0, record())]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.deepEqual(await createFileJournal(path).load(), record());
});
test('failed publish disables the writer and removes only its own temporary file', async t => {
  const {dir, path} = await fixture(t), writer = createFileJournal(path);
  await writer.load();
  // An owned fixture directory at the final path forces rename failure after write/fsync.
  const {mkdir} = await import('node:fs/promises');
  await mkdir(path);
  await writeFile(join(dir, 'unrelated'), 'preserve');
  await assert.rejects(writer.commit(0, record()));
  await assert.rejects(writer.commit(0, record()), /unavailable writer/);
  assert.deepEqual((await readdir(dir)).sort(), ['journal.json', 'unrelated']);
  assert.equal(await readFile(join(dir, 'unrelated'), 'utf8'), 'preserve');
});
test('uninitialized writer and exhausted sequence refuse mutation', async t => {
  const {path} = await fixture(t);
  await assert.rejects(createFileJournal(path).commit(0, record()), /unavailable writer/);
  await writeFile(path, JSON.stringify(record(Number.MAX_SAFE_INTEGER)), {mode:0o600});
  const writer = createFileJournal(path); await writer.load();
  await assert.rejects(writer.commit(Number.MAX_SAFE_INTEGER, record(Number.MAX_SAFE_INTEGER+1)), /sequence conflict/);
  assert.equal((await createFileJournal(path).load()).sequence, Number.MAX_SAFE_INTEGER);
});
