import test from 'node:test';
import assert from 'node:assert/strict';
import { clientCloudConfigFromEnvironment, clientCloudBuildEnvironment } from './client-config.mjs';

const configured = {
  BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuYmxhY2tjcmFiLmV4YW1wbGUk',
  BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay',
  BLACKCRAB_RELAY_URL: ' https://relay.blackcrab.example/ ',
  BLACKCRAB_HOSTED_APP_URL: ' https://app.blackcrab.example/ ',
  BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID: 'oac_blackcrab',
};

test('an unconfigured build ignores inherited upstream cloud and stays local', () => {
  const config = clientCloudConfigFromEnvironment({
    T3CODE_RELAY_URL: 'https://relay.t3.codes',
    VITE_HOSTED_APP_URL: 'https://app.t3.codes',
    T3CODE_CLERK_PUBLISHABLE_KEY: configured.BLACKCRAB_CLERK_PUBLISHABLE_KEY,
  });
  assert.equal(config, null);
  assert.deepEqual(clientCloudBuildEnvironment(config), {});
});

test('all clients receive the same explicitly owned account and normalized origins', () => {
  const config = clientCloudConfigFromEnvironment({ ...configured,
    T3CODE_RELAY_URL: 'https://unrelated.example',
    BLACKCRAB_CLERK_SECRET_KEY: 'secret-not-for-builds',
    VITE_CLERK_SECRET_KEY: 'secret-not-for-builds',
  });
  assert.equal(config.relayUrl, 'https://relay.blackcrab.example');
  assert.equal(config.hostedAppUrl, 'https://app.blackcrab.example');
  const build = clientCloudBuildEnvironment(config);
  for (const [server, web] of [
    ['T3CODE_RELAY_URL', 'VITE_T3CODE_RELAY_URL'],
    ['T3CODE_CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY'],
    ['T3CODE_CLERK_JWT_TEMPLATE', 'VITE_CLERK_JWT_TEMPLATE'],
    ['T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'VITE_CLERK_CLI_OAUTH_CLIENT_ID'],
    ['T3CODE_HOSTED_APP_URL', 'VITE_HOSTED_APP_URL'],
  ]) assert.equal(build[server], build[web]);
  assert.equal(build.T3CODE_RELAY_URL, config.relayUrl);
  assert.equal(build.T3CODE_CLERK_PUBLISHABLE_KEY, config.publishableKey);
  assert.equal(build.T3CODE_CLERK_JWT_TEMPLATE, config.jwtTemplate);
  assert.equal(build.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID, config.cliOAuthClientId);
  assert.equal(build.T3CODE_HOSTED_APP_URL, config.hostedAppUrl);
  assert(!JSON.stringify(build).includes('secret-not-for-builds'));
  assert(!JSON.stringify(build).includes('unrelated.example'));
});

test('partial cloud settings fail before a build can advertise an unusable account', () => {
  for (const key of Object.keys(configured)) {
    const values = { ...configured };
    delete values[key];
    assert.throws(() => clientCloudConfigFromEnvironment(values), error => error.message.includes(key));
  }
  assert.throws(() => clientCloudConfigFromEnvironment({ BLACKCRAB_HOSTED_APP_URL: configured.BLACKCRAB_HOSTED_APP_URL }), /BLACKCRAB_RELAY_URL/);
});

test('hosted sign-in refuses insecure or ambiguous destinations without disclosing their values', () => {
  for (const value of ['http://app.example', 'https://user:private@app.example', 'https://app.example/path',
    'https://app.example?secret=private', 'https://app.example#private', 'private']) {
    assert.throws(() => clientCloudConfigFromEnvironment({ ...configured, BLACKCRAB_HOSTED_APP_URL: value }), error =>
      error.message.includes('BLACKCRAB_HOSTED_APP_URL') && !error.message.includes('private'));
  }
});

test('secret keys and malformed OAuth identifiers are rejected without echoing input', () => {
  assert.throws(() => clientCloudConfigFromEnvironment({ ...configured, BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'sk_live_private' }),
    error => error.message.includes('BLACKCRAB_CLERK_PUBLISHABLE_KEY') && !error.message.includes('sk_live_private'));
  for (const value of ['oac_private\ninjected', 'oac private', 'x'.repeat(257)]) {
    assert.throws(() => clientCloudConfigFromEnvironment({ ...configured, BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID: value }),
      error => error.message.includes('BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID') && !error.message.includes(value));
  }
});
