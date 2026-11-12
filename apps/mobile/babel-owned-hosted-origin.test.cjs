const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const originKey = 'BLACKCRAB_HOSTED_APP_URL';
const fixture = { BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture_only', BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay', BLACKCRAB_RELAY_URL: 'https://relay.example.test' };

test('real Babel config inlines the shared hosted default and invalidates its cache on origin changes', t => {
  const keys = [...Object.keys(fixture), originKey], saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; });
  const filename = path.resolve(__dirname, '../../vendor/t3-mobile/packages/shared/src/connectAuth.ts');
  // Exercise the registered source patch, before and after consumer regeneration.
  const records = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../managed-host/patches/registry.json')));
  const source = records.find(record => record.target === 'packages/shared/src/connectAuth.ts').replacements[0].after;
  for (const origin of ['https://first.blackcrab.example', 'https://second.blackcrab.example', '']) {
    for (const key of keys) delete process.env[key];
    if (origin) Object.assign(process.env, fixture, { [originKey]: origin });
    const code = babel.transformSync(source, { filename, babelrc: false, configFile: path.resolve(__dirname, 'babel.config.js') }).code;
    assert(!code.includes('__BLACKCRAB_HOSTED_APP_URL__'), code);
    const module = { exports: {} };
    vm.runInNewContext(code, { exports: module.exports, module, require: name => {
      assert.equal(name, './remote.ts'); return { readHashParams() {} };
    } });
    assert.equal(module.exports.DEFAULT_HOSTED_APP_URL, origin);
  }
});

test('hosted constant transform preserves local bindings', () => {
  const code = babel.transformSync('function local(__BLACKCRAB_HOSTED_APP_URL__) { return __BLACKCRAB_HOSTED_APP_URL__; }', {
    babelrc: false, configFile: false, plugins: [[require.resolve('./babel-owned-hosted-origin.cjs'), { hostedAppUrl: 'https://app.example' }]],
  }).code;
  assert(!code.includes('https://app.example'));
});


test('actual Metro cache configuration separates hosted origins and local-only builds', () => {
  const source = fs.readFileSync(path.join(__dirname, 'metro.config.js'), 'utf8').split('module.exports = (async () => {')[0] + '\nmodule.exports = config;';
  function load(environment) {
    const module = { exports: {} };
    vm.runInNewContext(source, { module, __dirname, process: { env: environment }, require: name => {
      if (name === 'expo/metro-config') return { getDefaultConfig: () => ({ cacheVersion: 'expo-default', resolver: {} }) };
      if (name === 'uniwind/metro') return {};
      if (name === './metro-resolution.cjs') return { createMobileResolveRequest: () => () => {} };
      return require(name);
    } });
    return module.exports.cacheVersion;
  }
  const local=load({}), first=load({...fixture, [originKey]:'https://first.blackcrab.example'}), second=load({...fixture, [originKey]:'https://second.blackcrab.example'});
  assert.equal(new Set([local, first, second]).size,3);
  assert.equal(load({...fixture, [originKey]:'https://first.blackcrab.example/'}),first);
  assert.equal(load({T3CODE_HOSTED_APP_URL:'https://app.t3.codes'}),local);
});
