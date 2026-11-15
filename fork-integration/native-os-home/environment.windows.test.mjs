// The Windows form of the managed environment contract. It runs natively on
// Windows. Elsewhere the module is loaded with the platform reported as win32
// so the variable-name and directory rules are still exercised; path syntax
// then stays that of the real platform. No dependencies beyond Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const native = process.platform === 'win32';
async function load(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-windows-environment-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modules = path.join(root, 'modules');
  await fs.mkdir(modules);
  await fs.copyFile(path.join(here, 'payload/environment.mjs'), path.join(modules, 'environment.mjs'));
  await fs.copyFile(path.join(here, '../../managed-desktop/descriptor.mjs'), path.join(modules, 'descriptor.mjs'));
  const profile = path.join(root, 'profile');
  await fs.mkdir(profile);
  const actual = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!native) Object.defineProperty(process, 'platform', { ...actual, value: 'win32' });
  try {
    return { profile, policy: await import(pathToFileURL(path.join(modules, 'environment.mjs')).href) };
  } finally {
    if (!native) Object.defineProperty(process, 'platform', actual);
  }
}
const home = native ? 'C:\\Users\\account' : '/os/account/home';
const authority = profile => ({
  USERPROFILE: home, TEMP: path.join(profile, 'tmp'), TMP: path.join(profile, 'tmp'), T3CODE_HOME: profile,
  T3CODE_DISABLE_AUTO_UPDATE: 'true', T3CODE_DESKTOP_APP_USER_MODEL_ID: 'com.blackcrab.desktop.managed', OTEL_SDK_DISABLED: 'true',
});

test('Windows authority is USERPROFILE, TEMP and TMP, and both temporary variables must be the profile', async t => {
  const { profile, policy } = await load(t);
  const base = authority(profile);
  const owned = policy.captureManagedShellAuthority(base);
  assert.deepEqual({ ...owned }, base);
  assert.ok(!Object.hasOwn(owned, 'HOME') && !Object.hasOwn(owned, 'TMPDIR'));
  for (const key of ['TEMP', 'TMP']) {
    assert.throws(() => policy.captureManagedShellAuthority({ ...base, [key]: path.join(profile, 'elsewhere') }), /authority differs/);
  }
  const { USERPROFILE: _, ...homeless } = base;
  assert.throws(() => policy.captureManagedShellAuthority(homeless), /authority is unavailable/);
  assert.throws(() => policy.captureManagedShellAuthority({ ...base, USERPROFILE: 'relative' }), /authority is unavailable/);
  // The Unix names alone are not an authority here.
  assert.throws(() => policy.captureManagedShellAuthority({ HOME: home, TMPDIR: path.join(profile, 'tmp'), T3CODE_HOME: profile,
    T3CODE_DISABLE_AUTO_UPDATE: 'true', T3CODE_DESKTOP_APP_USER_MODEL_ID: 'com.blackcrab.desktop.managed', OTEL_SDK_DISABLED: 'true' }), /authority is unavailable/);
});

test('variable names are matched without regard to case and conflicting spellings are refused', async t => {
  const { profile, policy } = await load(t);
  const base = authority(profile);
  const { TEMP: temp, USERPROFILE: account, ...rest } = base;
  assert.deepEqual({ ...policy.captureManagedShellAuthority({ ...rest, Temp: temp, UserProfile: account }) }, base);
  assert.throws(() => policy.captureManagedShellAuthority({ ...base, Temp: path.join(profile, 'other') }), /authority differs|authority is unavailable/);
  const candidate = { Temp: 'C:\\foreign', tmp: 'C:\\foreign', UserProfile: 'C:\\foreign', t3code_home: 'C:\\foreign',
    T3Code_Cloud_Url: 'https://foreign', vite_clerk_publishable_key: 'foreign', Otel_Exporter: 'foreign', Github_App_Client_Id: 'foreign',
    Path: 'C:\\tools', SystemRoot: 'C:\\Windows', GH_TOKEN: 'explicit-provider-token' };
  const filtered = policy.filterManagedShellEnvironment(base, candidate);
  assert.deepEqual(filtered, { Path: 'C:\\tools', SystemRoot: 'C:\\Windows', GH_TOKEN: 'explicit-provider-token', ...base });
  const env = { ...candidate };
  policy.restoreManagedShellAuthority(env, base);
  assert.deepEqual(env, filtered);
  const before = { ...candidate };
  assert.throws(() => policy.restoreManagedShellAuthority(candidate, { ...base, T3CODE_HOME: path.join(profile, 'foreign') }), /authority differs/);
  assert.deepEqual(candidate, before);
});

test('storage is created as real directories under the profile and a linked child is refused', async t => {
  const { profile, policy } = await load(t);
  const calls = {};
  const app = { name: '', setPath: (key, value) => { calls[key] = value; }, setAppLogsPath: value => { calls.logs = value; } };
  const env = { USERPROFILE: home, TEMP: path.join(profile, 'tmp'), TMP: path.join(profile, 'tmp'), T3CODE_HOME: 'C:\\foreign', Vite_Cloud_Url: 'foreign' };
  const result = policy.configureManagedEnvironment(app, profile, env);
  assert.equal(env.T3CODE_HOME, profile);
  assert.equal(env.USERPROFILE, home);
  assert.ok(!Object.hasOwn(env, 'Vite_Cloud_Url'));
  assert.equal(calls.userData, path.join(profile, 'app-data', 'blackcrab-managed-v1'));
  assert.equal(calls.temp, path.join(profile, 'tmp'));
  assert.equal(result.sessionData, calls.userData);
  for (const value of Object.values(calls)) {
    assert.ok(value.startsWith(profile + path.sep));
    assert.ok((await fs.lstat(value)).isDirectory());
  }
  // Existing data in an existing directory is kept.
  await fs.writeFile(path.join(calls.userData, 'kept'), 'kept');
  policy.configureManagedEnvironment(app, profile, { ...env, T3CODE_HOME: profile });
  assert.equal(await fs.readFile(path.join(calls.userData, 'kept'), 'utf8'), 'kept');

  const second = path.join(path.dirname(profile), 'second');
  const outside = path.join(path.dirname(profile), 'outside');
  await fs.mkdir(second); await fs.mkdir(outside);
  // A junction needs no privilege on Windows; lstat reports it as a link.
  await fs.symlink(outside, path.join(second, 'app-data'), native ? 'junction' : 'dir');
  assert.throws(() => policy.configureManagedEnvironment({ setPath() {}, setAppLogsPath() {} }, second,
    { USERPROFILE: home, TEMP: path.join(second, 'tmp'), TMP: path.join(second, 'tmp') }), /not private/);
  assert.deepEqual(await fs.readdir(outside), []);
});
