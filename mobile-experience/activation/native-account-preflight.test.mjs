import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNativeAccount } from './native-account-preflight.mjs';
const key = 'pk_live_' + Buffer.from('clerk.blackcrab.example$').toString('base64');

test('readiness uses the native request path; ordinary browser health does not count', async () => {
  let requests = 0;
  const result = await checkNativeAccount(key, async (url, options) => {
    requests++;
    assert.equal(url, 'https://clerk.blackcrab.example/v1/environment?_is_native=1');
    assert.equal(options.headers['x-mobile'], '1');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.redirect, 'error');
    // Match the successful production native response: no `object` discriminator.
    return Response.json({ auth_config: {}, user_settings: {}, native_app_settings: {} });
  });
  assert.equal(requests, 1); assert.equal(result.ready, true);
});
test('disabled native API is reported without retaining backend diagnostics', async () => {
  const result = await checkNativeAccount(key, async () => Response.json({ errors: [
    { code: 'native_api_disabled', message: 'private backend diagnostic' },
  ] }, { status: 400 }));
  assert.equal(result.ready, false); assert.equal(result.reason, 'native_api_disabled');
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('network errors, HTML challenges, and unexpected JSON fail closed', async () => {
  for (const request of [async () => { throw Error('private detail'); },
    async () => new Response('<html>challenge</html>'),
    ...[null, {}, { object: 'environment', user_settings: {} },
      { auth_config: {}, user_settings: null }, { auth_config: [], user_settings: {} },
      { auth_config: {}, user_settings: [] }].map(body => async () => Response.json(body))]) {
    const result = await checkNativeAccount(key, request);
    assert.equal(result.ready, false); assert.ok(!JSON.stringify(result).includes('private'));
  }
});
test('rejects secret keys and malformed hosts before any request', async () => {
  for (const input of ['sk_live_private', '', undefined,
    'pk_live_' + Buffer.from('clerk.example/private$').toString('base64'),
    'pk_live_' + Buffer.from('user@clerk.example$').toString('base64')]) {
    await assert.rejects(checkNativeAccount(input, () => assert.fail('unexpected request')),
      error => !error.message.includes('private'));
  }
});
