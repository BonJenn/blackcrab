/** Exact runtime inputs and layouts. A known target is not a certified build. */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';

const version = '44.10.1';
export const electronChecksumSource = Object.freeze({
  url: `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`,
  sha256: '908e7b634b1a6bc859e8fd1fe6c410adc13f84d5b6f5e9de8cb43ae040dfcc00',
});
function target(platform, arch, archiveSha256, layout, rustTarget, producerImplemented) {
  return Object.freeze({
    id: `${platform}-${arch}`, rustTarget, producerImplemented,
    electron: Object.freeze({version, platform, arch, archiveSha256,
      url: `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-${platform}-${arch}.zip`}),
    layout: Object.freeze(layout),
  });
}
const targets = Object.freeze({
  'darwin-arm64': target('darwin', 'arm64', '687f922034f1e991ab34ed7f47c4cb4e5c5e85e974b0ce155c22ce6d6f699aa3', {
    archiveExecutable: 'Electron.app/Contents/MacOS/Electron',
    executable: 'Blackcrab.app/Contents/MacOS/Blackcrab',
    resources: 'Blackcrab.app/Contents/Resources',
    payload: 'Blackcrab.app/Contents/Resources/app',
  }, 'aarch64-apple-darwin', true),
  'linux-x64': target('linux', 'x64', '2be868b71b0aa71f30e6b5567a106a35a049385e963183c074aad1975ead5167', {
    archiveExecutable: 'electron', executable: 'Blackcrab', resources: 'resources', payload: 'resources/app',
  }, 'x86_64-unknown-linux-gnu', false),
  'win32-x64': target('win32', 'x64', '5099bdc11c6a78edff35851491c1f8228a1c2e844e1b376eee219402c42c6011', {
    archiveExecutable: 'electron.exe', executable: 'Blackcrab.exe', resources: 'resources', payload: 'resources/app',
  }, 'x86_64-pc-windows-msvc', false),
});
export function desktopTarget(id) {
  if (typeof id !== 'string' || !Object.hasOwn(targets, id)) throw Error('Unsupported managed desktop target');
  return targets[id];
}
export function desktopBuildTarget(platform, arch) {
  const selected = desktopTarget(`${platform}-${arch}`);
  if (!selected.producerImplemented) throw Error(`Managed desktop producer is not implemented for ${selected.id}`);
  return selected;
}
export async function verifyElectronArchive(archive, id) {
  const selected = desktopTarget(id), stat = await fs.lstat(archive);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Electron archive must be a regular file');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(archive)) hash.update(bytes);
  if (hash.digest('hex') !== selected.electron.archiveSha256) throw Error(`Official Electron archive digest mismatch for ${id}`);
  return selected;
}
/** Inspect native format/architecture without executing a downloaded runtime. */
export async function verifyElectronExecutable(file, id) {
  const selected = desktopTarget(id), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Electron executable must be a regular file');
  const input = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(64);
    const {bytesRead} = await input.read(header, 0, header.length, 0);
    let valid = false;
    if (bytesRead === 64 && id === 'darwin-arm64') {
      valid = header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === 0x0100000c;
    } else if (bytesRead === 64 && id === 'linux-x64') {
      valid = header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
        header[4] === 2 && header[5] === 1 && header.readUInt16LE(18) === 62;
    } else if (bytesRead === 64 && id === 'win32-x64' && header.readUInt16LE(0) === 0x5a4d) {
      const offset = header.readUInt32LE(0x3c), pe = Buffer.alloc(6);
      if (offset >= 64 && offset <= 1024 * 1024 && offset + pe.length <= stat.size) {
        const read = await input.read(pe, 0, pe.length, offset);
        valid = read.bytesRead === pe.length && pe.readUInt32LE(0) === 0x00004550 && pe.readUInt16LE(4) === 0x8664;
      }
    }
    if (!valid) throw Error(`Electron executable format/architecture mismatch for ${id}`);
    return selected;
  } finally { await input.close(); }
}
