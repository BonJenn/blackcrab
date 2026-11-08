// Blackcrab build integration for Expo SDK 54's generated Podfile.
// No upstream dependency sources or script phases are modified.
const { withPodfile, withPodfileProperties } = require('@expo/config-plugins');
const FLOOR = '15.1';
const START = '    # @generated begin blackcrab-ios-pod-floor';
const END = '    # @generated end blackcrab-ios-pod-floor';
const BLOCK = `${START}
    # RN's updateOSDeploymentTarget visits native targets, leaving resource bundles behind.
    # Apply the app's minimum to every generated pod target; keep higher pod requirements.
    installer.pods_project.targets.each do |blackcrab_target|
      blackcrab_target.build_configurations.each do |blackcrab_configuration|
        blackcrab_current = blackcrab_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if blackcrab_current && !blackcrab_current.match?(/\\A\\d+(?:\\.\\d+)*\\z/)
          raise "Unsupported iOS deployment target in #{blackcrab_target.name}"
        end
        blackcrab_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] =
          [Gem::Version.new(blackcrab_current || '${FLOOR}'), Gem::Version.new('${FLOOR}')].max.to_s
      end
    end
${END}`;

function applyPodFloor(contents) {
  const start = contents.indexOf(START), end = contents.indexOf(END);
  if (start !== -1 || end !== -1) {
    if (start === -1 || end < start || contents.indexOf(START, start + START.length) !== -1 || contents.indexOf(END, end + END.length) !== -1) {
      throw new Error('Unsupported generated iOS Podfile: duplicate or incomplete Blackcrab pod-floor block.');
    }
    contents = contents.slice(0, start) + contents.slice(end + END.length).replace(/^\r?\n/, '');
  }
  // SDK 54 template has exactly one installer hook. Fail closed when Expo changes it.
  const hooks = [...contents.matchAll(/^([ \t]*)post_install do \|installer\|[ \t]*\r?$/gm)];
  if (hooks.length !== 1 || !contents.includes('react_native_post_install(')) {
    throw new Error('Unsupported generated iOS Podfile: expected the Expo SDK 54 post_install hook.');
  }
  const hook = hooks[0];
  const position = hook.index + hook[0].length;
  return contents.slice(0, position) + '\n' + BLOCK + contents.slice(position);
}

function withIosPodFloor(config) {
  config = withPodfileProperties(config, result => {
    const current = result.modResults['ios.deploymentTarget'];
    if (current !== undefined && !/^\d+(?:\.\d+)*$/.test(current)) throw new Error('Unsupported app iOS deployment target.');
    const compare = (a, b) => {
      const left = a.split('.').map(Number), right = b.split('.').map(Number);
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const delta = (left[index] ?? 0) - (right[index] ?? 0); if (delta) return delta;
      }
      return 0;
    };
    result.modResults['ios.deploymentTarget'] = current && compare(current, FLOOR) > 0 ? current : FLOOR;
    return result;
  });
  return withPodfile(config, result => {
    result.modResults.contents = applyPodFloor(result.modResults.contents);
    return result;
  });
}
module.exports = withIosPodFloor;
module.exports.applyPodFloor = applyPodFloor;
module.exports.FLOOR = FLOOR;
