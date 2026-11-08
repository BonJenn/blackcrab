const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const appRequire = createRequire(path.join(projectRoot, 'package.json'));
const config = getDefaultConfig(projectRoot);
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
  return withUniwindConfig(config, { cssEntryFile: './global.css', extraThemes: require('../../vendor/t3-mobile/apps/mobile/generated-uniwind-theme-names.json'), polyfills: { rem: 14 } });
})();
