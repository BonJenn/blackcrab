import { clientCloudConfigFromEnvironment, clientCloudBuildEnvironment } from './client-config.mjs';

const text = value => typeof value === 'string' ? value.trim() : '';
const fieldError = name => new Error(`${name} must be a public HTTPS URL without credentials, query or fragment.`);
function httpsUrl(environment, name, { origin = false } = {}) {
  let url;
  try { url = new URL(text(environment[name])); } catch { throw fieldError(name); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (origin && (url.pathname !== '/' || url.port))) throw fieldError(name);
  return origin ? url.origin : url.toString();
}

/** Public deployment inputs only. A build does not create domains, accounts or signing identities. */
export function hostedWebConfigFromEnvironment(environment = {}) {
  const cloud = clientCloudConfigFromEnvironment(environment);
  if (!cloud) throw new Error('Hosted web builds require complete Blackcrab client cloud configuration.');
  const hostedAppUrl = httpsUrl(environment, 'BLACKCRAB_HOSTED_APP_URL', { origin: true });
  const appleTeamId = text(environment.BLACKCRAB_APPLE_TEAM_ID);
  if (!/^[A-Z0-9]{10}$/.test(appleTeamId)) throw new Error('BLACKCRAB_APPLE_TEAM_ID must be the ten-character Apple team identifier.');
  const desktopDownloadUrl = httpsUrl(environment, 'BLACKCRAB_DESKTOP_DOWNLOAD_URL');
  const privacyPolicyUrl = httpsUrl(environment, 'BLACKCRAB_PRIVACY_POLICY_URL');
  const fingerprints = text(environment.BLACKCRAB_ANDROID_CERT_SHA256).split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
  if (fingerprints.some(value => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) throw new Error('BLACKCRAB_ANDROID_CERT_SHA256 must contain comma-separated SHA-256 certificate fingerprints.');
  const latest = text(environment.BLACKCRAB_HOSTED_LATEST_URL), nightly = text(environment.BLACKCRAB_HOSTED_NIGHTLY_URL);
  let channels = null;
  const channel = text(environment.BLACKCRAB_HOSTED_APP_CHANNEL);
  if (latest || nightly || channel) {
    if (!latest || !nightly || !['latest', 'nightly'].includes(channel)) throw new Error('Hosted channels require BLACKCRAB_HOSTED_LATEST_URL, BLACKCRAB_HOSTED_NIGHTLY_URL and BLACKCRAB_HOSTED_APP_CHANNEL (latest or nightly).');
    channels = {
      latest: httpsUrl(environment, 'BLACKCRAB_HOSTED_LATEST_URL', { origin: true }),
      nightly: httpsUrl(environment, 'BLACKCRAB_HOSTED_NIGHTLY_URL', { origin: true }),
    };
    if (new Set([hostedAppUrl, channels.latest, channels.nightly].map(url => new URL(url).hostname)).size !== 3) throw new Error('Hosted router and channel origins must use three distinct hosts.');
  }
  return Object.freeze({ cloud, hostedAppUrl, appleTeamId, iosBundleIdentifier: 'dev.blackcrab.remote',
    androidPackage: 'dev.blackcrab.remote', androidFingerprints: [...new Set(fingerprints)], desktopDownloadUrl, privacyPolicyUrl,
    channel: channels ? channel : null, channels });
}

export function hostedWebBuildEnvironment(config) {
  return { ...clientCloudBuildEnvironment(config.cloud),
    VITE_HOSTED_APP_CHANNEL: config.channel ?? '',
    BLACKCRAB_DESKTOP_DOWNLOAD_URL: config.desktopDownloadUrl,
    BLACKCRAB_PRIVACY_POLICY_URL: config.privacyPolicyUrl,
  };
}

export function hostedAssociationFiles(config) {
  return {
    'apple-app-site-association.json': { applinks: { details: [{
      appIDs: [`${config.appleTeamId}.${config.iosBundleIdentifier}`], components: [{ '/': '/threads/*' }],
    }] } },
    'assetlinks.json': config.androidFingerprints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: config.androidPackage, sha256_cert_fingerprints: config.androidFingerprints } }] : [],
  };
}

/** Preserve the original channel cookie/proxy behavior in a prebuilt Vercel artifact. */
export function hostedOutputConfig(config) {
  const cookie = 'blackcrab_web_channel';
  const routes = [
    { src: '/\\.well-known/apple-app-site-association(?:\\.json)?', dest: '/.well-known/apple-app-site-association.json', headers: { 'Content-Type': 'application/json' } },
    { src: '/\\.well-known/assetlinks\\.json', dest: '/.well-known/assetlinks.json', headers: { 'Content-Type': 'application/json' } },
  ];
  if (config.channels) {
    const transforms = [{ type: 'request.query', op: 'delete', target: { key: 'channel' } }];
    for (const channel of ['nightly', 'latest']) routes.push({
      src: '/__blackcrab/channel', ...(channel === 'nightly' ? { has: [{ type: 'query', key: 'channel', value: 'nightly' }] } : {}),
      transforms, headers: { Location: '/', 'Set-Cookie': `${cookie}=${channel}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` }, status: 302,
    });
    const host = { type: 'host', value: new URL(config.hostedAppUrl).hostname };
    routes.push({ src: '/(.*)', has: [host, { type: 'cookie', key: cookie, value: 'nightly' }], dest: `${config.channels.nightly}/$1` },
      { src: '/(.*)', has: [host], dest: `${config.channels.latest}/$1` });
  }
  routes.push({ handle: 'filesystem' }, { src: '/(.*)', dest: '/index.html' });
  return { version: 3, routes };
}
