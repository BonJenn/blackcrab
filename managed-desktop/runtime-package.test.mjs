import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stageElectronRuntime} from './runtime-package.mjs';

test('staging rejects an untrusted archive without extracting or changing its destination', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-runtime-package-'));
  t.after(() => fs.rm(parent, {recursive:true, force:true}));
  const archive = path.join(parent, 'untrusted.zip');
  await fs.writeFile(archive, 'not a pinned runtime');
  for (const targetId of ['darwin-arm64', 'linux-x64', 'win32-x64']) {
    const root = path.join(parent, targetId);
    await fs.mkdir(root);
    await assert.rejects(stageElectronRuntime({archive, root, targetId}), /digest mismatch/);
    assert.deepEqual(await fs.readdir(root), []);
  }
});

test('staging cannot replace files in an occupied directory or follow a directory link', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-runtime-package-'));
  t.after(() => fs.rm(parent, {recursive:true, force:true}));
  const root = path.join(parent, 'occupied');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'keep'), 'original');
  const archive = path.join(parent, 'unused.zip');
  await assert.rejects(stageElectronRuntime({archive, root, targetId:'linux-x64'}), /empty real directory/);
  assert.equal(await fs.readFile(path.join(root, 'keep'), 'utf8'), 'original');
  const link = path.join(parent, 'link');
  await fs.symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageElectronRuntime({archive, root:link, targetId:'win32-x64'}), /empty real directory/);
});
