import { cloudConfigFromEnvironment } from '../mobile-experience/activation/adapters/owned-cloud-config.cjs';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Desktop and host builds need the same account as mobile, plus hosted/CLI sign-in. */
export function clientCloudConfigFromEnvironment(environment = {}) {
  const mobile = cloudConfigFromEnvironment(environment);
  const hostedAppUrl = text(environment.BLACKCRAB_HOSTED_APP_URL);
  const cliOAuthClientId = text(environment.BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID);
  if (mobile === null && hostedAppUrl === null && cliOAuthClientId === null) return null;
  const missing = [
    ...(mobile === null ? ['BLACKCRAB_CLERK_PUBLISHABLE_KEY', 'BLACKCRAB_CLERK_JWT_TEMPLATE', 'BLACKCRAB_RELAY_URL'] : []),
    ...(hostedAppUrl === null ? ['BLACKCRAB_HOSTED_APP_URL'] : []),
    ...(cliOAuthClientId === null ? ['BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID'] : []),
  ];
  if (missing.length) throw new Error('Incomplete Blackcrab client cloud configuration: ' + missing.join(', '));
  let hosted;
  try { hosted = new URL(hostedAppUrl); } catch { /* Report the setting, never its value. */ }
  if (!hosted || hosted.protocol !== 'https:' || hosted.username || hosted.password ||
      hosted.pathname !== '/' || hosted.search || hosted.hash) {
    throw new Error('BLACKCRAB_HOSTED_APP_URL must be an HTTPS origin without credentials, path, query or fragment.');
  }
  if (cliOAuthClientId.length > 256 || /\s|[\x00-\x1f\x7f]/u.test(cliOAuthClientId)) {
    throw new Error('BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID must be a nonempty OAuth client identifier.');
  }
  return Object.freeze({ ...mobile, hostedAppUrl: hosted.origin, cliOAuthClientId });
}

/** Only public, explicitly owned configuration is passed to the original build inputs. */
export function clientCloudBuildEnvironment(config) {
  if (config === null) return {};
  return {
    T3CODE_RELAY_URL: config.relayUrl,
    VITE_T3CODE_RELAY_URL: config.relayUrl,
    T3CODE_CLERK_PUBLISHABLE_KEY: config.publishableKey,
    VITE_CLERK_PUBLISHABLE_KEY: config.publishableKey,
    T3CODE_CLERK_JWT_TEMPLATE: config.jwtTemplate,
    VITE_CLERK_JWT_TEMPLATE: config.jwtTemplate,
    T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: config.cliOAuthClientId,
    VITE_CLERK_CLI_OAUTH_CLIENT_ID: config.cliOAuthClientId,
    T3CODE_HOSTED_APP_URL: config.hostedAppUrl,
    VITE_HOSTED_APP_URL: config.hostedAppUrl,
  };
}
