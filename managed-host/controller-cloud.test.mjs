import test from 'node:test';
import assert from 'node:assert/strict';
import { controllerCloudEnvironment } from './controller-cloud.mjs';

const configured = {
  BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuYmxhY2tjcmFiLmV4YW1wbGUk',
  BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay',
  BLACKCRAB_RELAY_URL: 'https://relay.blackcrab.example',
  BLACKCRAB_HOSTED_APP_URL: 'https://app.blackcrab.example',
  BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID: 'oac_blackcrab',
};

test('controller accepts a local build or a complete public cloud account', () => {
  assert.deepEqual(controllerCloudEnvironment(), {});
  assert.deepEqual(controllerCloudEnvironment(configured), configured);
  assert(Object.isFrozen(controllerCloudEnvironment(configured)));
  for (const key of Object.keys(configured)) {
    const partial = { ...configured }; delete partial[key];
    assert.throws(() => controllerCloudEnvironment(partial));
  }
});

test('controller rejects secrets and process settings before persisting a plan', () => {
  for (const key of ['BLACKCRAB_CLERK_SECRET_KEY', 'PATH', 'HOME', 'NODE_OPTIONS', 'T3CODE_RELAY_URL']) {
    assert.throws(() => controllerCloudEnvironment({ ...configured, [key]: 'private-value' }),
      error => !error.message.includes('private-value'));
  }
  for (const value of [null, [], 'private-value', { BLACKCRAB_RELAY_URL: 42 }]) {
    assert.throws(() => controllerCloudEnvironment(value));
  }
});
