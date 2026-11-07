import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageRustNotices } from './rust-notices.mjs';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-notices-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest_path = path.join(root, 'Cargo.toml'); await fs.writeFile(manifest_path, 'original crate attribution');
  return { root, pkg: { name: 'dispatch2', version: '0.3.1', repository: 'https://github.com/madsmtm/objc2', source: 'registry', authors: ['fixture author'], license: 'Zlib OR Apache-2.0 OR MIT', manifest_path }, output: path.join(root, 'out') };
}
test('omitted workspace licenses require exact registered package and published revision', async t => {
  const {root,pkg,output} = await fixture(t);
  await fs.writeFile(path.join(root,'.cargo_vcs_info.json'), JSON.stringify({git:{sha1:'8852b424193ca41602281b3d7540d7c8ed51e49a'}}));
  await stageRustNotices([pkg],output);
  const destination=path.join(output,'licenses/resource-monitor/dispatch2-0.3.1');
  assert.match(await fs.readFile(path.join(destination,'LICENSE.upstream.md'),'utf8'), /MIT/);
  assert.match(await fs.readFile(path.join(destination,'MIT-standard-template.txt'),'utf8'), /Permission is hereby granted/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination,'ATTRIBUTION.json'),'utf8')).authors,['fixture author']);
  await assert.rejects(stageRustNotices([{...pkg,version:'0.3.99'}],output),/lacks staged attribution/);
  await fs.writeFile(path.join(root,'.cargo_vcs_info.json'),JSON.stringify({git:{sha1:'changed'}}));
  await assert.rejects(stageRustNotices([pkg],output),/source differs/);
});
test('ordinary crate notices are preserved and unknown missing licenses fail closed',async t=>{
  const {root,pkg,output}=await fixture(t);
  const other={...pkg,name:'other'};
  await assert.rejects(stageRustNotices([other],output),/lacks staged attribution/);
  await fs.writeFile(path.join(root,'LICENSE-MIT'),'original notice');
  await stageRustNotices([other],output);
  assert.equal(await fs.readFile(path.join(output,'licenses/resource-monitor/other-0.3.1/LICENSE-MIT'),'utf8'),'original notice');
});
