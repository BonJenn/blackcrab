import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareSourceArchive } from './source.mjs';
import { stageRustNotices } from './rust-notices.mjs';
import { NODE_VERSION, PNPM_VERSION, UPSTREAM, writeArtifactManifest, verifyArtifact } from './artifact.mjs';
const exec = promisify(execFile);
const patchRoot = fileURLToPath(new URL('./patches/', import.meta.url));
const platformName = { darwin: 'mac', linux: 'linux', win32: 'win' };
async function absent(file) {
  try { await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Output already exists: ${file}`);
}
export async function validateToolchain(node, pnpm) {
  const version = (await exec(node, ['--version'])).stdout.trim();
  if (version !== `v${NODE_VERSION}`) throw new Error(`Managed host requires Node ${NODE_VERSION}`);
  const target = (await exec(node, ['-p', "process.platform + '-' + process.arch"])).stdout.trim();
  if (target !== `${process.platform}-${process.arch}`) throw new Error('Managed host toolchain target differs from the build host');
  const packageManager = (await exec(pnpm, ['--version'], { env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' } })).stdout.trim();
  if (packageManager !== PNPM_VERSION) throw new Error(`Managed host requires pnpm ${PNPM_VERSION}`);
}
async function rustNotices(source, output, env) {
  const manifest = path.join(source, 'native/resource-monitor/Cargo.toml');
  const compiler = (await exec('rustc', ['-vV'], { env })).stdout;
  const target = compiler.match(/^host: (.+)$/m)?.[1];
  if (!target) throw new Error('Cannot identify native Rust target for attribution');
  const { stdout } = await exec('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', target, '--manifest-path', manifest], { env, maxBuffer: 8 * 1024 * 1024 });
  await stageRustNotices(JSON.parse(stdout).packages, output);
}
/** Build in fresh pinned source and publish a complete, verified directory only. */
export async function buildManagedHost({ archive, cacheDir, output, node, pnpm, nodeLicense }) {
  if (!platformName[process.platform] || !['arm64', 'x64'].includes(process.arch)) throw new Error('Unsupported managed-host build target');
  archive = path.resolve(archive); cacheDir = path.resolve(cacheDir); output = path.resolve(output);
  node = path.resolve(node); pnpm = path.resolve(pnpm);
  await absent(output); await validateToolchain(node, pnpm);
  const nodeLicenseText = await fs.readFile(nodeLicense, 'utf8');
  if (!nodeLicenseText.startsWith('Node.js is licensed for use as follows:') || !nodeLicenseText.includes('Copyright Node.js contributors')) throw new Error('Pass the complete LICENSE from the selected Node distribution');
  const prepared = await prepareSourceArchive(archive, cacheDir), source = prepared.root;
  const work = await fs.mkdtemp(path.join(cacheDir, 'blackcrab-managed-build-'));
  await fs.mkdir(path.join(work, 'tmp'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(T3CODE_|VITE_|OTEL_|APPLE_API_|NODE_OPTIONS$|NODE_PATH$)/.test(key)));
  Object.assign(env, {
    PATH: [path.dirname(node), path.join(source, 'node_modules/.bin'), env.PATH ?? ''].join(path.delimiter),
    TMPDIR: path.join(work, 'tmp'), TMP: path.join(work, 'tmp'), TEMP: path.join(work, 'tmp'),
    npm_config_store_dir: path.join(cacheDir, 'pnpm-store'),
    T3CODE_CLI_MAC_SIGN_IDENTITY: '-', T3CODE_DEV_SEED: '0', OTEL_SDK_DISABLED: 'true',
  });
  let active = null;
  const terminate = () => {
    if (!active || active.exitCode !== null) return;
    if (process.platform !== 'win32') { try { process.kill(-active.pid, 'SIGTERM'); } catch {} }
    else spawn('taskkill', ['/PID', String(active.pid), '/T', '/F'], { stdio: 'ignore' });
  };
  process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
  async function step(name, command, args, cwd = source) {
    console.log(`Managed host: ${name}`);
    const logPath = path.join(work, `${name}.log`), log = createWriteStream(logPath, { mode: 0o600 });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
        active = child; child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
        child.once('error', reject);
        child.once('close', code => { active = null; code === 0 ? resolve() : reject(new Error(`${name} failed (${code}); log: ${logPath}`)); });
        log.once('error', error => { terminate(); reject(error); });
      });
    } finally { log.end(); }
  }
  try {
    await step('install', pnpm, [ '--filter', 't3...', '--filter', '@t3tools/web...', '--filter', '@t3tools/scripts...', 'install', '--frozen-lockfile', '--ignore-scripts']);
    await step('web', pnpm, [ '--filter', '@t3tools/web', 'build']);
    await step('executable', pnpm, [ '--filter', 't3', 'build:exe']);
    await step('monitor', 'cargo', ['build', '--release', '--locked', '--manifest-path', 'native/resource-monitor/Cargo.toml']);
    const monitor = path.join(work, 'resource-monitor'); await fs.mkdir(monitor);
    const monitorName = `t3-resource-monitor${process.platform === 'win32' ? '.exe' : ''}`;
    await fs.copyFile(path.join(source, 'native/resource-monitor/target/release', monitorName), path.join(monitor, monitorName));
    if (process.platform !== 'win32') await fs.chmod(path.join(monitor, monitorName), 0o755);
    const serverDist = path.join(source, 'apps/server/dist'); await fs.mkdir(serverDist, { recursive: true });
    await fs.cp(path.join(source, 'apps/web/dist'), path.join(serverDist, 'client'), { recursive: true });
    const archives = path.join(work, 'archives');
    await step('archive', node, [path.join(source, 'scripts/build-cli-archive.ts'), '--platform', platformName[process.platform], '--arch', process.arch, '--version', '0.1.7', '--output-dir', archives, '--resource-monitor-dir', monitor]);
    const archiveName = `t3-0.1.7-${process.platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
    await fs.mkdir(path.dirname(output), { recursive: true });
    const staging = await fs.mkdtemp(path.join(path.dirname(output), '.blackcrab-managed-package-'));
    await step('extract', 'tar', ['-xf', path.join(archives, archiveName), '--strip-components=1', '-C', staging]);
    await fs.copyFile(path.join(source, 'LICENSE'), path.join(staging, 'LICENSE.upstream'));
    await fs.copyFile(path.join(staging, 'client/third-party-licenses.json'), path.join(staging, 'THIRD-PARTY-NOTICES'));
    await fs.writeFile(path.join(staging, 'LICENSE.node'), nodeLicenseText);
    await rustNotices(source, staging, env);
    await fs.cp(patchRoot, path.join(staging, 'source-patches'), { recursive: true });
    await fs.writeFile(path.join(staging, 'BUILD-PROVENANCE.json'), JSON.stringify({ upstream: UPSTREAM, node: NODE_VERSION, pnpm: PNPM_VERSION, sourcePatches: prepared.sourcePatches, signing: 'local-only', target: `${process.platform}-${process.arch}` }, null, 2));
    const manifest = await writeArtifactManifest(staging, { platform: process.platform, arch: process.arch, sourcePatches: prepared.sourcePatches });
    await verifyArtifact(staging);
    await absent(output); await fs.rename(staging, output);
    return { output, buildRoot: work, sourceRoot: source, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
  } finally { process.removeListener('SIGINT', terminate); process.removeListener('SIGTERM', terminate); }
}
