import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedWebConfigFromEnvironment, hostedWebBuildEnvironment, hostedAssociationFiles, hostedOutputConfig } from './hosted-config.mjs';

const environment = {
  BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture_only', BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay',
  BLACKCRAB_RELAY_URL: 'https://relay.blackcrab.example', BLACKCRAB_HOSTED_APP_URL: 'https://app.blackcrab.example',
  BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID: 'blackcrab-cli', BLACKCRAB_APPLE_TEAM_ID: 'BC12345678',
  BLACKCRAB_DESKTOP_DOWNLOAD_URL: 'https://blackcrab.example/download',
  BLACKCRAB_PRIVACY_POLICY_URL: 'https://blackcrab.example/privacy',
};
const channels = { BLACKCRAB_HOSTED_LATEST_URL: 'https://latest.blackcrab.example', BLACKCRAB_HOSTED_NIGHTLY_URL: 'https://nightly.blackcrab.example', BLACKCRAB_HOSTED_APP_CHANNEL: 'latest' };

test('hosted builds require explicit cloud, app identity and download settings', () => {
  assert.throws(() => hostedWebConfigFromEnvironment({}), /require complete/);
  for (const key of Object.keys(environment)) {
    const partial = { ...environment }; delete partial[key];
    assert.throws(() => hostedWebConfigFromEnvironment(partial));
  }
  const config = hostedWebConfigFromEnvironment(environment);
  assert.equal(config.channel, null);
  assert.equal(hostedWebBuildEnvironment(config).VITE_HOSTED_APP_URL, environment.BLACKCRAB_HOSTED_APP_URL);
  assert.equal(hostedWebBuildEnvironment(config).VITE_HOSTED_APP_CHANNEL, '');
});

test('native association files bind the owned signing identities and thread routes', () => {
  const fingerprint = Array(32).fill('ab').join(':');
  const files = hostedAssociationFiles(hostedWebConfigFromEnvironment({ ...environment, BLACKCRAB_ANDROID_CERT_SHA256: fingerprint + ',' + fingerprint.toUpperCase() }));
  assert.deepEqual(files['apple-app-site-association.json'].applinks.details, [{ appIDs: ['BC12345678.dev.blackcrab.remote'], components: [{ '/': '/threads/*' }] }]);
  assert.equal(files['assetlinks.json'][0].target.package_name, 'dev.blackcrab.remote');
  assert.deepEqual(files['assetlinks.json'][0].target.sha256_cert_fingerprints, [fingerprint.toUpperCase()]);
  assert.deepEqual(hostedAssociationFiles(hostedWebConfigFromEnvironment(environment))['assetlinks.json'], []);
  assert(!JSON.stringify(files).includes('com.t3tools'));
});

test('channel routing preserves cookie selection, both own origins, metadata and SPA/static ordering', () => {
  const config = hostedWebConfigFromEnvironment({ ...environment, ...channels });
  const output = hostedOutputConfig(config);
  assert.equal(output.version, 3);
  const rules = output.routes;
  assert.equal(rules[0].dest, '/.well-known/apple-app-site-association.json');
  const selectors = rules.filter(rule => rule.src === '/__blackcrab/channel');
  assert.equal(selectors.length, 2);
  assert.equal(selectors[0].has[0].value, 'nightly');
  assert.match(selectors[0].headers['Set-Cookie'], /^blackcrab_web_channel=nightly;.*HttpOnly; Secure; SameSite=Lax$/);
  assert.match(selectors[1].headers['Set-Cookie'], /^blackcrab_web_channel=latest;/);
  for (const selector of selectors) {
    assert.equal(selector.status, 302); assert.equal(selector.headers.Location, '/');
    assert.deepEqual(selector.transforms, [{ type: 'request.query', op: 'delete', target: { key: 'channel' } }]);
  }
  const proxies = rules.filter(rule => rule.dest?.startsWith('https:'));
  assert.deepEqual(proxies.map(rule => rule.dest), ['https://nightly.blackcrab.example/$1', 'https://latest.blackcrab.example/$1']);
  assert(proxies.every(rule => rule.has[0].value === 'app.blackcrab.example'));
  assert.equal(proxies[0].has[1].key, 'blackcrab_web_channel');
  assert.deepEqual(rules.slice(-2), [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/index.html' }]);
  assert(!JSON.stringify(output).includes('t3.codes'));
});

test('single-origin builds have no channel cookie or external proxy', () => {
  const rules = hostedOutputConfig(hostedWebConfigFromEnvironment(environment)).routes;
  assert.equal(rules.length, 4);
  assert(!rules.some(rule => rule.dest?.startsWith('https:') || rule.headers?.['Set-Cookie']));
});

test('partial channels and proxy loops are rejected before source/build work', () => {
  for (const key of Object.keys(channels)) {
    const partial = { ...channels }; delete partial[key];
    assert.throws(() => hostedWebConfigFromEnvironment({ ...environment, ...partial }), /Hosted channels require/);
  }
  for (const latest of [environment.BLACKCRAB_HOSTED_APP_URL, channels.BLACKCRAB_HOSTED_NIGHTLY_URL]) {
    assert.throws(() => hostedWebConfigFromEnvironment({ ...environment, ...channels, BLACKCRAB_HOSTED_LATEST_URL: latest }), /three distinct hosts/);
  }
});

test('invalid public deployment inputs fail without echoing values', () => {
  for (const [key, value] of [
    ['BLACKCRAB_HOSTED_APP_URL', 'https://private@app.example'],
    ['BLACKCRAB_APPLE_TEAM_ID', 'private-team'],
    ['BLACKCRAB_ANDROID_CERT_SHA256', 'private-certificate'],
    ['BLACKCRAB_DESKTOP_DOWNLOAD_URL', 'https://app.example/download?private=token'],
    ['BLACKCRAB_HOSTED_LATEST_URL', 'https://latest.example/path-private'],
  ]) assert.throws(() => hostedWebConfigFromEnvironment({ ...environment, ...channels, [key]: value }), error => !error.message.includes('private'));
});
