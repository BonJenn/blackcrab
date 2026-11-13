const apiKeys = ['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH'];
const appleIdKeys = ['APPLE_ID', 'APPLE_PASSWORD'];
const present = value => typeof value === 'string' && value.trim().length > 0;

// Tauri checks Apple ID credentials first, including empty environment values.
// Match the workflow's API-key preflight and DMG notarization preference, and
// remove the other method entirely before spawning the actual Tauri process.
export function notarizationEnvironment(input) {
  const env = { ...input };
  if (apiKeys.every(key => present(env[key]))) {
    for (const key of appleIdKeys) delete env[key];
    return { mode: 'api-key', env };
  }
  if (apiKeys.some(key => present(env[key]))) {
    throw Error('App Store Connect notarization requires key ID, issuer and key file path');
  }
  if ([...appleIdKeys, 'APPLE_TEAM_ID'].every(key => present(env[key]))) {
    for (const key of apiKeys) delete env[key];
    return { mode: 'apple-id', env };
  }
  throw Error('Managed releases require a complete notarization authentication method');
}
