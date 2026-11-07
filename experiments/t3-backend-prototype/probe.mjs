import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';

const { values } = parseArgs({ options: { source: { type: 'string' }, node: { type: 'string' }, output: { type: 'string' }, bundled: { type: 'boolean', default: false } } });
if (!values.source || !values.node) throw new Error('Pass --source <pinned T3 source> --node <Node 26.12.1 executable>');
const source = path.resolve(values.source), node = path.resolve(values.node);
const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
const version = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
if (manifest.engines?.node !== '26.12.1' || version !== 'v26.12.1') throw new Error('This probe requires the pinned source toolchain (Node 26.12.1)');
const root = await fs.mkdtemp(path.join(values.output ? path.resolve(values.output) : os.tmpdir(), 'blackcrab-t3-probe-'));
const project = path.join(root, 'project'), data = path.join(root, 'state');
await fs.mkdir(project); await fs.mkdir(data);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(T3CODE_|VITE_|OTEL_)/.test(key)));
env.OTEL_SDK_DISABLED = 'true'; env.T3CODE_DEV_SEED = '0';
// Resolve the chosen runtime before any ambient Node or provider CLIs.
env.PATH = `${path.dirname(node)}${path.delimiter}/usr/bin${path.delimiter}/bin${path.delimiter}/usr/sbin`;
const cli = path.join(source, values.bundled ? 'apps/server/dist/bin.mjs' : 'apps/server/src/bin.ts');
let server = null, stage = 'help';
const evidence = { source, entry: values.bundled ? 'bundle' : 'source', nodeVersion: version, root, serverStarts: 0, clientCommands: [], passed: false };
async function command(name, args) {
  const child = spawn(node, [cli, ...args], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
  const deadline = setTimeout(() => child.kill('SIGTERM'), 120000);
  const [code] = await once(child, 'close');
  clearTimeout(deadline);
  await fs.writeFile(path.join(root, `${name}.log`), stdout + stderr, { mode: 0o600 });
  if (code !== 0) throw new Error(`${name} exited ${code}; inspect its isolated log`);
  return stdout;
}
async function start() {
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(node, [cli, 'serve', '--host', '127.0.0.1', '--port', String(port), '--base-dir', data, '--no-browser'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server = child; evidence.serverStarts++;
  const log = await fs.open(path.join(root, `server-${evidence.serverStarts}.log`), 'w', 0o600);
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Server readiness deadline exceeded')), 120000);
      let settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once('error', finish); child.once('exit', code => finish(new Error(`Server exited ${code} before readiness`)));
      const receive = bytes => { void log.write(bytes); output = (output + bytes.toString()).slice(-16384); if (output.includes('T3 Code server is ready.')) finish(); };
      child.stdout.on('data', receive); child.stderr.on('data', receive);
      if (child.exitCode !== null || child.signalCode !== null) finish(new Error('Server exited before readiness listeners attached'));
    });
  } catch (error) { await stop(); await log.close(); throw error; }
  child.once('close', () => { void log.close(); });
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/.well-known/t3/environment`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Environment descriptor failed');
  const descriptor = await response.json();
  if (typeof descriptor.environmentId !== 'string' || !descriptor.environmentId) throw new Error('Missing environment identity');
  const protectedResponse = await fetch(`${origin}/api/projects`, { signal: AbortSignal.timeout(10000) });
  if (![401, 403].includes(protectedResponse.status)) throw new Error('Unauthenticated project access was not rejected');
  return { environmentId: descriptor.environmentId, protectedStatus: protectedResponse.status };
}
async function stop() {
  const child = server; server = null;
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    if (!child.stdout.destroyed || !child.stderr.destroyed) await once(child, 'close');
    return;
  }
  const exited = once(child, 'close'); child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { await exited; } finally { clearTimeout(force); }
}
try {
  await command('help', ['serve', '--help']);
  stage = 'first-start'; const first = await start();
  stage = 'project-add'; await command('project-add', ['project', 'add', project, '--title', 'Blackcrab host probe', '--base-dir', data]);
  evidence.clientCommands.push('project add');
  if (server.exitCode !== null) throw new Error('Host exited when the client disconnected');
  await stop(); stage = 'restart'; const second = await start();
  if (first.environmentId !== second.environmentId) throw new Error('Environment identity changed on restart');
  stage = 'project-rename'; await command('project-rename', ['project', 'rename', project, 'Blackcrab host probe reconnected', '--base-dir', data]);
  evidence.clientCommands.push('project rename after restart');
  if (server.exitCode !== null) throw new Error('Host exited when the second client disconnected');
  evidence.protectedStatus = second.protectedStatus;
  evidence.stableEnvironmentIdentity = true; evidence.passed = true;
} catch (error) { evidence.failedStage = stage; evidence.error = error.message; process.exitCode = 1; }
finally {
  await stop();
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
}
