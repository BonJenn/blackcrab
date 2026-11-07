import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeArtifactManifest, verifyArtifact, MANIFEST_FILE, UPSTREAM } from './artifact.mjs';

const target = { platform: 'linux', arch: 'x64' };
async function fixture(t, { windows = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-artifact-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries({ [windows ? 't3.exe' : 't3']: 'host executable fixture', 'client/index.html': '<html>client</html>', 'LICENSE.upstream': 'upstream license', 'THIRD-PARTY-NOTICES': 'notices', [windows ? 'resource-monitor/t3-resource-monitor.exe' : 'resource-monitor/t3-resource-monitor']: 'monitor fixture', 'node_modules/example/index.js': 'export default 1;' })) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  if (!windows) { await fs.chmod(path.join(root, 't3'), 0o755); await fs.chmod(path.join(root, 'resource-monitor/t3-resource-monitor'), 0o755); }
  return root;
}
async function rewrite(root, mutate) {
  const file = path.join(root, MANIFEST_FILE);
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  mutate(manifest);
  await fs.writeFile(file, JSON.stringify(manifest));
}
test('an assembled runtime remains verifiable after relocation with its pin and patch record', async t => {
  const root = await fixture(t);
  const sourcePatches = [{ id: 'file-url-decoding', sha256: 'a'.repeat(64) }];
  const written = await writeArtifactManifest(root, { ...target, sourcePatches });
  assert.deepEqual(written.upstream, UPSTREAM);
  assert.deepEqual(written.sourcePatches, sourcePatches);
  assert.equal(written.files.length, 6);
  const moved = `${root}-relocated`;
  await fs.rename(root, moved); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  assert.deepEqual(await verifyArtifact(moved, target), written);
  await assert.rejects(writeArtifactManifest(moved, target), /manifest already exists/);
});
test('startup rejects modified, missing, unexpected and nonportable file entries', async t => {
  for (const kind of ['contents', 'removed', 'extra', 'mode', 'symlink', 'directory']) {
    await t.test(kind, async t => {
      const root = await fixture(t); await writeArtifactManifest(root, target);
      const entry = path.join(root, 'node_modules/example/index.js');
      if (kind === 'contents') await fs.writeFile(entry, 'export default 2;');
      if (kind === 'removed') await fs.unlink(entry);
      if (kind === 'extra') await fs.writeFile(path.join(root, 'unexpected.js'), 'extra code');
      if (kind === 'mode') await fs.chmod(path.join(root, 't3'), 0o644);
      if (kind === 'symlink') { await fs.unlink(entry); await fs.symlink(path.join(root, 'LICENSE.upstream'), entry); }
      if (kind === 'directory') { await fs.unlink(entry); await fs.mkdir(entry); }
      await assert.rejects(verifyArtifact(root, target), /Invalid managed-host artifact/);
    });
  }
});
test('required payload and attribution cannot be omitted or replaced with symlinks', async t => {
  for (const name of ['t3', 'client/index.html', 'LICENSE.upstream', 'THIRD-PARTY-NOTICES', 'resource-monitor/t3-resource-monitor']) {
    const root = await fixture(t); await fs.unlink(path.join(root, name));
    await assert.rejects(writeArtifactManifest(root, target), /missing/);
  }
  const root = await fixture(t); await fs.chmod(path.join(root, 't3'), 0o644);
  await assert.rejects(writeArtifactManifest(root, target), /entry must be executable/);
  const linkedRoot = `${root}-link`; await fs.symlink(root, linkedRoot); t.after(() => fs.unlink(linkedRoot));
  await assert.rejects(writeArtifactManifest(linkedRoot, target), /root must be a real directory/);
});
test('manifest validation rejects altered metadata, unsafe records and incompatible targets before launch', async t => {
  for (const [name, mutate] of [
    ['upstream', m => { m.upstream.commit = 'b'.repeat(40); }],
    ['schema', m => { m.schema = 2; }],
    ['unknown field', m => { m.ignored = true; }],
    ['runtime version', m => { m.runtime.version = 'newer'; }],
    ['entry escape', m => { m.entry = '../t3'; }],
    ['path escape', m => { m.files[0].path = '../outside'; }],
    ['backslash', m => { m.files[0].path = 'client\\escape'; }],
    ['digest', m => { m.files[0].sha256 = 'not a digest'; }],
    ['duplicate file', m => { m.files.push(m.files[0]); }],
    ['unsafe bytes', m => { m.files[0].bytes = Number.MAX_SAFE_INTEGER + 1; }],
    ['patch digest', m => { m.sourcePatches = [{ id: 'patch', sha256: 'invalid' }]; }],
    ['duplicate patch', m => { m.sourcePatches = [{ id: 'patch', sha256: 'a'.repeat(64) }, { id: 'patch', sha256: 'b'.repeat(64) }]; }],
  ]) {
    await t.test(name, async t => {
      const root = await fixture(t); await writeArtifactManifest(root, target); await rewrite(root, mutate);
      await assert.rejects(verifyArtifact(root, target), /Invalid managed-host artifact/);
    });
  }
  const root = await fixture(t); await writeArtifactManifest(root, target);
  await assert.rejects(verifyArtifact(root, { ...target, arch: 'arm64' }), /incompatible/);
  await assert.rejects(verifyArtifact(root, { platform: 'unknown', arch: 'x64' }), /unsupported/);
});
test('manifest itself must be readable regular JSON and cannot be a symlink', async t => {
  const root = await fixture(t); await writeArtifactManifest(root, target);
  await fs.writeFile(path.join(root, MANIFEST_FILE), '{broken');
  await assert.rejects(verifyArtifact(root, target), /JSON could not be read/);
  await fs.unlink(path.join(root, MANIFEST_FILE));
  await fs.symlink(path.join(root, 'LICENSE.upstream'), path.join(root, MANIFEST_FILE));
  await assert.rejects(verifyArtifact(root, target), /bounded regular file/);
});
test('Windows artifacts use the executable suffix and record actual file modes', async t => {
  const root = await fixture(t, { windows: true });
  const manifest = await writeArtifactManifest(root, { platform: 'win32', arch: 'arm64' });
  assert.equal(manifest.entry, 't3.exe');
  assert.deepEqual(await verifyArtifact(root, { platform: 'win32', arch: 'arm64' }), manifest);
});
