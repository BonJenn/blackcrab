import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { androidBuildEnvironment, gradleReleaseArguments, vendorOutputRelocationInitScript, publicBuildConfiguration, stageGhosttyHeaders, GHOSTTY_REFERENCE } from './prepare-mobile-android.mjs';

const blobSha = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
const D = GHOSTTY_REFERENCE.directory;
const files = { [`${D}/include/ghostty/vt.h`]: '#pragma once\n', [`${D}/VERSION`]: 'abc\n' };
const fakeFetch = (overrides = {}) => ({
  fetchJson: async () => ({ truncated: false, tree: [...Object.entries(files).map(([p, c]) => ({ type: 'blob', path: p, sha: blobSha(c) })), { type: 'blob', path: 'README.md', sha: 'x' }] }),
  fetchRaw: async route => Buffer.from(overrides.content ?? files[decodeURIComponent(route.split('/contents/')[1].split('?')[0])]),
});

test('headers are staged only at the requested external destination after blob verification', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-android-test-'));
  try {
    const result = await stageGhosttyHeaders(repo, fakeFetch());
    assert.equal(result.files, 2);
    assert.equal(result.includeDirectory, path.join(repo, 'include'));
    assert.equal(await fs.readFile(path.join(repo, 'VERSION'), 'utf8'), 'abc\n');
    assert.equal(await fs.readFile(path.join(repo, 'include/ghostty/vt.h'), 'utf8'), '#pragma once\n');
    await assert.rejects(fs.access(path.join(repo, 'README.md')));
  } finally { await fs.rm(repo, { recursive: true, force: true }); }
});

test('tampered header content is rejected', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-android-test-'));
  try { await assert.rejects(stageGhosttyHeaders(repo, fakeFetch({ content: 'tampered' })), /blob verification/); }
  finally { await fs.rm(repo, { recursive: true, force: true }); }
});

test('missing headers or unsafe paths fail closed', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-android-test-'));
  try {
    await assert.rejects(stageGhosttyHeaders(repo, { fetchJson: async () => ({ tree: [] }), fetchRaw: async () => Buffer.alloc(0) }), /no libghostty-vt headers/);
    await assert.rejects(stageGhosttyHeaders(repo, { fetchJson: async () => ({ tree: [{ type: 'blob', path: `${D}/include/ghostty/vt.h`, sha: 'x' }, { type: 'blob', path: `${D}/include/../../evil`, sha: 'x' }] }), fetchRaw: async () => Buffer.alloc(0) }), /Unsafe|verification/);
  } finally { await fs.rm(repo, { recursive: true, force: true }); }
});

test('gradle arguments reject injection and default to one ABI', () => {
  assert.ok(gradleReleaseArguments().includes('-PreactNativeArchitectures=arm64-v8a'));
  assert.throws(() => gradleReleaseArguments({ abis: 'arm64-v8a;rm -rf' }), /Unsupported ABI/);
});

test('build environment is isolated and keeps devDependencies installable', () => {
  const env = androidBuildEnvironment('/stage', { javaHome: '/jdk', androidHome: '/sdk' }, { original: { PATH: '/usr/bin', SECRET_TOKEN: 'x' } });
  assert.equal(env.NODE_ENV, undefined);
  assert.equal(env.SECRET_TOKEN, undefined);
  assert.equal(env.ANDROID_HOME, '/sdk');
  assert.ok(env.PATH.startsWith('/jdk/bin'));
});

test('vendor output relocation targets only vendored projects and rejects unsafe roots', () => {
  const script = vendorOutputRelocationInitScript('/private/tmp/stage/external/out');
  assert.match(script, /contains\('\/vendor\/t3-mobile\/'\)/);
  assert.match(script, /buildStagingDirectory/);
  assert.match(script, /unix:nlink/);
  assert.match(script, /startsWith\('buildCMake'\)/);
  for (const bad of ['relative/out', '/has space/out', "/quote'/out", '/dollar$/out']) assert.throws(() => vendorOutputRelocationInitScript(bad), /absolute/);
  assert.match(vendorOutputRelocationInitScript('/o', { includeDirectory: '/inc/dir' }), /cppFlags\('-I\/inc\/dir'\)/);
  assert.throws(() => vendorOutputRelocationInitScript('/o', { includeDirectory: 'rel' }), /absolute/);
  assert.deepEqual(gradleReleaseArguments({ initScript: '/x.gradle' }).slice(0, 3), ['--init-script', '/x.gradle', 'assembleRelease']);
});

test('only validated public Blackcrab values are forwarded to the build', () => {
  const config = publicBuildConfiguration({ easProjectId: '00000000-0000-4000-8000-000000000000', updateChannel: 'preview', updatesEnabled: '0' });
  assert.deepEqual(Object.keys(config).sort(), ['BLACKCRAB_EAS_PROJECT_ID', 'BLACKCRAB_MOBILE_UPDATES_ENABLED', 'BLACKCRAB_UPDATE_CHANNEL']);
  assert.throws(() => publicBuildConfiguration({ updateChannel: 'a b; rm' }), /Unsupported value/);
  const env = androidBuildEnvironment('/stage', { javaHome: '/jdk', androidHome: '/sdk' }, { original: { PATH: '/usr/bin', EXPO_TOKEN: 'secret' }, publicConfig: config });
  assert.equal(env.BLACKCRAB_UPDATE_CHANNEL, 'preview');
  assert.equal(env.EXPO_TOKEN, undefined);
});
