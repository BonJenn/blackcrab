// Owned configuration only: never import/evaluate the copied upstream app.config/EAS.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { configureOwnedCloud } = require('../../mobile-experience/activation/adapters/owned-cloud-config.cjs');
process.env.EXPO_NO_TYPESCRIPT_SETUP = '1';
module.exports = ({ config }) => {
  const ownedConfig = configureOwnedCloud(config, process.env);
  // Native prebuild can run before Metro and needs generated widget source paths.
  execFileSync(process.execPath, [path.resolve(__dirname, '../../mobile-experience/resources-cli.mjs'), '--ui-only'], { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe', timeout: 15 * 60_000 });
  return ownedConfig;
};
