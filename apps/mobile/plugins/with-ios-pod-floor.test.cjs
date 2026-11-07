const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { compileModsAsync } = require('@expo/config-plugins');
const plugin = require('./with-ios-pod-floor.cjs');
const execute = promisify(execFile);
async function template() {
  const archive = path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz');
  return (await execute('tar', ['-xOzf', archive, 'package/ios/Podfile'])).stdout;
}

test('SDK 54 real Podfile mod persists both floor and idempotent native hook without editing dependency phases', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-pod-plugin-'));
  try {
    await fs.mkdir(path.join(root, 'ios')); const original = await template();
    await fs.writeFile(path.join(root, 'ios/Podfile'), original);
    await fs.writeFile(path.join(root, 'ios/Podfile.properties.json'), JSON.stringify({ 'ios.deploymentTarget': '17.0' }));
    const apply = () => compileModsAsync(plugin({ name: 'Plugin Test', slug: 'plugin-test' }), { projectRoot: root, platforms: ['ios'] });
    await apply(); const first = await fs.readFile(path.join(root, 'ios/Podfile'), 'utf8');
    await apply(); assert.equal(await fs.readFile(path.join(root, 'ios/Podfile'), 'utf8'), first);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'ios/Podfile.properties.json'), 'utf8'))['ios.deploymentTarget'], '17.0');
    assert.equal(first.match(/@generated begin blackcrab-ios-pod-floor/g).length, 1);
    assert.equal(first.replace(/    # @generated begin blackcrab-ios-pod-floor[\s\S]*?    # @generated end blackcrab-ios-pod-floor\n/, ''), original);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('actual Ruby hook raises low native/resource floors, preserves higher versions and rejects symbolic targets', async () => {
  const modified = plugin.applyPodFloor(await template());
  const block = modified.match(/    # @generated begin blackcrab-ios-pod-floor([\s\S]*?)    # @generated end blackcrab-ios-pod-floor/)[1];
  const prelude = `require 'json'\nConfiguration = Struct.new(:build_settings)\nTarget = Struct.new(:name, :build_configurations)\nProject = Struct.new(:targets)\nInstaller = Struct.new(:pods_project)\n`;
  const program = `${prelude}\nvalues = ['12.0', '15.0', '15.1', '15.10', '17.0', nil]\ninstaller = Installer.new(Project.new(values.each_with_index.map { |value, i| Target.new(i == 0 ? 'ReachabilitySwift-ReachabilitySwift' : "target#{i}", [Configuration.new({'IPHONEOS_DEPLOYMENT_TARGET' => value})]) }))\n${block}\nputs JSON.generate(installer.pods_project.targets.map { |target| target.build_configurations[0].build_settings['IPHONEOS_DEPLOYMENT_TARGET'] })`;
  const result = await execute('ruby', ['-e', program]);
  assert.deepEqual(JSON.parse(result.stdout), ['15.1', '15.1', '15.1', '15.10', '17.0', '15.1']);
  await assert.rejects(execute('ruby', ['-e', `${prelude}\ninstaller = Installer.new(Project.new([Target.new('unknown', [Configuration.new({'IPHONEOS_DEPLOYMENT_TARGET' => '$(CUSTOM_FLOOR)'})])]))\n${block}`]), /Unsupported iOS deployment target/);
});

test('fails closed on unknown or duplicated Expo Podfile hooks', async () => {
  assert.throws(() => plugin.applyPodFloor('post_install do |unknown|\nend'), /Unsupported generated/);
  const original = await template(); assert.throws(() => plugin.applyPodFloor(original + '\npost_install do |installer|\nend'), /Unsupported generated/);
  assert.throws(() => plugin.applyPodFloor(original + '\n    # @generated begin blackcrab-ios-pod-floor'), /incomplete/);
});
