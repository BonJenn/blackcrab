import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateToolchain } from '../managed-host/build.mjs';
import { UPSTREAM, NODE_VERSION, PNPM_VERSION } from '../managed-host/artifact.mjs';
import { prepareHostedWeb } from './hosted-source.mjs';
import { hostedOutputConfig, hostedWebBuildEnvironment, hostedWebConfigFromEnvironment } from './hosted-config.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function buildHostedWeb({ archive, cacheDir, output, node, pnpm, environment = process.env }) {
  hostedWebConfigFromEnvironment(environment); // Reject incomplete deployment inputs before doing any work.
  output = path.resolve(output); cacheDir = path.resolve(cacheDir);
  try { await fs.lstat(output); throw new Error('Hosted artifact output already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  node = path.resolve(node); pnpm = path.resolve(pnpm);
  await validateToolchain(node, pnpm);
  const prepared = await prepareHostedWeb({ archive, cacheDir, environment });
  const source = prepared.source, config = prepared.hosted.config;
  const logs = path.join(source, 'blackcrab-hosted-build-logs'); await fs.mkdir(logs);
  const env = { PATH: `${path.dirname(node)}:${path.dirname(pnpm)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    CI: '1', LANG: 'C', LC_ALL: 'C', COREPACK_ENABLE_PROJECT_SPEC: '0',
    npm_config_store_dir: path.join(cacheDir, 'pnpm-store'),
    ...hostedWebBuildEnvironment(config),
  };
  async function step(name, command, args, cwd = source) {
    process.stderr.write('Hosted web: ' + name + '\n');
    const handle = await fs.open(path.join(logs, name + '.log'), 'wx');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env, stdio: ['ignore', handle.fd, handle.fd] });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`Hosted ${name} failed (${code}); see ${logs}`)));
      });
    } finally { await handle.close(); }
  }
  await step('install', pnpm, ['--filter', '@t3tools/web...', '--filter', '@t3tools/scripts...', '--filter', './', 'install', '--frozen-lockfile', '--ignore-scripts']);
  await step('web', node, [path.join(source, 'node_modules/vite-plus/bin/vp'), 'build'], path.join(source, 'apps/web'));
  const dist = path.join(source, 'apps/web/dist');
  await fs.access(path.join(dist, 'index.html'));
  // Public association bytes must survive the original Vite build unchanged.
  for (const name of ['apple-app-site-association.json', 'assetlinks.json']) {
    const relative = '.well-known/' + name;
    if (!(await fs.readFile(path.join(dist, relative))).equals(await fs.readFile(path.join(source, 'apps/web/public', relative)))) throw new Error('Built hosted association differs.');
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const stage = await fs.mkdtemp(path.join(path.dirname(output), '.blackcrab-hosted-artifact-'));
  try {
    const built = path.join(stage, '.vercel/output'); await fs.mkdir(built, { recursive: true });
    await fs.cp(dist, path.join(built, 'static'), { recursive: true, errorOnExist: true });
    await fs.writeFile(path.join(built, 'config.json'), json(hostedOutputConfig(config)), { flag: 'wx' });
    const provenance = { schema: 1, kind: 'blackcrab-hosted-web', upstream: UPSTREAM, node: NODE_VERSION, pnpm: PNPM_VERSION,
      sourcePatches: prepared.sourcePatches, hosted: prepared.hosted,
      dependencyLockSha256: hash(await fs.readFile(path.join(source, 'pnpm-lock.yaml'))), deployed: false };
    await fs.writeFile(path.join(stage, 'BUILD-PROVENANCE.json'), json(provenance), { flag: 'wx' });
    await fs.copyFile(path.join(source, 'LICENSE'), path.join(stage, 'UPSTREAM-LICENSE'));
    await fs.writeFile(path.join(stage, 'vercel.json'), json({ framework: null, git: { deploymentEnabled: false } }), { flag: 'wx' });
    await fs.rename(stage, output);
  } catch (error) { await fs.rm(stage, { recursive: true, force: true }); throw error; }
  return { output, source, logs, deployed: false };
}
