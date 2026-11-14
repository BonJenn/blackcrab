// Native CI smoke: the real pinned runtime, with isolated data and no product host.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify, parseArgs} from 'node:util';
import {desktopTarget} from '../managed-desktop/targets.mjs';
import {stageElectronRuntime} from '../managed-desktop/runtime-package.mjs';

const {values} = parseArgs({options:{report:{type:'string'}}, allowPositionals:false});
if (!values.report || !path.isAbsolute(values.report)) throw Error('Pass --report with an absolute new output file');
const targetId = `${process.platform}-${process.arch}`;
if (!['linux-x64', 'win32-x64'].includes(targetId)) throw Error('This native smoke requires a Windows or Linux x64 runner');
const target = desktopTarget(targetId);
const report = {scope:'Native Electron runtime only; workspace, service and installer acceptance are separate', targetId, passed:false, launched:false};
const reportFile = await fs.open(values.report, 'wx', 0o600);
let root;
try {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-native-runtime-'));
  const archive = path.join(root, 'electron.zip');
  const response = await fetch(target.electron.url, {signal:AbortSignal.timeout(180_000)});
  if (!response.ok || !response.body) throw Error('Official runtime download failed');
  const file = await fs.open(archive, 'wx', 0o600);
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 512 * 1024 ** 2) throw Error('Runtime download exceeded its bound');
      await file.writeFile(chunk);
    }
  } finally { await file.close(); }
  const staging = path.join(root, 'runtime');
  await fs.mkdir(staging);
  const layout = await stageElectronRuntime({archive, root:staging, targetId});
  for (const notice of ['LICENSE', 'LICENSES.chromium.html']) {
    if (!(await fs.stat(path.join(staging, notice))).isFile()) throw Error('Runtime notices missing');
  }
  const home = path.join(root, 'home'), temporary = path.join(root, 'tmp');
  await fs.mkdir(home); await fs.mkdir(temporary);
  const env = {ELECTRON_RUN_AS_NODE:'1', HOME:home, TMPDIR:temporary, TEMP:temporary, TMP:temporary};
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !path.isAbsolute(systemRoot)) throw Error('Windows system directory unavailable');
    Object.assign(env, {SystemRoot:systemRoot, WINDIR:systemRoot, PATH:path.join(systemRoot,'System32'), USERPROFILE:home, APPDATA:path.join(home,'roaming'), LOCALAPPDATA:path.join(home,'local')});
    await fs.mkdir(env.APPDATA); await fs.mkdir(env.LOCALAPPDATA);
  } else env.PATH = '/usr/bin:/bin';
  const probe = 'console.log(JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node}))';
  report.launchAttempted = true;
  const output = await promisify(execFile)(layout.executable, ['--no-global-search-paths','-e',probe], {cwd:staging, env, windowsHide:true, timeout:30_000, maxBuffer:64*1024});
  report.launched = true;
  const observed = JSON.parse(output.stdout.trim());
  if (observed.platform !== target.electron.platform || observed.arch !== target.electron.arch || observed.electron !== target.electron.version) throw Error('Native runtime identity differs');
  report.native = observed;
  report.archiveSha256 = target.electron.archiveSha256;
  report.executable = target.layout.executable;
  report.noticesVerified = true;
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  try { if (root) await fs.rm(root, {recursive:true, force:true, maxRetries:3}); report.cleanedUp = true; }
  catch { report.cleanedUp = false; report.passed = false; process.exitCode = 1; }
  await reportFile.writeFile(JSON.stringify(report,null,2)+'\n');
  await reportFile.close();
  console.log(JSON.stringify(report));
}
