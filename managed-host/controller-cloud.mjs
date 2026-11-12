import { clientCloudConfigFromEnvironment } from '../managed-cloud/client-config.mjs';

const PUBLIC_KEYS = new Set([
  'BLACKCRAB_CLERK_PUBLISHABLE_KEY', 'BLACKCRAB_CLERK_JWT_TEMPLATE',
  'BLACKCRAB_RELAY_URL', 'BLACKCRAB_HOSTED_APP_URL',
  'BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID',
]);

/** Public build inputs only. Never persist a caller's full process environment. */
export function controllerCloudEnvironment(value = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !PUBLIC_KEYS.has(key) || typeof value[key] !== 'string')) {
    throw new Error('Service controller accepts only explicit public cloud settings');
  }
  clientCloudConfigFromEnvironment(value);
  return Object.freeze(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}
