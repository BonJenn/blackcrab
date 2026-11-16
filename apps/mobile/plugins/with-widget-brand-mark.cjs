// Adds Blackcrab's crab mark to the widget extension's asset catalog as a template image, so
// the Live Activity can draw it in any tint. Register before expo-widgets: native mods run in
// reverse order, so this runs after expo-widgets has created (and wiped) its target.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const targetName = 'ExpoWidgetsTarget';
const imageName = 'BlackcrabMark';
const phaseName = 'Compile Widget Assets';
const scales = [['1x', imageName + '.png'], ['2x', imageName + '@2x.png'], ['3x', imageName + '@3x.png']];
const json = value => JSON.stringify(value, null, 2) + '\n';
const entries = section => Object.entries(section || {}).filter(([key]) => !key.endsWith('_comment'));

// xcodebuild ignores Resources phases on expo-widgets targets, so the catalog is compiled in
// a shell phase. A missing catalog fails the build rather than shipping a card without a mark.
const compileScript = [
  'set -e',
  'CATALOG="${SRCROOT}/' + targetName + '/Assets.xcassets"',
  'if [ ! -d "$CATALOG" ]; then',
  '  echo "error: widget asset catalog not found at $CATALOG"',
  '  exit 1',
  'fi',
  'DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"',
  'mkdir -p "$DEST"',
  'xcrun actool "$CATALOG" --compile "$DEST" --platform "${PLATFORM_NAME}" --minimum-deployment-target "${IPHONEOS_DEPLOYMENT_TARGET:-18.0}" --output-format human-readable-text',
].join('\n');

function writeCatalog(projectRoot, platformProjectRoot) {
  const catalog = path.join(platformProjectRoot, targetName, 'Assets.xcassets');
  const imageSet = path.join(catalog, imageName + '.imageset');
  fs.mkdirSync(imageSet, { recursive: true });
  fs.writeFileSync(path.join(catalog, 'Contents.json'), json({ info: { author: 'xcode', version: 1 } }));
  fs.writeFileSync(path.join(imageSet, 'Contents.json'), json({
    images: scales.map(([scale, filename]) => ({ idiom: 'universal', scale, filename })),
    info: { author: 'xcode', version: 1 },
    properties: { 'template-rendering-intent': 'template' },
  }));
  for (const [, filename] of scales) fs.copyFileSync(path.join(projectRoot, 'assets/widget', filename), path.join(imageSet, filename));
}

function addCompilePhase(project) {
  const objects = project.hash.project.objects;
  const target = entries(objects.PBXNativeTarget).find(([, value]) => value?.name === targetName);
  if (!target) throw new Error('Widget target is missing; register with-widget-brand-mark before expo-widgets.');
  const [uuid, value] = target;
  const phases = value.buildPhases || [];
  const exists = entries(objects.PBXShellScriptBuildPhase).some(([id, phase]) => phase?.name === JSON.stringify(phaseName) && phases.some(reference => reference.value === id));
  if (exists) return false;
  const added = project.addBuildPhase([], 'PBXShellScriptBuildPhase', phaseName, uuid, { shellPath: '/bin/sh', shellScript: compileScript });
  objects.PBXShellScriptBuildPhase[added.uuid].alwaysOutOfDate = 1;
  return true;
}

module.exports = config => withXcodeProject(withDangerousMod(config, ['ios', cfg => {
  writeCatalog(cfg.modRequest.projectRoot, cfg.modRequest.platformProjectRoot);
  return cfg;
}]), cfg => {
  addCompilePhase(cfg.modResults);
  return cfg;
});
module.exports.addCompilePhase = addCompilePhase;
module.exports.writeCatalog = writeCatalog;
