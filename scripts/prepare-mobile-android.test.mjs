import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { androidBuildEnvironment, gradleReleaseArguments, vendorOutputRelocationInitScript, publicBuildConfiguration, stageGhosttyHeaders, readUploadKeyProperties, prepareMobileAndroid, GHOSTTY_REFERENCE } from './prepare-mobile-android.mjs';
import { createUploadKey } from './create-android-upload-key.mjs';

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

test('bundle task and signing init script carry no secret values', () => {
  assert.ok(gradleReleaseArguments({ task: 'bundleRelease' }).includes('bundleRelease'));
  assert.throws(() => gradleReleaseArguments({ task: 'publishRelease' }), /Unsupported Gradle task/);
  const script = vendorOutputRelocationInitScript('/tmp/out', { signingProperties: '/Users/x/.keys/upload-key.properties' });
  assert.match(script, /blackcrabUpload/);
  assert.match(script, /getProperty\('storePassword'\)/);
  assert.doesNotMatch(vendorOutputRelocationInitScript('/tmp/out'), /blackcrabUpload/);
  assert.throws(() => vendorOutputRelocationInitScript('/tmp/out', { signingProperties: '/tmp/has space/k.properties' }), /absolute without whitespace/);
});

test('an AAB cannot be built without the upload key', async () => {
  await assert.rejects(prepareMobileAndroid({ mode: 'build', artifact: 'aab' }), /upload key|Native SDK58|Native Android preparation/);
  await assert.rejects(prepareMobileAndroid({ mode: 'build', artifact: 'zip' }), /--artifact apk or --artifact aab|Native SDK58|Native Android preparation/);
});

const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/keytool') : undefined;
test('upload key creation is private, redacted and never overwrites', { skip: !keytool && 'JAVA_HOME not set' }, async () => {
  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'bc-key-')), 'signing');
  try {
    const result = await createUploadKey({ keytool, directory: dir, validityDays: 30 });
    assert.match(result.certificateSha256, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
    assert.equal((await fs.stat(result.propertiesFile)).mode & 0o077, 0);
    assert.equal((await fs.stat(result.storeFile)).mode & 0o077, 0);
    assert.equal((await fs.stat(dir)).mode & 0o077, 0);
    assert.doesNotMatch(JSON.stringify(result), /Password|storePassword/i);
    const props = await readUploadKeyProperties(result.propertiesFile);
    assert.equal(props.keyAlias, 'blackcrab-upload');
    assert.doesNotMatch(JSON.stringify(props), /assword/);
    await assert.rejects(createUploadKey({ keytool, directory: dir }), /Refusing to overwrite/);
    await fs.chmod(result.propertiesFile, 0o644);
    await assert.rejects(readUploadKeyProperties(result.propertiesFile), /readable only by its owner/);
  } finally { await fs.rm(path.dirname(dir), { recursive: true, force: true }); }
});
