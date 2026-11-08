// Own display identity for the extension created by expo-sharing. Register before
// expo-sharing: native mods run in reverse order after its target is generated.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const targetName = 'expo-sharing-extension';
const entries = section => Object.entries(section || {}).filter(([key]) => !key.endsWith('_comment'));
function sharingDeploymentFloor(current, minimum) {
  const parse = value => {
    const normalized = String(value).replace(/^"(.*)"$/, '$1');
    if (!/^\d+(?:\.\d+)*$/.test(normalized)) throw new Error('Unsupported sharing extension iOS deployment target.');
    return { text: normalized, parts: normalized.split('.').map(Number) };
  };
  const floor = parse(minimum), actual = current === undefined ? floor : parse(current);
  for (let i = 0; i < Math.max(floor.parts.length, actual.parts.length); i++) {
    const delta = (actual.parts[i] ?? 0) - (floor.parts[i] ?? 0);
    if (delta) return delta > 0 ? actual.text : floor.text;
  }
  return actual.text;
}
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
      // SDK 58 expo-sharing hardcodes 16.4 for its extension. Its Swift modules
      // share the app's iOS 18 dependency floor; never lower a higher target.
      settings.IPHONEOS_DEPLOYMENT_TARGET = sharingDeploymentFloor(settings.IPHONEOS_DEPLOYMENT_TARGET, config.ios?.deploymentTarget);
    }
    return cfg;
  });
};

module.exports.sharingDeploymentFloor = sharingDeploymentFloor;
