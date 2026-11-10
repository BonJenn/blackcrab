import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
