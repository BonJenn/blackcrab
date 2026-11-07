import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript';

const PATCH_DIRECTORY_HREF = new URL('./patches/', import.meta.url).href;
export const SHARED_SOURCE_PATCH_DIRECTORY = new URL(PATCH_DIRECTORY_HREF);
const REGISTRY_SHA256 = '71056dacec87edb788a9f0e92def69cfbc1f9d7378baec9ffc29330531a81e15';
const PATCH_FILE = '001-rpc-send-parameter-types.patch';
const DESCRIPTOR = Object.freeze({
  id: 'rpc-send-parameter-types',
  target: 'packages/client-runtime/src/rpc/session.ts',
  sha256: '985fc5b1db81348ebada9376b1bfa9ebec6ad53ab2fc5ba8a338f766c1971f34',
  beforeSha256: 'c71fc43eb268e757194ff06b82ae36dcdda8a176581da7a6566877e55650483c',
  afterSha256: 'cc9f18c16c434b27813c477b95862b687821ad5c24421091b5b3e052ae86a0be',
  emittedJavaScriptSha256: 'eb62e887f23fb75f4700fa8fe1c113dd3accf179e972bcbfb0ef65848d3c4800',
});
const BEFORE = '          send: (clientId, request, transferables) =>';
const AFTER = '          send: (\n            clientId: Parameters<typeof protocol.send>[0],\n            request: Parameters<typeof protocol.send>[1],\n            transferables: Parameters<typeof protocol.send>[2],\n          ) =>';
const COMPILER_OPTIONS = Object.freeze({
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  verbatimModuleSyntax: true,
  removeComments: true,
  sourceMap: false,
  inlineSourceMap: false,
  inlineSources: false,
  newLine: ts.NewLineKind.LineFeed,
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Invalid shared source patch: ${message}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function assertDescriptor(descriptor) {
  if (!record(descriptor) || Object.keys(descriptor).length !== Object.keys(DESCRIPTOR).length || !Object.entries(DESCRIPTOR).every(([key, value]) => descriptor[key] === value)) fail('unknown descriptor');
}
function patchFileBytes(name) {
  const directory = fileURLToPath(PATCH_DIRECTORY_HREF);
  const directoryStat = fsSync.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail('patch directory is linked or not a directory');
  const file = new URL(name, PATCH_DIRECTORY_HREF), stat = fsSync.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('patch metadata is linked or not a regular file');
  return fsSync.readFileSync(file);
}
function loadRecord() {
  const registryBytes = patchFileBytes('registry.json');
  if (hash(registryBytes) !== REGISTRY_SHA256) fail('registry digest differs');
  const registry = JSON.parse(registryBytes.toString('utf8'));
  if (!Array.isArray(registry) || registry.length !== 1 || !record(registry[0])) fail('unknown registry');
  const patch = registry[0];
  const descriptor = Object.fromEntries(Object.keys(DESCRIPTOR).map(key => [key, patch[key]]));
  assertDescriptor(descriptor);
  if (Object.keys(patch).length !== Object.keys(DESCRIPTOR).length + 3 || patch.file !== PATCH_FILE || patch.before !== BEFORE || patch.after !== AFTER) fail('registry replacement differs');
  if (hash(patchFileBytes(PATCH_FILE)) !== DESCRIPTOR.sha256) fail('diff digest differs');
  return { patch, descriptor };
}
function emit(bytes) {
  const result = ts.transpileModule(Buffer.from(bytes).toString('utf8'), { compilerOptions: COMPILER_OPTIONS, fileName: 'session.ts', reportDiagnostics: true });
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) fail('source cannot be transpiled');
  return result.outputText;
}
/** Hash checks plus an independent, type-erased JavaScript equality check. */
export function validateSharedSourcePatch(originalBytes, patchedBytes, descriptor) {
  assertDescriptor(descriptor);
  loadRecord();
  if (hash(originalBytes) !== DESCRIPTOR.beforeSha256) fail('original source differs');
  if (hash(patchedBytes) !== DESCRIPTOR.afterSha256) fail('patched source differs');
  const originalJavaScript = emit(originalBytes), patchedJavaScript = emit(patchedBytes);
  if (originalJavaScript !== patchedJavaScript) fail('patch changes emitted JavaScript');
  if (hash(originalJavaScript) !== DESCRIPTOR.emittedJavaScriptSha256) fail('emitted JavaScript digest differs; review the compiler and patch');
}
async function targetPath(sourceRoot) {
  const root = path.resolve(sourceRoot), rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('source root must be a real directory');
  let target = root;
  for (const part of DESCRIPTOR.target.split('/')) {
    target = path.join(target, part);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) fail('source target or ancestor is linked');
    if (target !== path.join(root, DESCRIPTOR.target) && !stat.isDirectory()) fail('source ancestor is not a directory');
  }
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.nlink !== 1) fail('source target is not a single-link regular file');
  return { target, stat };
}
/** Only fresh exact source is patched; callers retain original bytes in provenance. */
export async function applySharedSourcePatches(sourceRoot) {
  const { patch, descriptor } = loadRecord();
  const { target, stat } = await targetPath(sourceRoot);
  const originals = await fs.readFile(target);
  if (hash(originals) !== descriptor.beforeSha256) fail('original source differs');
  const text = originals.toString('utf8');
  if (text.split(patch.before).length !== 2) fail('replacement does not match uniquely');
  const patched = Buffer.from(text.replace(patch.before, patch.after));
  validateSharedSourcePatch(originals, patched, descriptor);
  const temporary = path.join(path.dirname(target), `.blackcrab-shared-patch-${randomUUID()}`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', stat.mode & 0o777);
    await handle.writeFile(patched); await handle.sync(); await handle.close(); handle = null;
    const current = await targetPath(sourceRoot);
    if (current.stat.ino !== stat.ino || current.stat.dev !== stat.dev || hash(await fs.readFile(current.target)) !== descriptor.beforeSha256) fail('original source changed while patching');
    await fs.rename(temporary, target);
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
  return { patches: [{ ...descriptor }], originals: [{ path: descriptor.target, bytes: originals }] };
}
