// Metro config for use inside the Blackcrab npm-workspaces monorepo.
// Dependencies (react, react-native, expo, ...) are hoisted to the repo-root
// node_modules, so Metro must watch the workspace root and resolve modules from
// both the app's and the root's node_modules. See
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...config.watchFolders, workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
