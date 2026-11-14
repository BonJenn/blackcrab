/** Stage an authenticated Electron runtime. This does not enable a product target. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {desktopTarget, verifyElectronArchive, verifyElectronExecutable} from './targets.mjs';

const exec = promisify(execFile);

function extractor(archive, root) {
  switch (process.platform) {
    case 'darwin': return ['/usr/bin/ditto', ['-x', '-k', archive, root]];
    case 'linux': return ['/usr/bin/unzip', ['-q', archive, '-d', root]];
    case 'win32': {
      // The OS tar supports ZIP and avoids a shell/PowerShell command string.
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !path.isAbsolute(systemRoot)) throw Error('Windows system directory is unavailable');
      return [path.join(systemRoot, 'System32', 'tar.exe'), ['-xf', archive, '-C', root]];
    }
    default: throw Error('Unsupported runtime extraction host');
  }
}

export function runtimePackagePaths(root, targetId) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw Error('Absolute runtime staging directory required');
  const target = desktopTarget(targetId);
  return {
    target,
    root,
    executable: path.join(root, target.layout.executable),
    resources: path.join(root, target.layout.resources),
    payload: path.join(root, target.layout.payload),
    ...(target.electron.platform === 'darwin' ? {appBundle: path.join(root, 'Blackcrab.app')} : {}),
  };
}

/**
 * The caller owns an empty staging directory on the publication filesystem.
 * Authenticate before extraction, retain failures for diagnosis, and never launch
 * the downloaded runtime. Identity resources, payloads and signing come later.
 */
export async function stageElectronRuntime({archive, root, targetId}) {
  const layout = runtimePackagePaths(root, targetId);
  if (typeof archive !== 'string' || !path.isAbsolute(archive)) throw Error('Absolute Electron archive required');
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(root)).length !== 0) {
    throw Error('Runtime staging directory must be an empty real directory');
  }
  await verifyElectronArchive(archive, targetId);
  const [command, args] = extractor(archive, root);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await exec(command, args, {windowsHide:true, timeout:180_000, maxBuffer:1024*1024, signal:controller.signal});
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  await verifyElectronExecutable(path.join(root, layout.target.layout.archiveExecutable), targetId);
  if (layout.appBundle) {
    await fs.rename(path.join(root, 'Electron.app'), layout.appBundle);
    await fs.rename(path.join(layout.appBundle, 'Contents/MacOS/Electron'), layout.executable);
  } else {
    await fs.rename(path.join(root, layout.target.layout.archiveExecutable), layout.executable);
  }
  await verifyElectronExecutable(layout.executable, targetId);
  await fs.mkdir(layout.payload, {recursive: true});
  return layout;
}
