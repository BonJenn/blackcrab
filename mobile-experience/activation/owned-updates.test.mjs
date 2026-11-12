import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import updates from './adapters/owned-update-config.cjs';
import cloud from './adapters/owned-cloud-config.cjs';
import { applyRecordedAdapter } from './generator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '../../apps/mobile');
const projectId = '11111111-2222-4333-8444-555555555555';
const env = { BLACKCRAB_EAS_PROJECT_ID: projectId, BLACKCRAB_UPDATE_CHANNEL: 'production' };
const inherited = {
  name: 'Blackcrab Remote', slug: 'blackcrab-remote', version: '1.2.3',
  runtimeVersion: 'foreign-root',
  ios: { bundleIdentifier: 'dev.blackcrab.remote', runtimeVersion: 'foreign-ios' },
  android: { package: 'dev.blackcrab.remote', runtimeVersion: 'foreign-android' },
  updates: { enabled: true, url: 'https://foreign.example/update', requestHeaders: { Authorization: 'private' },
    codeSigningCertificate: '/private/foreign-certificate', disableAntiBrickingMeasures: true },
  extra: { ownValue: 7, eas: { projectId: 'foreign' }, blackcrabUpdates: { projectId: 'foreign' } },
};

test('unconfigured and inherited builds cannot opt into an update service', () => {
  for (const environment of [{}, { T3CODE_MOBILE_UPDATES_ENABLED: '1', EAS_PROJECT_ID: projectId },
    { BLACKCRAB_MOBILE_UPDATES_ENABLED: '0' }]) {
    assert.equal(updates.updateConfigFromEnvironment(environment), null);
    const configured = updates.configureOwnedUpdates(inherited, environment);
    assert.deepEqual(configured.updates, { enabled: false, checkAutomatically: 'NEVER' });
    assert.equal(configured.extra.eas, undefined);
    assert.equal(configured.extra.blackcrabUpdates, undefined);
    assert.equal(configured.extra.ownValue, 7);
  }
});

test('configured releases use the owned project/channel and native fingerprints', () => {
  const before = structuredClone(inherited);
  for (const channel of ['production', 'preview', 'release-candidate']) {
    const configured = updates.configureOwnedUpdates(inherited, { ...env, BLACKCRAB_UPDATE_CHANNEL: channel });
    assert.deepEqual(configured.updates, { enabled: true, url: 'https://u.expo.dev/' + projectId,
      requestHeaders: { 'expo-channel-name': channel }, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 });
    assert.deepEqual(configured.runtimeVersion, { policy: 'fingerprint' });
    assert.equal(configured.ios.runtimeVersion, undefined);
    assert.equal(configured.android.runtimeVersion, undefined);
    assert.equal(configured.ios.bundleIdentifier, inherited.ios.bundleIdentifier);
    assert.deepEqual(configured.extra.eas, { projectId });
    assert.equal(configured.extra.managedNativeFeatures.automaticUpdatesEnabled, true);
  }
  const development = updates.configureOwnedUpdates({}, { ...env, BLACKCRAB_UPDATE_CHANNEL: 'development' });
  assert.deepEqual(development.runtimeVersion, { policy: 'appVersion' });
  assert.deepEqual(inherited, before);
});

test('disabled owned builds retain their project identity with native updates disabled', () => {
  const configured = updates.configureOwnedUpdates(inherited, { ...env, BLACKCRAB_MOBILE_UPDATES_ENABLED: '0' });
  assert.equal(configured.updates.enabled, false);
  assert.equal(configured.updates.checkAutomatically, 'NEVER');
  assert.deepEqual(configured.extra.eas, { projectId });
  assert.equal(configured.extra.managedNativeFeatures.automaticUpdatesEnabled, false);
});

test('partial or malformed update configuration fails without printing supplied values', () => {
  for (const environment of [{ BLACKCRAB_EAS_PROJECT_ID: projectId }, { BLACKCRAB_UPDATE_CHANNEL: 'production' },
    { BLACKCRAB_MOBILE_UPDATES_ENABLED: '1' }, { ...env, BLACKCRAB_EAS_PROJECT_ID: 'private-not-a-uuid' },
    { ...env, BLACKCRAB_EAS_PROJECT_ID: 'd763fcb8-d37c-41ea-a773-b54a0ab4a454' },
    { ...env, BLACKCRAB_UPDATE_CHANNEL: 'private\r\nHeader' }, { ...env, BLACKCRAB_UPDATE_CHANNEL: 'private/path' },
    { ...env, BLACKCRAB_UPDATE_CHANNEL: 'x'.repeat(65) }, { ...env, BLACKCRAB_MOBILE_UPDATES_ENABLED: 'private' }]) {
    assert.throws(() => updates.configureOwnedUpdates(inherited, environment), error =>
      error.message.includes('BLACKCRAB_') && !error.message.includes('private') && !error.message.includes('d763fcb8'));
  }
  assert.equal(updates.updateConfigFromEnvironment({ ...env, BLACKCRAB_EAS_PROJECT_ID: '  '+projectId.toUpperCase()+'  ' }).projectId, projectId);
});

test('the owned EAS profiles cannot accidentally select another update channel', () => {
  const profiles = JSON.parse(fs.readFileSync(path.join(mobile, 'eas.json'))).build;
  for (const [name, profile] of Object.entries(profiles)) {
    const channel = profile.channel ?? profiles[profile.extends].channel;
    assert.equal(profile.environment ?? profiles[profile.extends].environment, channel);
    assert.equal(updates.updateConfigFromEnvironment({ ...env, EAS_BUILD_PROFILE: name, BLACKCRAB_UPDATE_CHANNEL: channel }).channel, channel);
    assert.throws(() => updates.updateConfigFromEnvironment({ ...env, EAS_BUILD_PROFILE: name, BLACKCRAB_UPDATE_CHANNEL: channel+'-wrong' }), /must match/);
  }
});

test('the actual Expo entry applies update configuration before source generation', () => {
  function load(environment) {
    const module = { exports: {} }, calls = [];
    vm.runInNewContext(fs.readFileSync(path.join(mobile, 'app.config.js'), 'utf8'), {
      module, __dirname: mobile, process: { env: environment, execPath: '/node' },
      require: name => {
        if (name === 'node:path') return path;
        if (name === 'node:child_process') return { execFileSync: (...args) => calls.push(args) };
        if (name.endsWith('/owned-cloud-config.cjs')) return cloud;
        if (name.endsWith('/owned-update-config.cjs')) return updates;
        throw Error('Unexpected config import');
      },
    });
    return { run: module.exports, calls };
  }
  const ready = load({ ...env });
  assert.equal(ready.run({ config: inherited }).updates.url, 'https://u.expo.dev/'+projectId);
  assert.equal(ready.calls.length, 1);
  const invalid = load({ BLACKCRAB_EAS_PROJECT_ID: 'private' });
  assert.throws(() => invalid.run({ config: inherited }), /BLACKCRAB_/);
  assert.equal(invalid.calls.length, 0);
});

test('the installed Expo native plugin writes the owned URL, channel and fingerprint policy', async () => {
  const require = createRequire(path.join(mobile, 'package.json'));
  const { IOSConfig } = require('expo/config-plugins');
  const version = require('expo-updates/package.json').version;
  const oldPlist = { EXUpdatesURL: 'https://foreign.example', EXUpdatesRequestHeaders: { Authorization: 'private' },
    EXUpdatesCodeSigningCertificate: 'foreign', EXUpdatesCodeSigningMetadata: { keyid: 'foreign' }, EXUpdatesDisableAntiBrickingMeasures: true };
  for (const environment of [{}, env, { ...env, BLACKCRAB_MOBILE_UPDATES_ENABLED: '0' }]) {
    const configured = updates.configureOwnedUpdates(inherited, environment);
    const plist = await IOSConfig.Updates.setUpdatesConfigAsync(mobile, configured, oldPlist, version);
    assert.equal(plist.EXUpdatesEnabled, environment === env);
    assert.equal(plist.EXUpdatesURL, environment.BLACKCRAB_EAS_PROJECT_ID ? 'https://u.expo.dev/'+projectId : undefined);
    assert.deepEqual(plist.EXUpdatesRequestHeaders, environment.BLACKCRAB_EAS_PROJECT_ID ? { 'expo-channel-name': 'production' } : undefined);
    if (environment.BLACKCRAB_EAS_PROJECT_ID) assert.equal(plist.EXUpdatesRuntimeVersion, 'file:fingerprint');
    assert.equal(plist.EXUpdatesCodeSigningCertificate, undefined);
    assert.equal(plist.EXUpdatesCodeSigningMetadata, undefined);
    assert.equal(plist.EXUpdatesDisableAntiBrickingMeasures, undefined);
  }
});

test('generated full App retains the original update lifecycle import and initializer', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(here, 'registry.json')));
  const record = registry.adapters.find(value => value.path === 'src/App.tsx');
  const original = fs.readFileSync(path.join(here, '../../vendor/t3-mobile/apps/mobile', record.path));
  const generated = applyRecordedAdapter(original, record).toString();
  assert.match(generated, /import \{ installAppUpdateChecks \} from "\.\/features\/updates\/app-updates"/);
  assert.match(generated, /  installAppUpdateChecks\(\),/);
  assert.equal(registry.adapters.some(value => value.path === 'src/features/updates/app-updates.ts'), false);
});
