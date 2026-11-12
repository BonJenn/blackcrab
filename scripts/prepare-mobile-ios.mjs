#!/usr/bin/env node
/** Isolated, reproducible Expo SDK 58 native preparation; never patches shared dependencies. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cloudConfigFromEnvironment } from '../mobile-experience/activation/adapters/owned-cloud-config.cjs';
import { updateConfigFromEnvironment } from '../mobile-experience/activation/adapters/owned-update-config.cjs';
const execute = promisify(execFile);
const defaultRepo = fileURLToPath(new URL('../', import.meta.url));
const OWN_NEW_FILES = new Set([
  'scripts/prepare-mobile-ios.mjs', 'scripts/prepare-mobile-ios.test.mjs',
  'apps/mobile/plugins/with-ios-pod-floor.cjs', 'apps/mobile/plugins/with-ios-pod-floor.test.cjs',
  'docs/native-ios-build.md',
]);
const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'LICENSE', 'LICENSE.md', 'tsconfig.json', 'managed-host/artifact.mjs', 'managed-host/source.mjs', 'managed-host/controlled-process.mjs', ...OWN_NEW_FILES]);
// Mobile resource generation reuses the host's authenticated cloud patches.
const PREFIXES = ['apps/', 'packages/', 'vendor/t3-mobile/', 'mobile-experience/', 'shared-runtime/', 'managed-host/patches/'];
const EXPECTED_WORKSPACES = ['apps/*', 'packages/*', 'vendor/t3-mobile/packages/*'];
export const NATIVE_INSTALL_INPUT = Object.freeze({
  archive: 'vendor/t3-mobile/apps/mobile/deps/react-native-enriched-markdown-1.2.0-t3.16-29ddd424.tgz',
  lockPath: 'apps/mobile/node_modules/react-native-enriched-markdown', version: '1.2.0-t3.16',
  sha256: '631a02612d42d76710930a1510bdc4403f216e9783ac9233d1aff0df047813d5',
  integrity: 'sha512-Ru0Uuhq4QBphcC73ney0fgNnvr6Lfv+31H2Ij1qxvDejwVyFh/Romc1a1ot9i8/jnmgvAzTZzbPQcdGtQNFayw==',
  scriptEntry: 'package/postinstall.mjs', scriptSha256: '8b88d293d15380d06fb5851437b19b8b791e5941888abed1721501250ae6f683',
});

/** Verify the exact local native installer before npm is allowed to execute it. */
export async function verifyNativeInstallInputs(repoRoot) {
  const repo = await fs.realpath(repoRoot), descriptor = NATIVE_INSTALL_INPUT;
  const policyKey = 'file:' + descriptor.archive;
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  if (JSON.stringify(manifest.allowScripts) !== JSON.stringify({ [policyKey]: true })) throw new Error('Unsupported native install-script policy; only the pinned local native archive is allowed.');
  const archive = path.join(repo, descriptor.archive), stat = await fs.lstat(archive);
  if (!stat.isFile() || stat.nlink !== 1 || await fs.realpath(archive) !== archive) throw new Error('Native install archive must be regular and nonlinked.');
  const bytes = await fs.readFile(archive), lock = JSON.parse(await fs.readFile(path.join(repo, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[descriptor.lockPath];
  if (hash(bytes) !== descriptor.sha256 || 'sha512-' + createHash('sha512').update(bytes).digest('base64') !== descriptor.integrity || entry?.version !== descriptor.version || entry?.resolved !== policyKey || entry?.integrity !== descriptor.integrity) throw new Error('Native install archive or lock provenance changed.');
  const script = (await execute('tar', ['-xOzf', archive, descriptor.scriptEntry], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
  if (hash(script) !== descriptor.scriptSha256) throw new Error('Native postinstall source changed.');
  return { ...descriptor, policyKey };
}

const hash = data => createHash('sha256').update(data).digest('hex');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const selected = file => ROOT_FILES.has(file) || PREFIXES.some(prefix => file.startsWith(prefix));
const confidential = file => file.split('/').some(part => part === '.git' || part === 'node_modules' || part === '.expo' || part === '.env' || part.startsWith('.env.') || ['.npmrc', '.netrc', 'credentials.json', 'google-services.json', 'GoogleService-Info.plist'].includes(part) || /\.(?:pem|key|p12|pfx|mobileprovision)$/i.test(part));
const safeRelative = file => file && !path.isAbsolute(file) && !/[\r\n\0]/.test(file) && file.split('/').every(part => part && part !== '.' && part !== '..');
async function git(repo, args) { return (await execute('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).stdout; }
const split = raw => raw.split('\0').filter(Boolean);

export async function sourceInventory(repoRoot, includeWorkingTree = false) {
  const repo = await fs.realpath(repoRoot);
  if ((await git(repo, ['rev-parse', '--show-toplevel'])).trim() !== repo) throw new Error('Native preparation requires the repository root.');
  const tracked = split(await git(repo, ['ls-files', '-z'])).filter(selected);
  const untracked = split(await git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])).filter(selected).filter(file => !confidential(file));
  const unsupported = untracked.filter(file => !OWN_NEW_FILES.has(file));
  if (unsupported.length) throw new Error(`Unsupported untracked workspace files: ${unsupported.join(', ')}. Commit or move them before native preparation.`);
  const dirty = split(await git(repo, ['diff', '--name-only', '-z', 'HEAD'])).filter(selected);
  if (!includeWorkingTree && (dirty.length || untracked.length)) throw new Error('Relevant workspace changes require --include-working-tree; their exact content hashes will be recorded.');
  const files = [...new Set([...tracked, ...(includeWorkingTree ? untracked : [])])].filter(file => !confidential(file)).sort();
  if (!files.every(safeRelative)) throw new Error('Unsupported repository file path.');
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  if (JSON.stringify(manifest.workspaces) !== JSON.stringify(EXPECTED_WORKSPACES)) throw new Error('Unsupported workspace layout; update native staging explicitly.');
  for (const required of ['package.json', 'package-lock.json', 'apps/mobile/package.json', 'apps/mobile/app.json', 'apps/mobile/plugins/with-ios-pod-floor.cjs']) {
    if (!files.includes(required)) throw new Error(`Missing native build input: ${required}`);
  }
  if (files.some(file => /^apps\/mobile\/(ios|android)\//.test(file))) throw new Error('Tracked native projects are unsupported; this command requires generated Expo native projects.');
  return { repo, files, dirty, revision: (await git(repo, ['rev-parse', 'HEAD'])).trim(), excluded: tracked.filter(confidential) };
}

export async function createSourceSnapshot({ repoRoot = defaultRepo, stagingParent = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), includeWorkingTree = false } = {}) {
  const inventory = await sourceInventory(repoRoot, includeWorkingTree);
  const parent = await fs.realpath(stagingParent);
  if (/\s/.test(parent) || inside(inventory.repo, parent)) throw new Error('Staging parent must be a physical whitespace-free directory outside the repository.');
  const directory = await fs.mkdtemp(path.join(parent, 'blackcrab-ios-'));
  const root = await fs.realpath(directory), repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  const records = [];
  try {
    for (const file of inventory.files) {
      const source = path.join(inventory.repo, file), target = path.join(repo, file);
      const info = await fs.lstat(source);
      if (!info.isFile() || await fs.realpath(source) !== source) throw new Error(`Native staging rejects symlink or non-regular input: ${file}`);
      const bytes = await fs.readFile(source);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { mode: info.mode & 0o777 });
      records.push({ path: file, sha256: hash(bytes), bytes: bytes.length });
    }
    // Detect concurrent edits instead of creating a mixed source/package-lock snapshot.
    const finalInventory = await sourceInventory(inventory.repo, includeWorkingTree);
    if (JSON.stringify(finalInventory.files) !== JSON.stringify(inventory.files) || finalInventory.revision !== inventory.revision) throw new Error('Workspace changed during native snapshot.');
    for (const record of records) if (hash(await fs.readFile(path.join(inventory.repo, record.path))) !== record.sha256) throw new Error('Workspace changed during native snapshot.');
    const metadata = { schemaVersion: 1, revision: inventory.revision, includeWorkingTree, dirty: inventory.dirty, excluded: inventory.excluded, inputs: records };
    await fs.mkdir(path.join(root, 'logs'));
    await fs.mkdir(path.join(root, 'artifacts'));
    await fs.writeFile(path.join(root, 'artifacts', 'source-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
    return { root, repo, metadata };
  } catch (error) { await fs.rm(root, { recursive: true, force: true }); throw error; }
}

/** Arguments go directly to spawn; paths/destinations are never shell-interpolated. */
export async function runLogged(command, args, { cwd, env, log, timeout = 20 * 60_000 } = {}) {
  const handle = await fs.open(log, 'wx');
  await handle.writeFile(JSON.stringify({ command, args, cwd }) + '\n');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', handle.fd, handle.fd] });
      const signalOwned = signal => {
        try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Process already exited. */ }
      };
      let timedOut = false, interrupted = false, killTimer;
      const terminate = () => {
        signalOwned('SIGTERM');
        if (!killTimer) { killTimer = setTimeout(() => signalOwned('SIGKILL'), 5_000); killTimer.unref(); }
      };
      const interrupt = () => { interrupted = true; terminate(); };
      process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
      const removeSignals = () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); };
      const timer = setTimeout(() => { timedOut = true; terminate(); }, timeout);
      timer.unref();
      child.once('error', () => { clearTimeout(timer); clearTimeout(killTimer); removeSignals(); reject(new Error(`Native build tool could not start; see ${log}`)); });
      child.once('exit', code => {
        clearTimeout(timer); clearTimeout(killTimer); removeSignals();
        signalOwned(timedOut || interrupted ? 'SIGKILL' : 'SIGTERM');
        code === 0 && !timedOut && !interrupted ? resolve() : reject(new Error(`Native build tool ${interrupted ? 'was interrupted' : timedOut ? 'timed out' : `exited ${code}`}; see ${log}`));
      });
    });
  } finally { await handle.close(); }
}

export async function verifyNativeDependencyRoots(repo) {
  const physicalRepo = await fs.realpath(repo), require = createRequire(path.join(physicalRepo, 'apps/mobile/package.json'));
  const modules = ['expo', 'react-native', 'react', 'expo-constants', 'expo-updates', 'expo-network', 'expo-file-system', 'expo-secure-store', '@expo/config-plugins', 'expo-modules-core', 'expo-modules-jsi'];
  const resolved = {};
  for (const name of modules) {
    const target = await fs.realpath(require.resolve(`${name}/package.json`));
    if (!inside(physicalRepo, target)) throw new Error(`Native dependency escapes staging: ${name}`);
    resolved[name] = { path: target, version: JSON.parse(await fs.readFile(target, 'utf8')).version };
  }
  if (resolved.expo.version !== '58.0.14' || resolved['react-native'].version !== '0.88.0' || resolved.react.version !== '19.3.0') throw new Error('Unsupported native SDK versions; this preparation targets Expo 58.0.14 / React Native 0.88.0 / React 19.3.0.');
  const coreRequire = createRequire(resolved['expo-modules-core'].path);
  const coreJsiPath = await fs.realpath(coreRequire.resolve('expo-modules-jsi/package.json'));
  if (!inside(physicalRepo, coreJsiPath)) throw new Error('Native dependency escapes staging: expo-modules-jsi from expo-modules-core');
  resolved['expo-modules-core/expo-modules-jsi'] = { path: coreJsiPath, version: JSON.parse(await fs.readFile(coreJsiPath, 'utf8')).version };
  if (resolved['expo-modules-core'].version !== '58.0.22' || resolved['expo-modules-jsi'].version !== '58.0.15' || resolved['expo-modules-core/expo-modules-jsi'].version !== '58.0.15') throw new Error('Unsupported native ABI versions; Expo Modules Core 58.0.22 requires pinned Expo Modules JSI 58.0.15 from both app and Core contexts.');
  // Contracts intentionally has import-only exports; require.resolve would falsely reject it.
  for (const [name, subpath] of [['@t3tools/client-runtime', './connection'], ['@t3tools/contracts', '.']]) {
    const packageRoot = await fs.realpath(path.join(physicalRepo, 'node_modules', name));
    if (!inside(physicalRepo, packageRoot)) throw new Error(`Shared runtime dependency escapes staging: ${name}`);
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const exported = manifest.exports?.[subpath];
    const entry = typeof exported === 'string' ? exported : exported?.import ?? exported?.default;
    if (manifest.name !== name || typeof entry !== 'string' || !entry.startsWith('./')) throw new Error(`Unsupported shared runtime export: ${name}${subpath}`);
    const target = await fs.realpath(path.resolve(packageRoot, entry));
    if (!inside(packageRoot, target)) throw new Error(`Shared runtime export escapes its package: ${name}`);
    resolved[name] = { path: target, version: manifest.version };
  }
  return resolved;
}

export async function verifyGeneratedPodFloor(repo) {
  const require = createRequire(path.join(repo, 'apps/mobile/package.json'));
  const xcode = createRequire(require.resolve('@expo/config-plugins/package.json'))('xcode');
  const project = xcode.project(path.join(repo, 'apps/mobile/ios/Pods/Pods.xcodeproj/project.pbxproj'));
  project.parseSync();
  const objects = project.hash.project.objects;
  let targets = 0, configurations = 0;
  for (const target of Object.values(objects.PBXNativeTarget)) {
    if (!target || typeof target !== 'object') continue;
    targets++;
    const list = objects.XCConfigurationList[target.buildConfigurationList];
    if (!list?.buildConfigurations?.length) throw new Error('Generated pod target has no build configurations.');
    for (const entry of list.buildConfigurations) {
      const value = String(objects.XCBuildConfiguration[entry.value]?.buildSettings?.IPHONEOS_DEPLOYMENT_TARGET ?? '').replace(/^"|"$/g, '');
      if (!/^\d+(?:\.\d+)*$/.test(value)) throw new Error('Generated pod target has an unsupported deployment floor.');
      const [major, minor = 0] = value.split('.').map(Number);
      if (major < 18) throw new Error('Generated pod target is below the iOS 18.0 floor.');
      configurations++;
    }
  }
  if (!targets) throw new Error('No generated pod targets were found.');
  return { targets, configurations, minimum: '18.0' };
}

export function isolatedBuildEnvironment(root, original = process.env) {
  const env = { PATH: path.dirname(process.execPath) + path.delimiter + original.PATH, HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', CI: '1', EXTRA_PACKAGER_ARGS: '--max-workers 2', EXPO_NO_TELEMETRY: '1', EXPO_NO_GIT_STATUS: '1', COCOAPODS_DISABLE_STATS: 'true', NPM_CONFIG_USERCONFIG: path.join(root, 'npm-userconfig'), NPM_CONFIG_GLOBALCONFIG: path.join(root, 'npm-globalconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false' };
  const cloud = cloudConfigFromEnvironment(original);
  if (cloud) Object.assign(env, {
    BLACKCRAB_CLERK_PUBLISHABLE_KEY: cloud.publishableKey,
    BLACKCRAB_CLERK_JWT_TEMPLATE: cloud.jwtTemplate,
    BLACKCRAB_RELAY_URL: cloud.relayUrl,
    ...(cloud.hostedAppUrl ? { BLACKCRAB_HOSTED_APP_URL: cloud.hostedAppUrl } : {}),
  });
  const updates = updateConfigFromEnvironment(original);
  if (updates) Object.assign(env, {
    BLACKCRAB_EAS_PROJECT_ID: updates.projectId,
    BLACKCRAB_UPDATE_CHANNEL: updates.channel,
    BLACKCRAB_MOBILE_UPDATES_ENABLED: updates.enabled ? '1' : '0',
  });
  if (original.DEVELOPER_DIR) env.DEVELOPER_DIR = original.DEVELOPER_DIR;
  return env;
}

/** Xcode can spell /private/tmp as /tmp; Metro needs the physical entry path. */
export async function resolveNativeEntry(repoRoot) {
  const repo = await fs.realpath(repoRoot), mobile = path.join(repo, 'apps/mobile');
  const manifest = JSON.parse(await fs.readFile(path.join(mobile, 'package.json'), 'utf8'));
  if (manifest.main !== 'index.ts') throw new Error('Unsupported native mobile entry; update staging explicitly.');
  const entry = await fs.realpath(path.join(mobile, manifest.main));
  if (!inside(repo, entry) || !(await fs.stat(entry)).isFile()) throw new Error('Native entry escapes the staged workspace.');
  return entry;
}

/** The validation product is an arm64 simulator Release; bound native compilation IO. */
export function simulatorReleaseBuildArguments({ workspace, scheme, destination, derivedData }) {
  return ['-workspace', workspace, '-scheme', scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', destination, '-derivedDataPath', derivedData, '-jobs', '2', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'DEVELOPMENT_TEAM=', 'build'];
}

/** Device distribution uses an explicit team and private signing inputs outside the source snapshot. */
export function deviceSigningArguments({ teamId, appleApiKeyPath, appleApiKeyId, appleApiIssuerId, certificateSha1 }) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '') || !/^[A-Z0-9]{10}$/.test(appleApiKeyId ?? '') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appleApiIssuerId ?? '')) throw new Error('Device archives require an explicit Apple team and App Store Connect API key identifiers.');
  if (!/^[0-9A-F]{40}$/i.test(certificateSha1 ?? '')) throw new Error('Device archives require the SHA-1 of the intended distribution certificate.');
  for (const input of [appleApiKeyPath]) {
    if (typeof input !== 'string' || !path.isAbsolute(input) || /[\s"'\\]/.test(input)) throw new Error('Device signing inputs must use absolute whitespace-free paths.');
  }
  return ['-allowProvisioningUpdates', '-authenticationKeyPath', appleApiKeyPath, '-authenticationKeyID', appleApiKeyId, '-authenticationKeyIssuerID', appleApiIssuerId];
}

export function deviceArchiveArguments({ workspace, scheme, derivedData, archivePath, signing }) {
  deviceSigningArguments(signing);
  return ['-workspace', workspace, '-scheme', scheme, '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-derivedDataPath', derivedData, '-archivePath', archivePath, '-jobs', '2',
    'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=NO', 'CODE_SIGNING_ALLOWED=NO', 'DEVELOPMENT_TEAM=' + signing.teamId, 'archive'];
}

export function deviceExportOptions(teamId) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '')) throw new Error('An explicit Apple team is required for export.');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>' +
    '<key>method</key><string>app-store-connect</string><key>destination</key><string>export</string>' +
    '<key>teamID</key><string>' + teamId + '</string><key>signingStyle</key><string>automatic</string>' +
    '<key>manageAppVersionAndBuildNumber</key><false/><key>stripSwiftSymbols</key><true/><key>uploadSymbols</key><true/>' +
    '</dict></plist>\n';
}

async function validateDeviceSigning(signing, sourceRepo) {
  deviceSigningArguments(signing);
  const source = await fs.realpath(sourceRepo);
  for (const input of [signing.appleApiKeyPath]) {
    const stat = await fs.lstat(input), physical = await fs.realpath(input);
    if (!stat.isFile() || physical !== input || inside(source, physical)) throw new Error('Signing inputs must be physical files outside the source repository.');
    if ((stat.mode & 0o077) !== 0) throw new Error('Signing inputs must be accessible only to their owner.');
  }
}

/** Archive an already prepared private workspace, then sign and verify the exported IPA. */
export async function archivePreparedMobileIos({ report, signing, env, run, artifactDirectory = path.join(report.stage, 'artifacts') }) {
  const mobile = path.join(report.repo, 'apps/mobile');
  await validateDeviceSigning(signing, report.repo);
  await fs.mkdir(artifactDirectory, { recursive: true });
  report.archivePath = path.join(artifactDirectory, 'BlackcrabRemote.xcarchive');
  report.nativeBuild = { sdk: 'iphoneos', configuration: 'Release', architectures: ['arm64'], onlyActiveArch: false, jobs: 2, metroWorkers: 2 };
  await run('device-archive', 'xcodebuild', deviceArchiveArguments({ workspace: report.workspace, scheme: report.scheme, derivedData: report.derivedData, archivePath: report.archivePath, signing: signing }), mobile, 60 * 60_000);
  const products = path.join(report.archivePath, 'Products/Applications');
  const apps = (await fs.readdir(products)).filter(name => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Expected one archived device application.');
  report.deviceApp = path.join(products, apps[0]);
  const bundle = await fs.readFile(path.join(report.deviceApp, 'main.jsbundle'));
  if (bundle.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f') throw new Error('Device archive must contain the standalone Hermes bundle.');
  report.hermesBundle = { bytes: bundle.length, sha256: hash(bundle) };
  const bundleId = (await execute('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(report.deviceApp, 'Info.plist')], { env })).stdout.trim();
  if (bundleId !== 'dev.blackcrab.remote') throw new Error('Device archive bundle ID differs.');
  await exportMobileIosArchive({ report, signing, env, run, artifactDirectory });
}

/** Preserve generated capabilities in an ad-hoc archive before Xcode distribution signing. */
export async function exportMobileIosArchive({ report, signing, env, run, artifactDirectory }) {
  await validateDeviceSigning(signing, report.repo);
  const mobile = path.join(report.repo, 'apps/mobile');
  const targets = [
    { name: 'expo-sharing-extension', bundleId: 'dev.blackcrab.remote.sharing', target: path.join(report.deviceApp, 'PlugIns/expo-sharing-extension.appex') },
    { name: 'ExpoWidgetsTarget', bundleId: 'dev.blackcrab.remote.widgets', target: path.join(report.deviceApp, 'PlugIns/ExpoWidgetsTarget.appex') },
    { name: report.scheme, bundleId: 'dev.blackcrab.remote', target: report.deviceApp },
  ];
  const expectedEntitlements = {};
  for (const { name, bundleId, target } of targets) {
    const identifier = (await execute('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(target, 'Info.plist')], { env })).stdout.trim();
    if (identifier !== bundleId) throw new Error('Archived app or extension identifier differs.');
    const file = path.join(mobile, 'ios', name, name + '.entitlements');
    const configured = JSON.parse((await execute('plutil', ['-convert', 'json', '-o', '-', file], { env })).stdout);
    if (!configured['com.apple.security.application-groups']?.includes('group.dev.blackcrab.remote')) throw new Error('Generated app-group entitlement is missing.');
    expectedEntitlements[bundleId] = { ...configured, ...(configured['aps-environment'] ? { 'aps-environment': 'production' } : {}) };
  }
  // An unsigned export otherwise silently loses the generated capabilities.
  // Sign inner frameworks first, then extensions and the containing app.
  const frameworks = path.join(report.deviceApp, 'Frameworks');
  for (const name of await fs.readdir(frameworks)) {
    if (name.endsWith('.framework') || name.endsWith('.dylib')) await run('archive-framework-entitlements', 'codesign', ['--force', '--sign', '-', '--timestamp=none', path.join(frameworks, name)], mobile);
  }
  for (const { name, target } of targets) await run('archive-app-entitlements', 'codesign', ['--force', '--sign', '-', '--timestamp=none', '--entitlements', path.join(mobile, 'ios', name, name + '.entitlements'), target], mobile);
  report.expectedEntitlements = expectedEntitlements;
  const exportOptions = path.join(artifactDirectory, 'ExportOptions.plist');
  await fs.writeFile(exportOptions, deviceExportOptions(signing.teamId));
  report.exportPath = path.join(artifactDirectory, 'export');
  await run('export-archive', 'xcodebuild', ['-exportArchive', '-archivePath', report.archivePath, '-exportPath', report.exportPath, '-exportOptionsPlist', exportOptions, ...deviceSigningArguments(signing)], mobile, 30 * 60_000);
  const ipas = (await fs.readdir(report.exportPath)).filter(name => name.endsWith('.ipa'));
  if (ipas.length !== 1) throw new Error('Expected one App Store distribution IPA.');
  const ipa = path.join(report.exportPath, ipas[0]), bytes = await fs.readFile(ipa);
  report.ipa = { path: ipa, bytes: bytes.length, sha256: hash(bytes) };
  report.archiveSigning = 'ad-hoc capability preservation; Xcode applies automatic distribution signing during IPA export';
  report.exportedApplication = await verifyExportedDeviceIpa({ ipa, directory: path.join(artifactDirectory, 'export-verification'), signing, env, expectedBuildNumber: report.buildNumber, expectedEntitlements });
  report.signing = { teamId: signing.teamId, certificateSha1: signing.certificateSha1, method: 'app-store-connect', style: 'automatic', bundleId: 'dev.blackcrab.remote', uploaded: false };
}

export function verifyDistributionEntitlements(actual, { teamId, bundleId, configured }) {
  if (actual['application-identifier'] !== teamId + '.' + bundleId || actual['get-task-allow'] !== false || !actual['com.apple.security.application-groups']?.includes('group.dev.blackcrab.remote')) throw new Error('Exported distribution entitlements differ.');
  for (const [key, value] of Object.entries(configured)) {
    const present = actual[key];
    if (Array.isArray(value) ? !Array.isArray(present) || value.some(item => !present.includes(item)) : present !== value) throw new Error('Exported distribution entitlement missing or changed: ' + key);
  }
}

/** Verify the distribution product, including extension identity and non-debug entitlements. */
export async function verifyExportedDeviceIpa({ ipa, directory, signing, env, expectedBuildNumber, expectedEntitlements }) {
  if (!/^[1-9][0-9]{0,8}$/.test(expectedBuildNumber ?? '')) throw new Error('Expected distribution build number is required.');
  if (!expectedEntitlements || ['dev.blackcrab.remote', 'dev.blackcrab.remote.sharing', 'dev.blackcrab.remote.widgets'].some(id => !expectedEntitlements[id])) throw new Error('Generated entitlement expectations are required for all targets.');
  await fs.mkdir(directory);
  await execute('ditto', ['-x', '-k', ipa, directory], { env });
  const payload = path.join(directory, 'Payload');
  const apps = (await fs.readdir(payload)).filter(name => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Expected one exported application.');
  const app = path.join(payload, apps[0]);
  await execute('codesign', ['--verify', '--deep', '--strict', app], { env });
  const plugins = path.join(app, 'PlugIns');
  const extensions = (await fs.readdir(plugins)).filter(name => name.endsWith('.appex')).map(name => path.join(plugins, name));
  const expected = new Set(['dev.blackcrab.remote', 'dev.blackcrab.remote.sharing', 'dev.blackcrab.remote.widgets']);
  const verified = [];
  for (const target of [app, ...extensions]) {
    const bundleId = (await execute('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(target, 'Info.plist')], { env })).stdout.trim();
    if (!expected.delete(bundleId)) throw new Error('Unexpected or duplicate exported bundle identifier.');
    const identity = await execute('codesign', ['-d', '--verbose=4', target], { env });
    if (!identity.stderr.split('\n').includes('TeamIdentifier=' + signing.teamId)) throw new Error('Exported signing team differs.');
    const certificatePrefix = path.join(directory, bundleId + '.certificate');
    await execute('codesign', ['-d', '--extract-certificates=' + certificatePrefix, target], { env });
    const certificateSha1 = createHash('sha1').update(await fs.readFile(certificatePrefix + '0')).digest('hex').toUpperCase();
    if (certificateSha1 !== signing.certificateSha1.toUpperCase()) throw new Error('Exported distribution certificate differs.');
    const entitlements = await execute('codesign', ['-d', '--entitlements', ':-', target], { env });
    const file = path.join(directory, bundleId + '.entitlements.plist');
    await fs.writeFile(file, entitlements.stdout, { mode: 0o600 });
    const decoded = JSON.parse((await execute('plutil', ['-convert', 'json', '-o', '-', file], { env })).stdout);
    verifyDistributionEntitlements(decoded, { teamId: signing.teamId, bundleId, configured: expectedEntitlements[bundleId] });
    const buildNumber = (await execute('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', path.join(target, 'Info.plist')], { env })).stdout.trim();
    if (buildNumber !== expectedBuildNumber) throw new Error('Exported app or extension build number differs.');
    verified.push({ bundleId, buildNumber, certificateSha1, entitlementsVerified: true });
  }
  if (expected.size) throw new Error('The exported app is missing a required extension.');
  return { path: app, targets: verified, distributionSignaturesVerified: true };
}

/** Explicit caches must already exist outside the source repo; npm receives the canonical path. */
export async function resolveNpmCache(stageRoot, sourceRepo, requested) {
  const source = await fs.realpath(sourceRepo);
  let cache;
  if (requested) cache = await fs.realpath(requested);
  else {
    const stage = await fs.realpath(stageRoot);
    if (inside(source, stage)) throw new Error('Npm cache must be outside the source repository.');
    cache = path.join(stage, 'npm-cache'); await fs.mkdir(cache, { recursive: true });
  }
  if (inside(source, cache) || !(await fs.stat(cache)).isDirectory()) throw new Error('Npm cache must be a directory outside the source repository.');
  return cache;
}

export async function prepareMobileIos(options = {}) {
  if (process.platform !== 'darwin') throw new Error('Native iOS preparation requires macOS and installed Xcode/CocoaPods.');
  if(process.version!=='v26.12.1')throw new Error('Native SDK58 preparation requires Node 26.12.1.');
  const { mode = 'prepare', destination = 'generic/platform=iOS Simulator' } = options;
  if (!['prepare', 'build', 'archive'].includes(mode)) throw new Error('Use --mode prepare, build or archive.');
  if (mode === 'archive') {
    if (options.destination) throw new Error('Device archives use the generic iOS destination.');
    await validateDeviceSigning(options.signing ?? {}, options.repoRoot ?? defaultRepo);
    if (!/^[1-9][0-9]{0,8}$/.test(options.buildNumber ?? '')) throw new Error('Device archives require a positive --build-number chosen from App Store Connect.');
  }
  const stage = await createSourceSnapshot(options), mobile = path.join(stage.repo, 'apps/mobile');
  const env = isolatedBuildEnvironment(stage.root);
  if (mode === 'archive') {
    const configPath = path.join(mobile, 'app.json'), config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.expo.ios = { ...config.expo.ios, buildNumber: options.buildNumber, appleTeamId: options.signing.teamId };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  }
  await Promise.all([fs.mkdir(env.HOME), fs.mkdir(env.TMPDIR), fs.writeFile(env.NPM_CONFIG_USERCONFIG, '', { mode: 0o600 }), fs.writeFile(env.NPM_CONFIG_GLOBALCONFIG, '', { mode: 0o600 })]);
  const report = { schemaVersion: 1, mode, stage: stage.root, repo: stage.repo, sourceManifest: path.join(stage.root, 'artifacts/source-manifest.json'), logs: path.join(stage.root, 'logs'), status: 'running', executedOnDevice: false, ...(mode === 'archive' ? { buildNumber: options.buildNumber, appConfigOverrides: { ios: { buildNumber: options.buildNumber, appleTeamId: options.signing.teamId } } } : {}) };
  const reportPath = path.join(stage.root, 'artifacts/build-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const npmCommand=options.npmCli?process.execPath:'npm';
  const npmArgs=args=>options.npmCli?[path.resolve(options.npmCli),...args]:args;
  let step = 0;
  const run = (name, command, args, cwd = stage.repo, timeout) => runLogged(command, args, { cwd, env, timeout, log: path.join(report.logs, `${String(++step).padStart(2, '0')}-${name}.log`) });
  try {
    report.npmCache = await resolveNpmCache(stage.root, options.repoRoot ?? defaultRepo, options.npmCache);
    await run('node-version', process.execPath, ['--version']);
    await run('npm-version', npmCommand, npmArgs(['--version']));
    const npmVersion=(await execute(npmCommand,npmArgs(['--version']),{env})).stdout.trim();if(npmVersion!=='12.2.2')throw new Error('Native SDK58 preparation requires npm 12.2.2 (use --npm-cli for an isolated CLI).');
    await run('xcode-version', 'xcodebuild', ['-version']);
    await run('pod-version', 'pod', ['--version']);
    report.nativeInstallPolicy = await verifyNativeInstallInputs(stage.repo);
    await run('npm-ci', npmCommand, npmArgs(['ci', '--no-audit', '--no-fund', '--cache', report.npmCache]));
    // A matching lock digest is insufficient when a private clone omits a
    // workspace's nested install tree and silently resolves a hoisted fallback.
    const {verifyInstalledGraph}=await import(pathToFileURL(path.join(stage.repo,'mobile-experience/installed-graph.mjs')).href);
    try { report.installedGraph=await verifyInstalledGraph({repoRoot:stage.repo}); }
    catch(error) { if(error.report) report.installedGraph=error.report; throw error; }

    const {applyOwnedMobileBuildPatches,applyExpoModuleScannerBuildPatch}=await import(pathToFileURL(path.join(stage.repo,'mobile-experience/build-patches.mjs')).href);report.ownedBuildPatches=[await applyOwnedMobileBuildPatches({repoRoot:stage.repo}),await applyExpoModuleScannerBuildPatch({repoRoot:stage.repo})];
    const {collectNativeAssetInputs}=await import(pathToFileURL(path.join(stage.repo,'mobile-experience/native-assets.mjs')).href);
    const nativeAssets=await collectNativeAssetInputs(stage.repo);report.nativeAssetInputs=path.join(stage.root,'artifacts/native-asset-inputs.json');await fs.writeFile(report.nativeAssetInputs,JSON.stringify(nativeAssets,null,2)+'\n');report.nativeAssetInputsSha256=hash(await fs.readFile(report.nativeAssetInputs));
    report.dependencies = await verifyNativeDependencyRoots(stage.repo);
    await run('mobile-resources', process.execPath, ['mobile-experience/resources-cli.mjs']);
    const {verifyMobileReactCompiler}=await import(pathToFileURL(path.join(stage.repo,'mobile-experience/react-compiler.mjs')).href);
    report.reactCompiler=verifyMobileReactCompiler({repoRoot:stage.repo});
    await fs.writeFile(path.join(stage.root,'artifacts/react-compiler-proof.json'),JSON.stringify(report.reactCompiler,null,2)+'\n');
    report.mobileResources = path.join(mobile, '.generated/RESOURCE-MANIFEST.json');
    report.mobileResourcesSha256 = hash(await fs.readFile(report.mobileResources));

    const require = createRequire(path.join(mobile, 'package.json'));
    await run('expo-prebuild', process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install'], mobile);
    await run('pod-install', 'pod', ['install', '--project-directory=' + path.join(mobile, 'ios')], mobile);
    report.podFloor = await verifyGeneratedPodFloor(stage.repo);
    const workspaces = (await fs.readdir(path.join(mobile, 'ios'))).filter(name => name.endsWith('.xcworkspace'));
    if (workspaces.length !== 1) throw new Error('Expected one generated iOS workspace.');
    report.workspace = path.join(mobile, 'ios', workspaces[0]); report.scheme = workspaces[0].slice(0, -'.xcworkspace'.length);
    report.podfileLockSha256 = hash(await fs.readFile(path.join(mobile, 'ios/Podfile.lock')));
    if (mode === 'build' || mode === 'archive') {
      report.entryFile = await resolveNativeEntry(stage.repo);
      env.ENTRY_FILE = report.entryFile;
      const parent = options.derivedDataParent ? await fs.realpath(options.derivedDataParent) : stage.root;
      report.derivedData = await fs.mkdtemp(path.join(parent, 'blackcrab-ios-derived-'));
      if (mode === 'build') {
        report.nativeBuild = { sdk: 'iphonesimulator', configuration: 'Release', architectures: ['arm64'], onlyActiveArch: true, jobs: 2, metroWorkers: 2 };
        report.nativeBuild.arguments = simulatorReleaseBuildArguments({ workspace: report.workspace, scheme: report.scheme, destination, derivedData: report.derivedData });
        await run('xcodebuild', 'xcodebuild', report.nativeBuild.arguments, mobile, 60 * 60_000);
        report.products = path.join(report.derivedData, 'Build/Products/Release-iphonesimulator');
        const apps = (await fs.readdir(report.products)).filter(name => name.endsWith('.app'));
        if (apps.length !== 1) throw new Error('Expected one simulator application product.');
        report.simulatorApp = path.join(report.products, apps[0]);
        const bundlePath = path.join(report.simulatorApp, 'main.jsbundle');
        const bundle = await fs.readFile(bundlePath);
        if (bundle.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f') throw new Error('Expected an embedded standalone Hermes product bundle.');
        report.hermesBundle = { path: bundlePath, bytes: bundle.length, sha256: hash(bundle) };
        await run('codesign-verify', 'codesign', ['--verify', '--deep', '--strict', report.simulatorApp], mobile);
        report.signing = 'Xcode ad-hoc simulator signing; not distribution signing';
      } else {
        await archivePreparedMobileIos({ report, signing: options.signing, env, run });
      }
    }
    const swiftPins=path.join(report.workspace,'xcshareddata/swiftpm/Package.resolved');try{const bytes=await fs.readFile(swiftPins);report.swiftPackagePins=JSON.parse(bytes);report.swiftPackagePinsSha256=hash(bytes);}catch(error){if(error.code!=='ENOENT')throw error;}
    report.status = mode === 'archive' ? 'archived' : mode === 'build' ? 'built' : 'prepared';
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    return { ...report, reportPath };
  } catch (error) {
    report.status = 'failed';
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    throw new Error(`Native iOS ${mode} failed. Retained isolated inputs and logs at ${stage.root}. ${error.message}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'prepare' }, 'include-working-tree': { type: 'boolean', default: false },
    'build-number': { type: 'string' }, 'team-id': { type: 'string' }, 'signing-certificate': { type: 'string' }, 'apple-api-key-path': { type: 'string' }, 'apple-api-key-id': { type: 'string' }, 'apple-api-issuer-id': { type: 'string' },
    'npm-cli': { type: 'string' }, 'npm-cache': { type: 'string' }, 'staging-parent': { type: 'string' }, 'derived-data-parent': { type: 'string' }, destination: { type: 'string' },
  } });
  try {
    console.log(JSON.stringify(await prepareMobileIos({ mode: values.mode, includeWorkingTree: values['include-working-tree'], npmCli: values['npm-cli'], npmCache: values['npm-cache'], stagingParent: values['staging-parent'], derivedDataParent: values['derived-data-parent'], destination: values.destination, buildNumber: values['build-number'], signing: { teamId: values['team-id'], certificateSha1: values['signing-certificate'], appleApiKeyPath: values['apple-api-key-path'], appleApiKeyId: values['apple-api-key-id'], appleApiIssuerId: values['apple-api-issuer-id'] } }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
