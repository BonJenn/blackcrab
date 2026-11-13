import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertOwnedRendererCopy} from './renderer-branding.mjs';

test('packaged provider descriptions and upstream installation links block a renderer build', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-renderer-branding-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  await fs.mkdir(path.join(root, 'assets'));
  const file = path.join(root, 'assets', 'shared-schema.js');
  for (const label of ['T3 Code', 'T3 Chat', 'T3 Account', 'T3 Connect', 'https://github.com/apps/t3-code-for-github/installations/new']) {
    await fs.writeFile(file, `export const schema = {description: ${JSON.stringify(label)}};`);
    await assert.rejects(assertOwnedRendererCopy(root), /shared-schema\.js/);
  }
  await fs.writeFile(file, 'export const theme = {id:"t3-chat",label:"Rose"}; export const app="Blackcrab"; export const command="t3 connect status";');
  await fs.writeFile(path.join(root, 'third-party-licenses.json'), JSON.stringify({name:'T3 Code', license:'MIT'}));
  assert.deepEqual(await assertOwnedRendererCopy(root), {filesChecked:1});
  await fs.unlink(file);
  await assert.rejects(assertOwnedRendererCopy(root), /No renderer JavaScript/);
});
