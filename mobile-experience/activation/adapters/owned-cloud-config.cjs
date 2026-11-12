// Public build configuration only. Never accepts a secret key or inherited T3 extras.
const names = {
  publishableKey: 'BLACKCRAB_CLERK_PUBLISHABLE_KEY',
  jwtTemplate: 'BLACKCRAB_CLERK_JWT_TEMPLATE',
  relayUrl: 'BLACKCRAB_RELAY_URL',
};
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function validate(input) {
  const publishableKey = text(input?.publishableKey);
  const jwtTemplate = text(input?.jwtTemplate);
  const relayUrl = text(input?.relayUrl);
  if (!publishableKey || !/^pk_(test|live)_[A-Za-z0-9_-]+={0,2}$/.test(publishableKey)) throw new Error('BLACKCRAB_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key.');
  if (!jwtTemplate || jwtTemplate.length > 256 || /[\x00-\x1f\x7f]/.test(jwtTemplate)) throw new Error('BLACKCRAB_CLERK_JWT_TEMPLATE must name the relay JWT template.');
  let url;
  try { url = new URL(relayUrl); } catch { /* Report only the field name. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/+$/u.test(url.pathname)) throw new Error('BLACKCRAB_RELAY_URL must be an HTTPS origin without credentials, path, query or fragment.');
  const hostedAppUrl = text(input?.hostedAppUrl);
  let hosted;
  if (hostedAppUrl) {
    try { hosted = new URL(hostedAppUrl); } catch { /* Report only the field name. */ }
    if (!hosted || hosted.protocol !== 'https:' || hosted.username || hosted.password || hosted.pathname !== '/' || hosted.search || hosted.hash) throw new Error('BLACKCRAB_HOSTED_APP_URL must be an HTTPS origin without credentials, path, query or fragment.');
  }
  return { version: 1, publishableKey, jwtTemplate, relayUrl: url.origin, ...(hosted ? { hostedAppUrl: hosted.origin } : {}) };
}

function cloudConfigFromEnvironment(environment) {
  const input = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, text(environment[name])]));
  const hostedAppUrl = text(environment.BLACKCRAB_HOSTED_APP_URL);
  if (Object.values(input).every(value => value === null) && !hostedAppUrl) return null;
  const missing = Object.entries(input).filter(([, value]) => value === null).map(([key]) => names[key]);
  if (missing.length) throw new Error('Incomplete Blackcrab cloud configuration: ' + missing.join(', '));
  return validate({ ...input, hostedAppUrl });
}

function resolveOwnedCloudConfig(extra) {
  const input = extra?.blackcrabCloud;
  if (!input || input.version !== 1) return null;
  try { return validate(input); } catch { return null; }
}

function configureOwnedCloud(config, environment) {
  const cloud = cloudConfigFromEnvironment(environment);
  const { blackcrabCloud: ignored, ...extra } = config.extra ?? {};
  const plugins = (config.plugins ?? [])
    .filter(entry => (Array.isArray(entry) ? entry[0] : entry) !== '@clerk/expo')
    .map(entry => {
      if ((Array.isArray(entry) ? entry[0] : entry) !== 'expo-widgets') return entry;
      const options = Array.isArray(entry) ? entry[1] ?? {} : {};
      return ['expo-widgets', { ...options, enablePushNotifications: cloud !== null }];
    });
  if (cloud) plugins.push(['@clerk/expo', { theme: './.generated/native-ui/apps/mobile/clerk-theme.json', keychainService: 'dev.blackcrab.remote.clerk', appleSignIn: true }]);
  const hostedHost = cloud?.hostedAppUrl ? new URL(cloud.hostedAppUrl).hostname : null;
  return { ...config, scheme: ['blackcrab-remote', 'blackcrab'],
    ios: { ...config.ios, associatedDomains: hostedHost ? ['applinks:' + hostedHost] : [] },
    android: { ...config.android, intentFilters: hostedHost ? [{ action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: hostedHost, pathPrefix: '/threads/' }], category: ['BROWSABLE', 'DEFAULT'] }] : [] },
    plugins, extra: { ...extra, ...(cloud ? { blackcrabCloud: cloud } : {}),
    managedNativeFeatures: { ...extra.managedNativeFeatures, cloudConfigured: cloud !== null } } };
}

module.exports = { cloudConfigFromEnvironment, resolveOwnedCloudConfig, configureOwnedCloud };
