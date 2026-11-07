import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const UPSTREAM = Object.freeze({ repository: 'BonJenn/t3code', commit: '7f02de2eb8e253e0ec23f005b3cfff8e2c963be8', archiveSha256: 'eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6' });
export const NODE_VERSION = '26.12.1';
export const PNPM_VERSION = '12.14.0';
export const MANIFEST_FILE = 'blackcrab-managed-host.json';
const PLATFORMS = ['darwin', 'linux', 'win32'];
const ARCHES = ['arm64', 'x64'];
const MAX_FILES = 200000;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => { throw new Error(`Invalid managed-host artifact: ${message}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
function validPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
function target(platform, arch) {
  if (!PLATFORMS.includes(platform) || !ARCHES.includes(arch)) fail('unsupported platform or architecture');
  return { platform, arch, version: '0.1.7' };
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function scan(root) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('root must be a real directory');
  const files = [];
  async function visit(directory, prefix, depth) {
    if (depth > 128) fail('directory nesting exceeds limit');
    const entries = await fs.readdir(directory);
    for (const name of entries.sort(compare)) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (!validPath(relative)) fail('unsafe file path');
      const absolute = path.join(directory, name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) fail(`symbolic link: ${relative}`);
      if (stat.isDirectory()) { await visit(absolute, relative, depth + 1); continue; }
      if (!stat.isFile()) fail(`non-file entry: ${relative}`);
      if (relative === MANIFEST_FILE) continue;
      if (files.length >= MAX_FILES) fail('file count exceeds limit');
      if (!Number.isSafeInteger(stat.size) || stat.size < 0) fail(`invalid size: ${relative}`);
      files.push({ path: relative, bytes: stat.size, sha256: await digest(absolute), executable: (stat.mode & 0o111) !== 0 });
    }
  }
  await visit(root, '', 0);
  return files.sort((a, b) => compare(a.path, b.path));
}
function requiredFiles(manifest) {
  const byPath = new Map(manifest.files.map(file => [file.path, file]));
  const monitor = `resource-monitor/t3-resource-monitor${manifest.runtime.platform === 'win32' ? '.exe' : ''}`;
  for (const name of [manifest.entry, manifest.client, 'LICENSE.upstream', 'THIRD-PARTY-NOTICES', monitor]) {
    if (!byPath.has(name) || byPath.get(name).bytes === 0) fail(`missing or empty required file: ${name}`);
  }
  if (manifest.runtime.platform !== 'win32' && !byPath.get(monitor).executable) fail('resource monitor must be executable');
  if (manifest.runtime.platform !== 'win32' && !byPath.get(manifest.entry).executable) fail('host entry must be executable');
}
function validateManifest(value) {
  if (!keys(value, ['schema', 'kind', 'upstream', 'sourcePatches', 'runtime', 'entry', 'client', 'files']) || value.schema !== 1 || value.kind !== 'blackcrab-managed-host') fail('unknown manifest schema');
  if (!keys(value.upstream, Object.keys(UPSTREAM)) || !Object.entries(UPSTREAM).every(([key, expected]) => value.upstream[key] === expected)) fail('upstream pin mismatch');
  if (!Array.isArray(value.sourcePatches) || value.sourcePatches.length > 128 || !value.sourcePatches.every(patch => keys(patch, ['id', 'sha256']) && typeof patch.id === 'string' && patch.id.length > 0 && patch.id.length <= 256 && patch.id.trim() === patch.id && !/[\x00-\x1f\x7f]/.test(patch.id) && typeof patch.sha256 === 'string' && /^[a-f0-9]{64}$/.test(patch.sha256)) || new Set(value.sourcePatches.map(patch => patch.id)).size !== value.sourcePatches.length) fail('invalid source patch descriptors');
  if (!keys(value.runtime, ['platform', 'arch', 'version']) || value.runtime.version !== '0.1.7') fail('runtime metadata mismatch');
  target(value.runtime.platform, value.runtime.arch);
  if (value.entry !== (value.runtime.platform === 'win32' ? 't3.exe' : 't3') || value.client !== 'client/index.html') fail('entry or client mismatch');
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > MAX_FILES) fail('invalid file list');
  let previous = null;
  for (const file of value.files) {
    if (!keys(file, ['path', 'bytes', 'sha256', 'executable']) || !validPath(file.path) || file.path === MANIFEST_FILE || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.executable !== 'boolean') fail('invalid file record');
    if (previous !== null && compare(previous, file.path) >= 0) fail('file paths must be unique and sorted');
    previous = file.path;
  }
  requiredFiles(value);
  return value;
}

/** Called only after assembling an artifact; publication/atomic directory rename belongs to the builder. */
export async function writeArtifactManifest(root, { platform, arch, sourcePatches = [] }) {
  const runtime = target(platform, arch);
  const manifestPath = path.join(root, MANIFEST_FILE);
  try { await fs.lstat(manifestPath); fail('manifest already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifest = validateManifest({ schema: 1, kind: 'blackcrab-managed-host', upstream: { ...UPSTREAM }, sourcePatches: structuredClone(sourcePatches), runtime, entry: platform === 'win32' ? 't3.exe' : 't3', client: 'client/index.html', files: await scan(root) });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES) fail('manifest exceeds size limit');
  const handle = await fs.open(manifestPath, 'wx', 0o644);
  try { await handle.writeFile(serialized); await handle.sync(); }
  catch (error) { await handle.close(); await fs.unlink(manifestPath); throw error; }
  await handle.close();
  return manifest;
}

/** Content integrity/compatibility verification, not a signature or trusted-builder attestation. */
export async function verifyArtifact(root, { platform = process.platform, arch = process.arch } = {}) {
  target(platform, arch);
  const manifestPath = path.join(root, MANIFEST_FILE);
  const stat = await fs.lstat(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) fail('manifest must be a bounded regular file');
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { fail('manifest JSON could not be read'); }
  const manifest = validateManifest(parsed);
  if (manifest.runtime.platform !== platform || manifest.runtime.arch !== arch) fail('artifact is incompatible with this host');
  const actual = await scan(root);
  if (actual.length !== manifest.files.length) fail('file list differs from manifest');
  for (let i = 0; i < actual.length; i++) {
    const found = actual[i], expected = manifest.files[i];
    if (found.path !== expected.path || found.bytes !== expected.bytes || found.sha256 !== expected.sha256 || found.executable !== expected.executable) fail(`file integrity mismatch: ${expected.path}`);
  }
  return manifest;
}
