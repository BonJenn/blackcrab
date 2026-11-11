const { cloudConfigFromEnvironment } = require('../../mobile-experience/activation/adapters/owned-cloud-config.cjs');

module.exports = function (api) {
  // A changed hosted origin must invalidate Metro's cached shared link modules.
  const hostedAppUrl = api.cache.using(() => cloudConfigFromEnvironment(process.env)?.hostedAppUrl ?? '');
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [[require.resolve('./babel-owned-hosted-origin.cjs'), { hostedAppUrl }]],
  };
};
