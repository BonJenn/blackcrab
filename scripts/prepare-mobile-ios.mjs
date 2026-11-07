#!/usr/bin/env node
/** Isolated, reproducible Expo SDK 54 native preparation; never patches shared dependencies. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
const execute = promisify(execFile);
const defaultRepo = fileURLToPath(new URL('../', import.meta.url));
const OWN_NEW_FILES = new Set([
  'scripts/prepare-mobile-ios.mjs', 'scripts/prepare-mobile-ios.test.mjs',
  'apps/mobile/plugins/with-ios-pod-floor.cjs', 'apps/mobile/plugins/with-ios-pod-floor.test.cjs',
  'docs/native-ios-build.md',
]);
const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'LICENSE', 'LICENSE.md', 'tsconfig.json', ...OWN_NEW_FILES]);
const PREFIXES = ['apps/', 'packages/', 'vendor/t3/'];
const EXPECTED_WORKSPACES = ['apps/*', 'packages/*', 'vendor/t3/packages/*'];
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
  const modules = ['expo', 'react-native', 'expo-constants', 'expo-updates', 'expo-network', 'expo-file-system', 'expo-secure-store', '@expo/config-plugins'];
  const resolved = {};
  for (const name of modules) {
    const target = await fs.realpath(require.resolve(`${name}/package.json`));
    if (!inside(physicalRepo, target)) throw new Error(`Native dependency escapes staging: ${name}`);
    resolved[name] = { path: target, version: JSON.parse(await fs.readFile(target, 'utf8')).version };
  }
  if (!resolved.expo.version.startsWith('54.') || resolved['react-native'].version !== '0.81.5') throw new Error('Unsupported native SDK versions; this preparation targets Expo 54 / React Native 0.81.5.');
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
      if (major < 15 || major === 15 && minor < 1) throw new Error('Generated pod target is below the iOS 15.1 floor.');
      configurations++;
    }
  }
  if (!targets) throw new Error('No generated pod targets were found.');
  return { targets, configurations, minimum: '15.1' };
}

export function isolatedBuildEnvironment(root, original = process.env) {
  const env = { PATH: original.PATH, HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_GIT_STATUS: '1', COCOAPODS_DISABLE_STATS: 'true', NPM_CONFIG_USERCONFIG: path.join(root, 'npm-userconfig'), NPM_CONFIG_GLOBALCONFIG: path.join(root, 'npm-globalconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false' };
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

export async function prepareMobileIos(options = {}) {
  if (process.platform !== 'darwin') throw new Error('Native iOS preparation requires macOS and installed Xcode/CocoaPods.');
  const { mode = 'prepare', destination = 'generic/platform=iOS Simulator' } = options;
  if (!['prepare', 'build'].includes(mode)) throw new Error('Use --mode prepare or --mode build.');
  const stage = await createSourceSnapshot(options), mobile = path.join(stage.repo, 'apps/mobile');
  const env = isolatedBuildEnvironment(stage.root);
  await Promise.all([fs.mkdir(env.HOME), fs.mkdir(env.TMPDIR), fs.writeFile(env.NPM_CONFIG_USERCONFIG, '', { mode: 0o600 }), fs.writeFile(env.NPM_CONFIG_GLOBALCONFIG, '', { mode: 0o600 })]);
  const report = { schemaVersion: 1, mode, stage: stage.root, repo: stage.repo, sourceManifest: path.join(stage.root, 'artifacts/source-manifest.json'), logs: path.join(stage.root, 'logs'), status: 'running', executedOnDevice: false };
  const reportPath = path.join(stage.root, 'artifacts/build-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  let step = 0;
  const run = (name, command, args, cwd = stage.repo, timeout) => runLogged(command, args, { cwd, env, timeout, log: path.join(report.logs, `${String(++step).padStart(2, '0')}-${name}.log`) });
  try {
    await run('node-version', process.execPath, ['--version']);
    await run('npm-version', 'npm', ['--version']);
    await run('xcode-version', 'xcodebuild', ['-version']);
    await run('pod-version', 'pod', ['--version']);
    await run('npm-ci', 'npm', ['ci', '--no-audit', '--no-fund', '--cache', path.join(stage.root, 'npm-cache')]);
    report.dependencies = await verifyNativeDependencyRoots(stage.repo);
    const require = createRequire(path.join(mobile, 'package.json'));
    await run('expo-prebuild', process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install'], mobile);
    await run('pod-install', 'pod', ['install', '--project-directory=' + path.join(mobile, 'ios')], mobile);
    report.podFloor = await verifyGeneratedPodFloor(stage.repo);
    const workspaces = (await fs.readdir(path.join(mobile, 'ios'))).filter(name => name.endsWith('.xcworkspace'));
    if (workspaces.length !== 1) throw new Error('Expected one generated iOS workspace.');
    report.workspace = path.join(mobile, 'ios', workspaces[0]); report.scheme = workspaces[0].slice(0, -'.xcworkspace'.length);
    report.podfileLockSha256 = hash(await fs.readFile(path.join(mobile, 'ios/Podfile.lock')));
    if (mode === 'build') {
      report.entryFile = await resolveNativeEntry(stage.repo);
      env.ENTRY_FILE = report.entryFile;
      const parent = options.derivedDataParent ? await fs.realpath(options.derivedDataParent) : stage.root;
      report.derivedData = await fs.mkdtemp(path.join(parent, 'blackcrab-ios-derived-'));
      await run('xcodebuild', 'xcodebuild', ['-workspace', report.workspace, '-scheme', report.scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', destination, '-derivedDataPath', report.derivedData, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'DEVELOPMENT_TEAM=', 'build'], mobile, 60 * 60_000);
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
    }
    report.status = mode === 'build' ? 'built' : 'prepared';
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
    'staging-parent': { type: 'string' }, 'derived-data-parent': { type: 'string' }, destination: { type: 'string' },
  } });
  try {
    console.log(JSON.stringify(await prepareMobileIos({ mode: values.mode, includeWorkingTree: values['include-working-tree'], stagingParent: values['staging-parent'], derivedDataParent: values['derived-data-parent'], destination: values.destination }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
