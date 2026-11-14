import { pathToFileURL } from 'node:url';

/** Read-only native sign-in readiness. Never accepts or outputs a secret key. */
export async function checkNativeAccount(publishableKey, request = fetch) {
  if (typeof publishableKey !== 'string' || !/^pk_(live|test)_[A-Za-z0-9+/=]+$/.test(publishableKey)) {
    throw new Error('A Blackcrab Clerk publishable key is required.');
  }
  const encoded = publishableKey.split('_').slice(2).join('_');
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  if (!decoded.endsWith('$')) throw new Error('Invalid Clerk frontend host.');
  const host = decoded.slice(0, -1);
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)) {
    throw new Error('Invalid Clerk frontend host.');
  }
  try {
    const response = await request(`https://${host}/v1/environment?_is_native=1`, {
      headers: { 'x-mobile': '1', 'x-expo-sdk-version': '4.14.0', accept: 'application/json' },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    const body = await response.json();
    if (!response.ok) return {
      ready: false, host, status: response.status,
      reason: body?.errors?.some(error => error.code === 'native_api_disabled')
        ? 'native_api_disabled' : 'sign_in_service_rejected_request',
    };
    // The Frontend API returns configuration directly, without an `object` tag.
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const ready = isRecord(body?.auth_config) && isRecord(body?.user_settings);
    return { ready, host, status: response.status, reason: ready ? 'native_environment_ready' : 'unexpected_response' };
  } catch {
    return { ready: false, host, reason: 'sign_in_service_unreachable' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkNativeAccount(process.env.BLACKCRAB_CLERK_PUBLISHABLE_KEY);
    console.log(JSON.stringify(result));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}
