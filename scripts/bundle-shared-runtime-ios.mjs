// Compile the actual native product entry (or the explicit shared-source fixture).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const mobile = fileURLToPath(new URL('../apps/mobile/', import.meta.url));
const require = createRequire(path.join(mobile, 'package.json'));
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-shared-ios-'));
const fixture = process.argv.includes('--fixture');
const entry = path.join(mobile, fixture ? 'tools/managed-runtime-entry.ts' : 'index.ts');
const bundle = path.join(output, 'blackcrab-remote.js');
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [require.resolve('expo/bin/cli'), 'export:embed', '--entry-file', entry, '--platform', 'ios', '--dev', 'false', '--bytecode', '--max-workers', '2', '--bundle-output', bundle, '--assets-dest', path.join(output, 'assets')], { cwd: mobile, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' }, stdio: 'inherit' });
  child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Native shared-runtime compiler exited ${code}`)));
});
if (!(await fs.stat(bundle)).size) throw new Error('Native shared-runtime compiler produced an empty bundle');
const compiled = await fs.readFile(bundle);
if (compiled.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f') throw new Error('Native shared-runtime output is not Hermes bytecode');
console.log(JSON.stringify({ output, bundle, entry, compiled: true, hermesBytecode: true, executedOnDevice: false }));
