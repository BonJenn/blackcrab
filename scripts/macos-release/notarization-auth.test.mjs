import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { notarizationEnvironment } from './notarization-auth.mjs';

const api = { APPLE_API_KEY: 'fixture-key', APPLE_API_ISSUER: 'fixture-issuer', APPLE_API_KEY_PATH: '/fixture/key.p8' };
const legacy = { APPLE_ID: 'fixture@example.invalid', APPLE_PASSWORD: 'fixture-password', APPLE_TEAM_ID: 'TESTTEAM01' };

test('mixed credentials send only API authentication to the real child environment', () => {
  const input = { ...legacy, ...api, TAURI_SIGNING_PRIVATE_KEY: 'fixture-updater-key' };
  const selected = notarizationEnvironment(input);
  assert.equal(selected.mode, 'api-key');
  const actual = JSON.parse(execFileSync(process.execPath, ['-e', `console.log(JSON.stringify({
    appleIdPresent: Object.hasOwn(process.env, 'APPLE_ID'),
    passwordPresent: Object.hasOwn(process.env, 'APPLE_PASSWORD'),
    apiComplete: ['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH'].every(k => !!process.env[k]),
    updaterPreserved: process.env.TAURI_SIGNING_PRIVATE_KEY === 'fixture-updater-key',
    teamPreserved: process.env.APPLE_TEAM_ID === 'TESTTEAM01'
  }))`], { env: selected.env, encoding: 'utf8' }));
  assert.deepEqual(actual, { appleIdPresent: false, passwordPresent: false, apiComplete: true, updaterPreserved: true, teamPreserved: true });
  assert.equal(input.APPLE_ID, legacy.APPLE_ID);
});

test('empty legacy environment values are removed rather than passed to Tauri', () => {
  const { env } = notarizationEnvironment({ ...api, APPLE_ID: '', APPLE_PASSWORD: '' });
  assert.equal(Object.hasOwn(env, 'APPLE_ID'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_PASSWORD'), false);
});

test('complete Apple ID authentication remains supported without API configuration', () => {
  const { mode, env } = notarizationEnvironment({ ...legacy, APPLE_API_KEY: '', APPLE_API_ISSUER: '', APPLE_API_KEY_PATH: '' });
  assert.equal(mode, 'apple-id');
  assert.equal(env.APPLE_ID, legacy.APPLE_ID);
  assert.equal(['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH'].some(key => Object.hasOwn(env, key)), false);
});

test('incomplete API configuration fails before invoking a credential fallback', () => {
  for (const key of Object.keys(api)) {
    assert.throws(() => notarizationEnvironment({ ...api, ...legacy, [key]: '' }),
      { message: 'App Store Connect notarization requires key ID, issuer and key file path' });
  }
});

test('missing authentication fails without including credential values', () => {
  assert.throws(() => notarizationEnvironment({ APPLE_PASSWORD: 'fixture-do-not-echo' }),
    { message: 'Managed releases require a complete notarization authentication method' });
});
