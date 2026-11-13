import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBlackcrabVersion} from './release-version.mjs';

test('workspace metadata uses the same version as the Blackcrab native release', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-version-'));
 try {
  await fs.mkdir(path.join(root,'src-tauri'));
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.4.2'}));
  await fs.writeFile(path.join(root,'src-tauri/tauri.conf.json'),JSON.stringify({version:'0.4.2'}));
  assert.equal(await readBlackcrabVersion(pathToFileURL(root+'/')),'0.4.2');
  await fs.writeFile(path.join(root,'src-tauri/tauri.conf.json'),JSON.stringify({version:'0.4.1'}));
  await assert.rejects(readBlackcrabVersion(pathToFileURL(root+'/')),/must match/);
 } finally { await fs.rm(root,{recursive:true,force:true}); }
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url)));
 assert.equal(await readBlackcrabVersion(),pkg.version);
});
