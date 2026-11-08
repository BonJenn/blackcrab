// Own display identity for the extension created by expo-sharing. Register before
// expo-sharing: native mods run in reverse order after its target is generated.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const targetName = 'expo-sharing-extension';
const entries = section => Object.entries(section || {}).filter(([key]) => !key.endsWith('_comment'));
module.exports = config => {
  const displayName = config.name;
  const escape = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
  return withXcodeProject(withDangerousMod(config, ['ios', cfg => {
    const file = path.join(cfg.modRequest.platformProjectRoot, targetName, 'Info.plist');
    const source = fs.readFileSync(file, 'utf8');
    const field = /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/;
    if (!field.test(source)) throw new Error('Sharing extension display identity is missing.');
    fs.writeFileSync(file, source.replace(field, (_, before, after) => before + escape(displayName) + after));
    return cfg;
  }]), cfg => {
    const objects = cfg.modResults.hash.project.objects;
    const target = entries(objects.PBXNativeTarget).find(([, value]) => value?.name === targetName)?.[1];
    const configuration = target && objects.XCConfigurationList?.[target.buildConfigurationList];
    if (!configuration) throw new Error('Sharing extension build identity is missing.');
    for (const reference of configuration.buildConfigurations || []) {
      const settings = objects.XCBuildConfiguration?.[reference.value]?.buildSettings;
      if (!settings) throw new Error('Sharing extension build settings are missing.');
      settings.INFOPLIST_KEY_CFBundleDisplayName = JSON.stringify(displayName);
    }
    return cfg;
  });
};
