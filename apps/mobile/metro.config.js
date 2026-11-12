const path = require('node:path');
const { createHash } = require('node:crypto');
const { cloudConfigFromEnvironment } = require('../../mobile-experience/activation/adapters/owned-cloud-config.cjs');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const appRequire = createRequire(path.join(projectRoot, 'package.json'));
const config = getDefaultConfig(projectRoot);
// Metro may reuse transforms without invoking Babel. Separate those caches too.
const hostedAppUrl = cloudConfigFromEnvironment(process.env)?.hostedAppUrl ?? '';
config.cacheVersion = (config.cacheVersion ?? '') + ':blackcrab-hosted:' + createHash('sha256').update(hostedAppUrl).digest('hex');
config.watchFolders = [...new Set([...(config.watchFolders || []), workspaceRoot])];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules'), path.join(workspaceRoot, 'node_modules')];
config.resolver.resolveRequest = require('./metro-resolution.cjs').createMobileResolveRequest(appRequire);
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@t3tools/mobile-device-stream': path.join(projectRoot, '.generated/device-stream'),
  '@t3tools/mobile-preview-stream': path.join(projectRoot, '.generated/preview-stream'),
  '@t3tools/mobile-third-party-licenses': path.join(projectRoot, '.generated/third-party-licenses'),
};
module.exports = (async () => {
  const { prepareMobileResources } = await import(pathToFileURL(path.join(workspaceRoot, 'mobile-experience/resources.mjs')).href);
  await prepareMobileResources(workspaceRoot);
  return withUniwindConfig(config, { cssEntryFile: './global.css', extraThemes: require('./.generated/native-ui/apps/mobile/generated-uniwind-theme-names.json'), polyfills: { rem: 14 } });
})();
