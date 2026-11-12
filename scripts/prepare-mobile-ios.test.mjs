import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { configureOwnedCloud } from '../mobile-experience/activation/adapters/owned-cloud-config.cjs';
import { configureOwnedUpdates } from '../mobile-experience/activation/adapters/owned-update-config.cjs';
import { createSourceSnapshot, isolatedBuildEnvironment, runLogged, resolveNativeEntry, sourceInventory, verifyNativeDependencyRoots, simulatorReleaseBuildArguments, resolveNpmCache, verifyNativeInstallInputs, NATIVE_INSTALL_INPUT } from './prepare-mobile-ios.mjs';
const execute = promisify(execFile);
async function fixture(run) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-ios-test-'));
  const repo = path.join(base, 'source with spaces');
  await fs.mkdir(repo);
  const write = async (file, contents) => { await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await fs.writeFile(path.join(repo, file), typeof contents === 'string' ? contents : JSON.stringify(contents)); };
  await write('package.json', { workspaces: ['apps/*', 'packages/*', 'vendor/t3-mobile/packages/*'] });
  await write('package-lock.json', { lockfileVersion: 3 });
  await write('apps/mobile/package.json', { name: '@blackcrab/mobile' });
  await write('apps/mobile/app.json', { expo: {} });
  await write('apps/mobile/plugins/with-ios-pod-floor.cjs', '// fixture build plugin');
  await write('vendor/t3-mobile/packages/contracts/src/index.ts', '// source');
  await write('apps/mobile/.env', 'PRIVATE_TOKEN=do-not-copy');
  await write('.npmrc', '//registry/:_authToken=do-not-copy');
  await write('src-tauri/desktop-only.rs', '// excluded desktop source');
  await execute('git', ['init', '-q', repo]);
  await execute('git', ['-C', repo, 'add', '.']);
  await execute('git', ['-C', repo, '-c', 'user.name=Native Test', '-c', 'user.email=native@example.invalid', 'commit', '-qm', 'fixture']);
  try { await run({ base, repo, write }); } finally { await fs.rm(base, { recursive: true, force: true }); }
}

test('physically snapshots tracked workspaces from spaced source; excludes credentials, metadata and desktop inputs', async () => fixture(async ({ repo, base }) => {
  const snapshot = await createSourceSnapshot({ repoRoot: repo, stagingParent: base });
  assert.doesNotMatch(snapshot.root, /\s/);
  assert.equal(await fs.realpath(snapshot.root), snapshot.root);
  assert.equal(await fs.readFile(path.join(snapshot.repo, 'vendor/t3-mobile/packages/contracts/src/index.ts'), 'utf8'), '// source');
  for (const excluded of ['.git', '.npmrc', 'apps/mobile/.env', 'src-tauri']) await assert.rejects(fs.stat(path.join(snapshot.repo, excluded)), { code: 'ENOENT' });
  assert(snapshot.metadata.excluded.includes('apps/mobile/.env'));
  assert(!JSON.stringify(snapshot.metadata).includes('do-not-copy'));
  await fs.writeFile(path.join(snapshot.repo, 'apps/mobile/app.json'), 'changed only in stage');
  assert.equal(await fs.readFile(path.join(repo, 'apps/mobile/app.json'), 'utf8'), '{"expo":{}}');
}));

test('isolated snapshot can apply and validate the mobile cloud patches without the original checkout', async () => fixture(async ({ repo, base }) => {
  // Exercise the production modules after staging: importing from the checkout
  // would hide missing transitive modules and registry payloads in the snapshot.
  const inputs = ['mobile-experience/cloud-source-patches.mjs', 'managed-host/source.mjs', 'managed-host/artifact.mjs', 'managed-host/patches'];
  // The service stack adds this helper; the standalone patch runner does not use it.
  // Importing the staged runner below still detects any omitted required dependency.
  const controlledProcess = 'managed-host/controlled-process.mjs';
  try {
    await fs.stat(new URL('../' + controlledProcess, import.meta.url));
    inputs.push(controlledProcess);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const file of inputs) {
    const target = path.join(repo, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(new URL('../' + file, import.meta.url), target, { recursive: true });
  }
  await execute('git', ['-C', repo, 'add', '.']);
  await execute('git', ['-C', repo, '-c', 'user.name=Native Test', '-c', 'user.email=native@example.invalid', 'commit', '-qm', 'mobile cloud build inputs']);
  const snapshot = await createSourceSnapshot({ repoRoot: repo, stagingParent: base });
  const staged = await import(pathToFileURL(path.join(snapshot.repo, 'mobile-experience/cloud-source-patches.mjs')).href);
  const records = await staged.mobileCloudPatchRecords();
  assert.equal(records.length, 12);
  for (const record of records) {
    assert.equal(record.replacements.length, 1);
    const target = path.join(snapshot.repo, record.target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, record.replacements[0].before);
  }
  const result = await staged.applyMobileCloudSourcePatches(snapshot.repo);
  for (const [index, patch] of result.patches.entries()) {
    await staged.validateMobileCloudSourcePatch(result.originals[index].bytes, await fs.readFile(path.join(snapshot.repo, patch.target)), patch);
  }
}));

test('requires explicit dirty snapshot and records actual content; refuses arbitrary new workspace inputs', async () => fixture(async ({ repo, base, write }) => {
  await write('apps/mobile/app.json', { expo: { name: 'changed' } });
  await write('scripts/prepare-mobile-ios.mjs', '// authorized new build helper');
  await assert.rejects(createSourceSnapshot({ repoRoot: repo, stagingParent: base }), /--include-working-tree/);
  const snapshot = await createSourceSnapshot({ repoRoot: repo, stagingParent: base, includeWorkingTree: true });
  assert(snapshot.metadata.dirty.includes('apps/mobile/app.json'));
  assert(snapshot.metadata.inputs.some(input => input.path === 'scripts/prepare-mobile-ios.mjs' && /^[a-f0-9]{64}$/.test(input.sha256)));
  assert.match(await fs.readFile(path.join(snapshot.repo, 'apps/mobile/app.json'), 'utf8'), /changed/);
  await write('apps/mobile/unreviewed-user-file.json', '{}');
  await assert.rejects(sourceInventory(repo, true), /Unsupported untracked workspace files/);
}));

test('rejects symlink inputs and staging aliases whose physical path contains spaces', async () => fixture(async ({ repo, base }) => {
  const link = path.join(repo, 'apps/mobile/symlink.ts');
  await fs.symlink(path.join(repo, 'apps/mobile/app.json'), link);
  await execute('git', ['-C', repo, 'add', 'apps/mobile/symlink.ts']);
  await assert.rejects(createSourceSnapshot({ repoRoot: repo, stagingParent: base, includeWorkingTree: true }), /rejects symlink/);
  await fs.rm(link); await execute('git', ['-C', repo, 'reset', '-q', 'HEAD', '--', 'apps/mobile/symlink.ts']);
  const spaced = path.join(base, 'physical space'), alias = path.join(base, 'alias'); await fs.mkdir(spaced); await fs.symlink(spaced, alias);
  await assert.rejects(createSourceSnapshot({ repoRoot: repo, stagingParent: alias }), /physical whitespace-free/);
}));

test('fails if resolved native dependencies point into a shared installation', async () => fixture(async ({ repo, base, write }) => {
  const external = path.join(base, 'shared-expo'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'package.json'), '{"name":"expo","version":"58.0.14"}');
  await fs.mkdir(path.join(repo, 'node_modules')); await fs.symlink(external, path.join(repo, 'node_modules/expo'));
  await assert.rejects(verifyNativeDependencyRoots(repo), /escapes staging: expo/);
}));

test('native commands preserve shell metacharacters as inert arguments and failures retain logs', async () => fixture(async ({ base }) => {
  const log = path.join(base, 'command with spaces.log'), marker = path.join(base, 'must-not-exist');
  const value = `$(touch ${marker}); literal argument`;
  await runLogged(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value], { cwd: base, env: isolatedBuildEnvironment(base), log });
  assert((await fs.readFile(log, 'utf8')).endsWith(value)); await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  const failure = path.join(base, 'failure.log');
  await assert.rejects(runLogged(process.execPath, ['-e', 'console.error("diagnostic");process.exit(3)'], { cwd: base, log: failure }), /exited 3/);
  assert.match(await fs.readFile(failure, 'utf8'), /diagnostic/);
}));

test('build environment excludes account/provider/npm credentials and user startup files', () => {
  const env = isolatedBuildEnvironment('/isolated', { PATH: '/tools', HOME: '/user', ANTHROPIC_API_KEY: 'private', EXPO_TOKEN: 'private', NPM_TOKEN: 'private', NODE_OPTIONS: '--require=/user/code', DEVELOPER_DIR: '/Xcode.app/Contents/Developer' });
  assert.equal(env.HOME, '/isolated/home'); assert.equal(env.DEVELOPER_DIR, '/Xcode.app/Contents/Developer');
  assert.equal(env.EXTRA_PACKAGER_ARGS, '--max-workers 2');
  for (const key of ['ANTHROPIC_API_KEY', 'EXPO_TOKEN', 'NPM_TOKEN', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
});

test('timeout terminates the owned command group and retains its diagnostic log', async () => fixture(async ({ base }) => {
  const log = path.join(base, 'timeout.log');
  await assert.rejects(runLogged(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { cwd: base, log, timeout: 100 }), /timed out/);
  assert.match(await fs.readFile(log, 'utf8'), /SIGTERM/);
}));

test('accepts source import-only exports and rejects a shared export symlink outside its package', async () => fixture(async ({ repo, base, write }) => {
  const packages = ['expo', 'react-native', 'react', 'expo-constants', 'expo-updates', 'expo-network', 'expo-file-system', 'expo-secure-store', '@expo/config-plugins', 'expo-modules-core', 'expo-modules-jsi'];
  for (const name of packages) await write(`node_modules/${name}/package.json`, { name, version: name === 'expo' ? '58.0.14' : name === 'react-native' ? '0.88.0' : name === 'react' ? '19.3.0' : name === 'expo-modules-core' ? '58.0.22' : name === 'expo-modules-jsi' ? '58.0.15' : '1.0.0' });
  for (const [name, subpath] of [['@t3tools/contracts', '.'], ['@t3tools/client-runtime', './connection']]) {
    await write(`node_modules/${name}/package.json`, { name, exports: { [subpath]: { import: './src/index.ts' } } });
    await write(`node_modules/${name}/src/index.ts`, '// exact source export');
  }
  const resolved = await verifyNativeDependencyRoots(repo);
  assert.match(resolved['@t3tools/contracts'].path, /src\/index.ts$/);
  assert.equal(resolved['expo-modules-core/expo-modules-jsi'].version, '58.0.15');
  await write('node_modules/expo-modules-core/node_modules/expo-modules-jsi/package.json', { name: 'expo-modules-jsi', version: '58.0.22' });
  await assert.rejects(execute(process.execPath, ['--input-type=module', '-e', `import {verifyNativeDependencyRoots} from ${JSON.stringify(new URL('./prepare-mobile-ios.mjs', import.meta.url).href)}; await verifyNativeDependencyRoots(${JSON.stringify(repo)});`]), /Unsupported native ABI/);
  await fs.rm(path.join(repo, 'node_modules/expo-modules-core/node_modules'), { recursive: true });
  await write('node_modules/expo-modules-jsi/package.json', { name: 'expo-modules-jsi', version: '58.0.22' });
  await assert.rejects(execute(process.execPath, ['--input-type=module', '-e', `import {verifyNativeDependencyRoots} from ${JSON.stringify(new URL('./prepare-mobile-ios.mjs', import.meta.url).href)}; await verifyNativeDependencyRoots(${JSON.stringify(repo)});`]), /Unsupported native ABI/);
  await write('node_modules/expo-modules-jsi/package.json', { name: 'expo-modules-jsi', version: '58.0.15' });

  const outside = path.join(base, 'external-source.ts'); await fs.writeFile(outside, '// external');
  const entry = path.join(repo, 'node_modules/@t3tools/contracts/src/index.ts'); await fs.rm(entry); await fs.symlink(outside, entry);
  await assert.rejects(verifyNativeDependencyRoots(repo), /export escapes its package/);
}));


test('native entry canonicalizes logical aliases before Metro and refuses entries outside the snapshot', async () => fixture(async ({ repo, base, write }) => {
  await write('apps/mobile/package.json', { name: '@blackcrab/mobile', main: 'index.ts' });
  await write('apps/mobile/index.ts', '// native product entry');
  const alias = path.join(base, 'logical-alias'); await fs.symlink(repo, alias);
  assert.equal(await resolveNativeEntry(alias), await fs.realpath(path.join(repo, 'apps/mobile/index.ts')));
  const outside = path.join(base, 'outside.ts'); await fs.writeFile(outside, '// outside');
  await fs.rm(path.join(repo, 'apps/mobile/index.ts')); await fs.symlink(outside, path.join(repo, 'apps/mobile/index.ts'));
  await assert.rejects(resolveNativeEntry(repo), /entry escapes/);
}));

test('Release producer bounds native compilation and records a single supported simulator architecture', () => {
  const args = simulatorReleaseBuildArguments({ workspace: '/stage/Remote.xcworkspace', scheme: 'Remote', destination: 'generic/platform=iOS Simulator', derivedData: '/external/DerivedData' });
  assert.equal(args[args.indexOf('-jobs') + 1], '2');
  assert.equal(args[args.indexOf('-sdk') + 1], 'iphonesimulator');
  assert.ok(args.includes('ARCHS=arm64')); assert.ok(args.includes('ONLY_ACTIVE_ARCH=YES'));
  assert.equal(args[args.indexOf('-configuration') + 1], 'Release');
  assert.ok(args.includes('CODE_SIGNING_ALLOWED=YES'));
});

test('explicit npm cache is canonical, existing, and outside the source repository', async () => fixture(async ({ repo, base }) => {
  const stage = path.join(base, 'stage'), external = path.join(base, 'external-cache'), alias = path.join(base, 'cache-alias');
  await fs.mkdir(stage); await fs.mkdir(external); await fs.symlink(external, alias);
  assert.equal(await resolveNpmCache(stage, repo, alias), await fs.realpath(external));
  assert.equal(await resolveNpmCache(stage, repo), path.join(await fs.realpath(stage), 'npm-cache'));
  await assert.rejects(resolveNpmCache(stage, repo, repo), /outside the source repository/);
  const sourceAlias = path.join(base, 'source-cache-alias'); await fs.symlink(repo, sourceAlias);
  await assert.rejects(resolveNpmCache(stage, repo, sourceAlias), /outside the source repository/);
  await assert.rejects(resolveNpmCache(stage, repo, path.join(base, 'missing-cache')), /ENOENT/);
}));

test('native lifecycle approval is limited to the authenticated local archive and exact lock', async () => fixture(async ({ repo, base, write }) => {
  const d = NATIVE_INSTALL_INPUT, key = 'file:' + d.archive;
  await write('package.json', { allowScripts: { [key]: true } });
  const lock = { packages: { [d.lockPath]: { version: d.version, resolved: key, integrity: d.integrity } } };
  await write('package-lock.json', lock);
  const archive = path.join(repo, d.archive); await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.copyFile(new URL('../' + d.archive, import.meta.url), archive);
  assert.equal((await verifyNativeInstallInputs(repo)).scriptSha256, d.scriptSha256);
  await write('package.json', { allowScripts: { [key]: true, '*': true } });
  await assert.rejects(verifyNativeInstallInputs(repo), /Unsupported native install-script policy/);
  await write('package.json', { allowScripts: { [key]: true } });
  lock.packages[d.lockPath].integrity = 'sha512-unreviewed'; await write('package-lock.json', lock);
  await assert.rejects(verifyNativeInstallInputs(repo), /lock provenance changed/);
  lock.packages[d.lockPath].integrity = d.integrity; await write('package-lock.json', lock);
  await fs.appendFile(archive, 'changed'); await assert.rejects(verifyNativeInstallInputs(repo), /archive or lock provenance changed/);
  await fs.rm(archive); const external = path.join(base, 'external.tgz');
  await fs.copyFile(new URL('../' + d.archive, import.meta.url), external); await fs.symlink(external, archive);
  await assert.rejects(verifyNativeInstallInputs(repo), /regular and nonlinked/);
}));

test('checked-in lifecycle policy authenticates the actual pinned native archive', async () => {
  const checked = await verifyNativeInstallInputs(new URL('../', import.meta.url));
  assert.equal(checked.integrity, NATIVE_INSTALL_INPUT.integrity);
});


test('native builds carry only validated Blackcrab public cloud configuration', () => {
  const env = isolatedBuildEnvironment('/owned', { PATH: '/bin', BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture_only', BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay', BLACKCRAB_RELAY_URL: 'https://relay.example.test/', CLERK_SECRET_KEY: 'private', T3CODE_RELAY_URL: 'https://foreign.example.test' });
  assert.equal(env.BLACKCRAB_CLERK_PUBLISHABLE_KEY, 'pk_test_fixture_only');
  assert.equal(env.BLACKCRAB_CLERK_JWT_TEMPLATE, 'blackcrab-relay');
  assert.equal(env.BLACKCRAB_RELAY_URL, 'https://relay.example.test');
  assert.equal(env.CLERK_SECRET_KEY, undefined); assert.equal(env.T3CODE_RELAY_URL, undefined);
  assert.throws(() => isolatedBuildEnvironment('/owned', { PATH: '/bin', BLACKCRAB_RELAY_URL: 'https://relay.example.test' }), /Incomplete Blackcrab/);
});

test('isolated native builds retain hosted links and domain association through Expo configuration', () => {
  const env = isolatedBuildEnvironment('/owned', { PATH: '/bin', BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture_only', BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay', BLACKCRAB_RELAY_URL: 'https://relay.example.test', BLACKCRAB_HOSTED_APP_URL: 'https://app.example.test/' });
  const config = configureOwnedCloud({}, env);
  assert.equal(config.extra.blackcrabCloud.hostedAppUrl, 'https://app.example.test');
  assert.deepEqual(config.ios.associatedDomains, ['applinks:app.example.test']);
  assert.equal(config.android.intentFilters[0].data[0].host, 'app.example.test');
  assert.equal(isolatedBuildEnvironment('/owned', { PATH: '/bin', T3CODE_HOSTED_APP_URL: 'https://foreign.example.test' }).BLACKCRAB_HOSTED_APP_URL, undefined);
  assert.throws(() => isolatedBuildEnvironment('/owned', { ...env, BLACKCRAB_HOSTED_APP_URL: 'https://app.example.test/path' }), /BLACKCRAB_HOSTED_APP_URL must be an HTTPS origin/);
});

test('isolated native builds retain only validated public Expo update inputs', () => {
  const projectId = '11111111-2222-4333-8444-555555555555';
  const original = {
    PATH: '/bin', BLACKCRAB_EAS_PROJECT_ID: projectId,
    BLACKCRAB_UPDATE_CHANNEL: 'production', EAS_BUILD_PROFILE: 'production',
    EXPO_TOKEN: 'private', EAS_PROJECT_ID: 'foreign', T3CODE_MOBILE_UPDATES_ENABLED: '1',
  };
  for (const enabled of ['0', '1']) {
    const env = isolatedBuildEnvironment('/owned', { ...original, BLACKCRAB_MOBILE_UPDATES_ENABLED: enabled });
    const config = configureOwnedUpdates({}, env);
    assert.equal(env.BLACKCRAB_MOBILE_UPDATES_ENABLED, enabled);
    assert.equal(config.updates.enabled, enabled === '1');
    assert.equal(config.updates.url, 'https://u.expo.dev/' + projectId);
    assert.deepEqual(config.updates.requestHeaders, { 'expo-channel-name': 'production' });
    assert.deepEqual(config.runtimeVersion, { policy: 'fingerprint' });
    for (const key of ['EXPO_TOKEN', 'EAS_PROJECT_ID', 'T3CODE_MOBILE_UPDATES_ENABLED']) assert.equal(env[key], undefined);
  }
  assert.equal(configureOwnedUpdates({}, isolatedBuildEnvironment('/owned', { PATH: '/bin' })).updates.enabled, false);
  assert.throws(() => isolatedBuildEnvironment('/owned', { ...original, BLACKCRAB_UPDATE_CHANNEL: undefined }), /require BLACKCRAB_EAS_PROJECT_ID/);
  assert.throws(() => isolatedBuildEnvironment('/owned', { ...original, BLACKCRAB_UPDATE_CHANNEL: 'preview' }), /must match/);
  assert.throws(() => isolatedBuildEnvironment('/owned', { ...original, BLACKCRAB_EAS_PROJECT_ID: 'invalid' }), /must be the UUID/);
});

test('device archive defers signing to export and requires an explicit distribution certificate', async () => {
  const { deviceArchiveArguments, deviceSigningArguments, deviceExportOptions } = await import('./prepare-mobile-ios.mjs');
  const signing = { certificateSha1: 'A'.repeat(40), teamId: 'YF28W3NGG6', appleApiKeyPath: '/private/tmp/signing/AuthKey.p8', appleApiKeyId: 'ABCDEFGHIJ', appleApiIssuerId: '12345678-1234-1234-1234-123456789abc' };
  const args = deviceArchiveArguments({ workspace: '/private/tmp/mobile app/App.xcworkspace', scheme: 'BlackcrabRemote', derivedData: '/private/tmp/device-derived', archivePath: '/private/tmp/App.xcarchive', signing });
  assert.equal(args[args.indexOf('-sdk') + 1], 'iphoneos');
  assert.equal(args[args.indexOf('-destination') + 1], 'generic/platform=iOS');
  assert.equal(args[args.indexOf('-workspace') + 1], '/private/tmp/mobile app/App.xcworkspace');
  assert.equal(args.at(-1), 'archive');
  assert(args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert(!args.some(value => value.startsWith('CODE_SIGN_IDENTITY=')));
  assert(args.includes('DEVELOPMENT_TEAM=YF28W3NGG6'));
  assert(!args.some(value => /iphonesimulator|CODE_SIGN_IDENTITY=-/.test(value)));
  assert.match(deviceExportOptions(signing.teamId), /<string>app-store-connect<\/string>/);
  // Xcode ignores signingCertificate for automatic exports; check the actual
  // exported certificate instead of presenting this as a selection control.
  assert.doesNotMatch(deviceExportOptions(signing.teamId), /signingCertificate/);
  assert.match(deviceExportOptions(signing.teamId), /<key>destination<\/key><string>export<\/string>/);
  assert.match(deviceExportOptions(signing.teamId), /<key>manageAppVersionAndBuildNumber<\/key><false\/>/);
  for (const delta of [{ certificateSha1: '' }, { teamId: '' }, { appleApiKeyId: '' }, { appleApiIssuerId: '-'.repeat(36) }, { appleApiKeyPath: 'relative.p8' }, { appleApiKeyPath: '/tmp/with spaces/key.p8' }]) {
    assert.throws(() => deviceSigningArguments({ ...signing, ...delta }));
  }
  assert.throws(() => deviceExportOptions('<untrusted>'));
});

test('rejects the real unsigned-export regression and lost push, sign-in or hosted-link capabilities', async () => {
  const { verifyDistributionEntitlements } = await import('./prepare-mobile-ios.mjs');
  const configured = {
    'com.apple.security.application-groups': ['group.dev.blackcrab.remote'],
    'aps-environment': 'production',
    'com.apple.developer.applesignin': ['Default'],
    'com.apple.developer.associated-domains': ['applinks:app.blackcrab.app'],
  };
  const identity = { 'application-identifier': 'YF28W3NGG6.dev.blackcrab.remote', 'get-task-allow': false };
  const options = { teamId: 'YF28W3NGG6', bundleId: 'dev.blackcrab.remote', configured };
  // Actual Xcode unsigned export retained identity but dropped every capability.
  assert.throws(() => verifyDistributionEntitlements(identity, options), /entitlements differ/);
  assert.doesNotThrow(() => verifyDistributionEntitlements({ ...identity, ...configured }, options));
  for (const key of Object.keys(configured)) {
    const incomplete = { ...identity, ...configured }; delete incomplete[key];
    assert.throws(() => verifyDistributionEntitlements(incomplete, options), /entitlement/);
  }
  assert.throws(() => verifyDistributionEntitlements({ ...identity, ...configured, 'aps-environment': 'development' }, options), /aps-environment/);
  assert.throws(() => verifyDistributionEntitlements({ ...identity, ...configured, 'get-task-allow': true }, options), /entitlements differ/);
});
