// Public native build inputs. Inherited Expo/T3 project IDs never enable updates.
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const upstreamProjectId = 'd763fcb8-d37c-41ea-a773-b54a0ab4a454';
const profileChannels = {
  development: 'development',
  'development-simulator': 'development',
  preview: 'preview',
  production: 'production',
};

function updateConfigFromEnvironment(environment) {
  const projectId = text(environment.BLACKCRAB_EAS_PROJECT_ID)?.toLowerCase() ?? null;
  const channel = text(environment.BLACKCRAB_UPDATE_CHANNEL);
  const enabled = text(environment.BLACKCRAB_MOBILE_UPDATES_ENABLED);
  if (enabled !== null && enabled !== '0' && enabled !== '1') {
    throw new Error('BLACKCRAB_MOBILE_UPDATES_ENABLED must be 0 or 1.');
  }
  if (projectId === null && channel === null && enabled !== '1') return null;
  if (projectId === null || channel === null) {
    throw new Error('Blackcrab updates require BLACKCRAB_EAS_PROJECT_ID and BLACKCRAB_UPDATE_CHANNEL.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(projectId)
      || projectId === upstreamProjectId) {
    throw new Error('BLACKCRAB_EAS_PROJECT_ID must be the UUID of a Blackcrab-owned Expo project.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(channel)) {
    throw new Error('BLACKCRAB_UPDATE_CHANNEL must be a channel name of 1 to 64 letters, digits, dots, dashes or underscores.');
  }
  const profile = text(environment.EAS_BUILD_PROFILE);
  const profileChannel = profile !== null && Object.hasOwn(profileChannels, profile) ? profileChannels[profile] : null;
  if (profileChannel && profileChannel !== channel) {
    throw new Error('BLACKCRAB_UPDATE_CHANNEL must match the selected Blackcrab EAS build profile channel.');
  }
  return { version: 1, projectId, channel, enabled: enabled !== '0' };
}

function configureOwnedUpdates(config, environment) {
  const updates = updateConfigFromEnvironment(environment);
  const { eas: ignoredEas, blackcrabUpdates: ignoredUpdates, ...extra } = config.extra ?? {};
  const { runtimeVersion: ignoredIosRuntime, ...ios } = config.ios ?? {};
  const { runtimeVersion: ignoredAndroidRuntime, ...android } = config.android ?? {};
  return {
    ...config,
    ...(updates ? { runtimeVersion: { policy: updates.channel === 'development' ? 'appVersion' : 'fingerprint' }, ios, android } : {}),
    // Replace the whole inherited object, including URLs, headers and signing keys.
    updates: updates ? {
      enabled: updates.enabled,
      url: 'https://u.expo.dev/' + updates.projectId,
      requestHeaders: { 'expo-channel-name': updates.channel },
      checkAutomatically: updates.enabled ? 'ON_LOAD' : 'NEVER',
      fallbackToCacheTimeout: 0,
    } : { enabled: false, checkAutomatically: 'NEVER' },
    extra: {
      ...extra,
      ...(updates ? { eas: { projectId: updates.projectId }, blackcrabUpdates: updates } : {}),
      managedNativeFeatures: {
        ...extra.managedNativeFeatures,
        updatesConfigured: updates !== null,
        automaticUpdatesEnabled: updates?.enabled ?? false,
      },
    },
  };
}

module.exports = { updateConfigFromEnvironment, configureOwnedUpdates };
