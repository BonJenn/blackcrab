import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyRecordedAdapter } from './generator.mjs';
import cloud from './adapters/owned-cloud-config.cjs';
const require = createRequire(import.meta.url), ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(here, 'registry.json')));
const env = { BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture_only', BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay', BLACKCRAB_RELAY_URL: 'https://relay.example.test/' };
const valid = cloud.cloudConfigFromEnvironment(env);
const disabled = config => assert.equal(config.clerk.publishableKey, null);
function evaluate(source, stubs, jsx = false) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: jsx ? 'input.tsx' : 'input.ts' }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (!(name in stubs)) throw Error('Unexpected dependency: ' + name);
    return stubs[name];
  }, URL });
  return module.exports;
}
function publicConfig(extra) {
  const record = registry.adapters.find(value => value.path === 'src/features/cloud/publicConfig.ts');
  const source = fs.readFileSync(path.join(here, '../../vendor/t3-mobile/apps/mobile', record.path));
  const output = applyRecordedAdapter(source, record).toString();
  return evaluate(output, {
    'expo-constants': { __esModule: true, default: { expoConfig: { extra } } },
    '@t3tools/shared/relayAuth': { relayClerkTokenOptions: template => ({ template }) },
    '../../../../../owned-cloud-config.cjs': cloud,
    'effect/Schema': { TaggedError: () => () => class extends Error { constructor(fields) { super(); Object.assign(this, fields); } }, Literal: value => value },
  });
}
function provider(config) {
  const calls = [], instance = {}, cache = {}, source = fs.readFileSync(path.join(here, 'adapters/CloudAuthProvider.tsx'), 'utf8');
  const api = evaluate(source, {
    '@clerk/expo': { ClerkProvider: 'clerk-provider', getClerkInstance: options => { calls.push(['instance', options.publishableKey]); return instance; } },
    '@clerk/expo/token-cache': { tokenCache: cache },
    './cloudAccountService': { cloudAccountService: { attach: value => { calls.push(['attach', value]); } } },
    './publicConfig': config,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  }, true);
  return { ...api, calls, instance, cache };
}

test('only explicit complete Blackcrab public build variables configure the service', () => {
  assert.equal(cloud.cloudConfigFromEnvironment({}), null);
  assert.equal(cloud.cloudConfigFromEnvironment({ T3CODE_CLERK_PUBLISHABLE_KEY: env.BLACKCRAB_CLERK_PUBLISHABLE_KEY, T3CODE_RELAY_URL: env.BLACKCRAB_RELAY_URL }), null);
  assert.deepEqual(valid, { version: 1, publishableKey: env.BLACKCRAB_CLERK_PUBLISHABLE_KEY, jwtTemplate: 'blackcrab-relay', relayUrl: 'https://relay.example.test' });
  for (const key of Object.keys(env)) {
    const partial = { ...env }; delete partial[key];
    assert.throws(() => cloud.cloudConfigFromEnvironment(partial), error => error.message.includes(key) && !error.message.includes('fixture_only'));
  }
});
for (const url of ['http://relay.example.test', 'wss://relay.example.test', 'https://user:private@relay.example.test', 'https://relay.example.test/path', 'https://relay.example.test/?token=private', 'https://relay.example.test/#private', 'bad-private-value']) {
  test('rejects an invalid relay origin without echoing its value: ' + url.split(':')[0], () => {
    assert.throws(() => cloud.cloudConfigFromEnvironment({ ...env, BLACKCRAB_RELAY_URL: url }), error => error.message.includes('BLACKCRAB_RELAY_URL') && !error.message.includes('private'));
    assert.equal(cloud.resolveOwnedCloudConfig({ blackcrabCloud: { ...valid, relayUrl: url } }), null);
  });
}
test('secret keys and invalid templates cannot activate the public build', () => {
  assert.throws(() => cloud.cloudConfigFromEnvironment({ ...env, BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'sk_live_private' }), error => !error.message.includes('private'));
  assert.throws(() => cloud.cloudConfigFromEnvironment({ ...env, BLACKCRAB_CLERK_JWT_TEMPLATE: 'bad\nprivate' }), error => !error.message.includes('private'));
});
test('build output discards injected cloud extras and preserves unrelated owned configuration', () => {
  const input = { name: 'Blackcrab Remote', extra: { eas: { projectId: 'owned-project' }, managedNativeFeatures: { nativeExtensionsRequireSigning: true }, blackcrabCloud: valid } };
  const original = JSON.stringify(input), off = cloud.configureOwnedCloud(input, {}), on = cloud.configureOwnedCloud(input, env);
  assert.equal(off.extra.blackcrabCloud, undefined); assert.equal(off.extra.managedNativeFeatures.cloudConfigured, false);
  assert.deepEqual(on.extra.blackcrabCloud, valid); assert.equal(on.extra.managedNativeFeatures.cloudConfigured, true);
  assert.equal(on.extra.managedNativeFeatures.nativeExtensionsRequireSigning, true);
  assert.equal(on.plugins.length, 1); assert.equal(on.plugins[0][0], '@clerk/expo');
  assert.equal(on.plugins[0][1].keychainService, 'dev.blackcrab.remote.clerk'); assert.equal(on.plugins[0][1].appleSignIn, true);
  assert.equal(off.plugins.length, 0);
  assert.equal(on.extra.eas.projectId, 'owned-project'); assert.equal(JSON.stringify(input), original);
});
test('actual generated public config reads only the owned namespace and maps the relay JWT template', () => {
  const foreign = { clerk: { publishableKey: env.BLACKCRAB_CLERK_PUBLISHABLE_KEY, jwtTemplate: 'upstream' }, relay: { url: env.BLACKCRAB_RELAY_URL }, observability: { tracesToken: 'foreign-secret' } };
  disabled(publicConfig(foreign).resolveCloudPublicConfig());
  const api = publicConfig({ ...foreign, blackcrabCloud: valid });
  assert.equal(api.hasCloudPublicConfig(), true);
  assert.equal(api.resolveCloudPublicConfig().relay.url, 'https://relay.example.test');
  assert.equal(api.resolveRelayClerkTokenOptions().template, 'blackcrab-relay');
  assert.equal(api.resolveCloudPublicConfig().observability.tracesToken, null);
  for (const input of [null, {}, { ...valid, version: 2 }, { ...valid, jwtTemplate: '' }, { ...valid, publishableKey: 'sk_private' }]) {
    const rejected = publicConfig({ blackcrabCloud: input });
    assert.equal(rejected.hasCloudPublicConfig(), false); disabled(rejected.resolveCloudPublicConfig());
  }
  assert.throws(() => publicConfig({}).resolveRelayClerkTokenOptions(), /BLACKCRAB_CLERK_JWT_TEMPLATE/);
});
test('configured native provider attaches the original account service once and renders Clerk with its cache', () => {
  const f = provider(publicConfig({ blackcrabCloud: valid }));
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0][1], env.BLACKCRAB_CLERK_PUBLISHABLE_KEY); assert.equal(f.calls[1][1], f.instance);
  const children = {}, first = f.CloudAuthProvider({ children }), second = f.CloudAuthProvider({ children });
  assert.equal(first.type, 'clerk-provider'); assert.equal(first.props.publishableKey, env.BLACKCRAB_CLERK_PUBLISHABLE_KEY);
  assert.equal(first.props.tokenCache, f.cache); assert.equal(second.props.children, children); assert.equal(f.calls.length, 2);
});
test('unconfigured or malformed builds neither attach an account nor clear existing account state', () => {
  for (const extra of [{}, { blackcrabCloud: { ...valid, relayUrl: 'http://invalid' } }]) {
    const f = provider(publicConfig(extra)), children = {};
    assert.equal(f.CloudAuthProvider({ children }), children); assert.deepEqual(f.calls, []);
  }
});

test('actual Expo config injects the owned service and rejects incomplete input before generation', () => {
  function load(environment) {
    const module = { exports: {} }, calls = [];
    vm.runInNewContext(fs.readFileSync(path.join(here, '../../apps/mobile/app.config.js'), 'utf8'), {
      module, __dirname: path.join(here, '../../apps/mobile'), process: { env: environment, execPath: '/node' },
      require: name => {
        if (name === 'node:path') return path;
        if (name === 'node:child_process') return { execFileSync: (...args) => { calls.push(args); } };
        if (name === '../../mobile-experience/activation/adapters/owned-cloud-config.cjs') return cloud;
        throw Error('Unexpected config import: ' + name);
      },
    });
    return { run: module.exports, calls };
  }
  const configured = load({ ...env }), result = configured.run({ config: { extra: { ownValue: 3 } } });
  assert.deepEqual(result.extra.blackcrabCloud, valid); assert.equal(result.extra.ownValue, 3);
  assert.equal(configured.calls.length, 1); assert.equal(configured.calls[0][1][1], '--ui-only');
  const incomplete = load({ BLACKCRAB_RELAY_URL: env.BLACKCRAB_RELAY_URL });
  assert.throws(() => incomplete.run({ config: {} }), /Incomplete Blackcrab/); assert.equal(incomplete.calls.length, 0);
});


test('hosted links use the owned HTTPS origin and both Blackcrab app schemes', () => {
  const hostedEnv = { ...env, BLACKCRAB_HOSTED_APP_URL: 'https://app.blackcrab.example/' };
  const configured = cloud.configureOwnedCloud({ scheme: 'blackcrab-remote' }, hostedEnv);
  assert.equal(configured.extra.blackcrabCloud.hostedAppUrl, 'https://app.blackcrab.example');
  assert.deepEqual(configured.ios.associatedDomains, ['applinks:app.blackcrab.example']);
  assert.deepEqual(configured.android.intentFilters[0].data, [{ scheme: 'https', host: 'app.blackcrab.example', pathPrefix: '/threads/' }]);
  assert.deepEqual(cloud.configureOwnedCloud({}, {}).ios.associatedDomains, []);
  assert.deepEqual(configured.scheme, ['blackcrab-remote', 'blackcrab']);
  assert.deepEqual(cloud.configureOwnedCloud({ scheme: 'blackcrab-remote' }, {}).scheme, ['blackcrab-remote', 'blackcrab']);
  assert.equal(cloud.resolveOwnedCloudConfig(configured.extra).hostedAppUrl, 'https://app.blackcrab.example');
  assert.equal(cloud.cloudConfigFromEnvironment(env).hostedAppUrl, undefined);
  assert.throws(() => cloud.cloudConfigFromEnvironment({ BLACKCRAB_HOSTED_APP_URL: hostedEnv.BLACKCRAB_HOSTED_APP_URL }), /Incomplete Blackcrab/);
  for (const url of ['http://app.example', 'https://private@app.example', 'https://app.example/path', 'https://app.example/?private=1', 'https://app.example/#private', 'bad-private']) {
    assert.throws(() => cloud.cloudConfigFromEnvironment({ ...env, BLACKCRAB_HOSTED_APP_URL: url }), e => e.message.includes('BLACKCRAB_HOSTED_APP_URL') && !e.message.includes('private'));
    assert.equal(cloud.resolveOwnedCloudConfig({ blackcrabCloud: { ...valid, hostedAppUrl: url } }), null);
  }
});
