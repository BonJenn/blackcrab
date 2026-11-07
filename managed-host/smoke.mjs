import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { verifyArtifact } from './artifact.mjs';

/** Only fresh smoke data is created. This is not a user-host start command. */
export async function smokeManagedHost(artifact) {
  artifact = await fs.realpath(artifact);
  const manifest = await verifyArtifact(artifact);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-managed-smoke-'));
  const data = path.join(root, 'state'), project = path.join(root, 'project'), bin = path.join(root, 'bin');
  await fs.mkdir(data); await fs.mkdir(project); await fs.mkdir(bin);
  if (process.platform === 'win32') throw new Error('Native Windows managed-host smoke remains to be implemented');
  for (const command of ['git', 'sh', 'bash', 'env', 'uname', 'ps', 'which', 'tar', 'sed', 'stat']) {
    for (const directory of ['/usr/bin', '/bin']) {
      const source = path.join(directory, command);
      try { await fs.access(source); await fs.symlink(source, path.join(bin, command)); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(T3CODE_|VITE_|OTEL_|NODE_OPTIONS$|NODE_PATH$)/.test(key)));
  Object.assign(env, { PATH: bin, OTEL_SDK_DISABLED: 'true', T3CODE_DEV_SEED: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
  const entry = path.join(artifact, manifest.entry);
  const report = { artifact, root, passed: false, hostNodeOnPath: false, starts: 0, protectedStatus: null, stableEnvironmentIdentity: false, projectRecovered: false, clientAssetServed: false };
  let server = null, stage = 'start';
  const running = new Set();
  const kill = child => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } };
  async function stop() {
    const child = server; server = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, 'close'); kill(child);
    const deadline = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000);
    try { await closed; } finally { clearTimeout(deadline); }
  }
  const cancel = () => { for (const child of running) kill(child); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  async function client(name, args) {
    const child = spawn(entry, [...args, '--base-dir', data], { cwd: project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    let output = ''; child.stdout.on('data', bytes => { output = (output + bytes).slice(-4 * 1024 * 1024); }); child.stderr.on('data', bytes => { output = (output + bytes).slice(-4 * 1024 * 1024); });
    let force;
    const deadline = setTimeout(() => { kill(child); force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000); }, 60000);
    try {
      const [code] = await once(child, 'close');
      await fs.writeFile(path.join(root, `${name}.log`), output, { mode: 0o600 });
      if (code !== 0) throw new Error(`${name} failed (${code}); inspect isolated smoke log`);
    } finally { clearTimeout(deadline); clearTimeout(force); running.delete(child); }
  }
  async function start() {
    const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const child = spawn(entry, ['serve', '--mode', 'web', '--host', '127.0.0.1', '--port', String(port), '--base-dir', data, '--no-browser', '--bootstrap-fd', '3'], { cwd: project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    child.stdio[3].on('error', () => {});
    child.stdio[3].end(JSON.stringify({ mode: 'desktop', noBrowser: true, port, t3Home: data, host: '127.0.0.1', desktopBootstrapToken: randomUUID(), shellEnvironmentPrepared: true, tailscaleServeEnabled: false, tailscaleServePort: 443 }) + '\n');
    server = child; running.add(child); report.starts++;
    let output = '';
    const closed = once(child, 'close');
    child.once('close', () => { running.delete(child); void fs.writeFile(path.join(root, `server-${report.starts}.log`), output, { mode: 0o600 }); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Packaged host readiness deadline exceeded')), 120000);
      let settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      const receive = bytes => { output = (output + bytes).slice(-4 * 1024 * 1024); if (output.includes('T3 Code server is ready.')) finish(); };
      child.stdout.on('data', receive); child.stderr.on('data', receive); child.once('error', finish);
      closed.then(([code]) => finish(new Error(`Packaged host exited ${code} before readiness`)), finish);
    });
    const origin = `http://127.0.0.1:${port}`;
    const descriptorResponse = await fetch(`${origin}/.well-known/t3/environment`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    if (!descriptorResponse.ok) throw new Error('Packaged environment descriptor failed');
    const descriptor = await descriptorResponse.json();
    if (!descriptor.environmentId || typeof descriptor.environmentId !== 'string') throw new Error('Missing packaged environment identity');
    const protectedResponse = await fetch(`${origin}/api/projects`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    if (![401, 403].includes(protectedResponse.status)) throw new Error('Packaged host allowed unauthenticated project access');
    report.protectedStatus = protectedResponse.status;
    const page = await fetch(origin, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    if (!page.ok) throw new Error('Packaged client page was not served');
    const html = await page.text(), script = html.match(/<script\b[^>]*\bsrc="([^"]+)"/);
    if (!script) throw new Error('Packaged client page has no entry script');
    const asset = new URL(script[1], origin);
    if (asset.origin !== origin) throw new Error('Packaged client entry is not local to the host');
    const assetResponse = await fetch(asset, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    if (!assetResponse.ok || !(await assetResponse.text()).length) throw new Error('Packaged client asset was not served');
    report.clientAssetServed = true;
    return descriptor.environmentId;
  }
  try {
    const first = await start();
    stage = 'project-add'; await client('project-add', ['project', 'add', project, '--title', 'Blackcrab managed smoke']);
    if (server.exitCode !== null) throw new Error('Host exited after its client disconnected');
    await stop(); stage = 'restart'; const second = await start();
    if (first !== second) throw new Error('Packaged environment identity changed after restart');
    report.stableEnvironmentIdentity = true;
    stage = 'project-rename'; await client('project-rename', ['project', 'rename', project, 'Blackcrab managed reconnected']);
    if (server.exitCode !== null) throw new Error('Host exited after its second client disconnected');
    report.projectRecovered = true;
    await stop(); await verifyArtifact(artifact); report.passed = true;
  } catch (error) { report.failedStage = stage; report.error = error.message; }
  finally {
    await stop(); cancel(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  return report;
}
