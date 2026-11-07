import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseAllDocuments } from 'yaml';
import { UPSTREAM } from '../managed-host/artifact.mjs';
import { extractPinnedSourceArchive } from '../managed-host/source.mjs';
import { analyzeMobileSlice } from './graph.mjs';
import { applySharedSourcePatches, SHARED_SOURCE_PATCH_DIRECTORY } from './patches.mjs';

export const EXTERNAL_VERSIONS = Object.freeze({ effect: '4.1.2', '@noble/hashes': '1.8.0' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
const sorted = entries => Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
async function absent(file) {
  try { await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Shared runtime output already exists: ${file}`);
}
function exportLeaves(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportLeaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportLeaves);
  throw new Error('Unsupported source export metadata');
}
/** Generated metadata describes only the proven mobile source boundary. */
export function createConsumerManifest(pkg, filePaths, packages, versions = EXTERNAL_VERSIONS) {
  const original = pkg.originalManifest;
  const exports = {};
  for (const used of pkg.usedExports) {
    const value = original.exports?.[used.key];
    if (used.key.includes('*') || value === undefined) throw new Error(`Unsupported mobile export key: ${pkg.name}:${used.key}`);
    for (const target of exportLeaves(value)) {
      if (!target.startsWith('./') || target.includes('*') || target.split('/').includes('..') || !filePaths.has(`${pkg.folder}/${target.slice(2)}`)) throw new Error(`Mobile export has an unselected target: ${pkg.name}:${target}`);
    }
    exports[used.key] = value;
  }
  if (!Object.keys(exports).length) throw new Error(`Mobile source package has no public exports: ${pkg.name}`);
  const dependencies = {};
  for (const name of pkg.dependencies.workspace) {
    if (name === pkg.name) continue;
    const dependency = packages.find(item => item.name === name);
    if (!dependency) throw new Error(`Unselected workspace dependency: ${name}`);
    dependencies[name] = `file:../${path.posix.basename(dependency.folder)}`;
  }
  for (const name of pkg.dependencies.external) {
    if (versions[name] !== EXTERNAL_VERSIONS[name] || !EXTERNAL_VERSIONS[name]) throw new Error(`Unpinned mobile dependency: ${name}`);
    dependencies[name] = versions[name];
  }
  return {
    name: pkg.name, version: original.version ?? '0.1.7', private: true,
    type: 'module', license: original.license ?? 'MIT',
    exports: sorted(exports), dependencies: sorted(dependencies), files: ['src'],
    ...(typeof original.sideEffects === 'boolean' ? { sideEffects: original.sideEffects } : {}),
  };
}
export function resolveExternalVersions(lockText, packages) {
  const documents = parseAllDocuments(lockText).map(document => {
    if (document.errors.length) throw document.errors[0];
    return document.toJS();
  });
  const candidates = documents.map((document, index) => ({ document, index })).filter(({ document }) =>
    packages.every(pkg => Object.hasOwn(document?.importers ?? {}, pkg.folder)));
  if (candidates.length !== 1) throw new Error('Pinned lock must have exactly one complete workspace importer document');
  const { document: lock, index: documentIndex } = candidates[0];
  for (const pkg of packages) {
    for (const name of pkg.dependencies.external) {
      const declared = pkg.originalManifest.dependencies?.[name] ?? pkg.originalManifest.optionalDependencies?.[name] ?? pkg.originalManifest.peerDependencies?.[name];
      const importer = lock.importers[pkg.folder];
      const entry = importer.dependencies?.[name] ?? importer.optionalDependencies?.[name] ?? importer.devDependencies?.[name];
      if (!declared || typeof entry?.version !== 'string' || entry.version.split('(')[0] !== EXTERNAL_VERSIONS[name]) throw new Error(`Pinned upstream importer differs for ${pkg.name}:${name}`);
    }
  }
  return { versions: EXTERNAL_VERSIONS, documentIndex, sha256: hash(lockText) };
}

/** Extract exact unpatched source, analyze it without executing it, and publish atomically. */
export async function buildSharedRuntime({ archive, cacheDir, output }) {
  output = path.resolve(output); await absent(output);
  const { root: source } = await extractPinnedSourceArchive(archive, cacheDir);
  const applied = await applySharedSourcePatches(source);
  const originals = new Map(applied.originals.map(file => [file.path, file.bytes]));
  const graph = await analyzeMobileSlice(source);
  const lockText = await fs.readFile(path.join(source, 'pnpm-lock.yaml'), 'utf8');
  const dependencyLock = resolveExternalVersions(lockText, graph.packages);
  const versions = dependencyLock.versions;
  await fs.mkdir(path.dirname(output), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(output), '.blackcrab-shared-runtime-'));
  const records = [], changes = [];
  async function write(relative, bytes, upstreamPath, sourcePatch) {
    const file = path.join(staging, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
    records.push({ path: relative, bytes: Buffer.byteLength(bytes), sha256: hash(bytes), ...(upstreamPath ? { upstreamPath, upstreamSha256: hash(originals.get(upstreamPath) ?? bytes) } : {}), ...(sourcePatch ? { sourcePatchId: sourcePatch.id } : {}) });
  }
  try {
    const selected = new Set(graph.files.map(file => file.path));
    for (const file of graph.files) {
      if (file.path.endsWith('/package.json')) throw new Error('Runtime imports of generated package metadata need an explicit source mapping');
      const bytes = await fs.readFile(path.join(source, file.path));
      if (hash(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Pinned source changed during export: ${file.path}`);
      await write(file.path, bytes, file.path, applied.patches.find(patch => patch.target === file.path));
    }
    for (const pkg of graph.packages) {
      const originalPath = `${pkg.folder}/package.json`, original = await fs.readFile(path.join(source, originalPath));
      if (hash(original) !== pkg.manifestSha256) throw new Error(`Pinned package metadata changed: ${pkg.name}`);
      await write(`upstream/manifests/${path.posix.basename(pkg.folder)}.json`, original, originalPath);
      for (const entry of await fs.readdir(path.join(source, pkg.folder), { withFileTypes: true })) {
        if (!/^(LICENSE|LICENCE|COPYING|NOTICE)([.-]|$)/i.test(entry.name)) continue;
        if (!entry.isFile()) throw new Error(`Unsupported package attribution entry: ${pkg.folder}/${entry.name}`);
        const relative = `${pkg.folder}/${entry.name}`;
        await write(relative, await fs.readFile(path.join(source, relative)), relative);
      }
      const generated = createConsumerManifest(pkg, selected, graph.packages, versions);
      await write(originalPath, serialize(generated));
      changes.push({ name: pkg.name, originalPath: `upstream/manifests/${path.posix.basename(pkg.folder)}.json`, originalSha256: hash(original), generatedPath: originalPath, generatedSha256: hash(serialize(generated)), reason: 'Restrict source exports and dependencies to the analyzed native client boundary; preserve runtime source unchanged.' });
    }
    for (const file of applied.originals) {
      await write(`upstream/original-files/${file.path}`, file.bytes, file.path);
    }
    for (const entry of await fs.readdir(SHARED_SOURCE_PATCH_DIRECTORY, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error('Shared source patch attribution must be regular files');
      await write(`source-patches/${entry.name}`, await fs.readFile(new URL(entry.name, SHARED_SOURCE_PATCH_DIRECTORY)));
    }
    await write('LICENSE.upstream' , await fs.readFile(path.join(source, 'LICENSE')), 'LICENSE');
    await write('upstream/pnpm-lock.yaml', lockText, 'pnpm-lock.yaml');
    await write('upstream/pnpm-workspace.yaml', await fs.readFile(path.join(source, 'pnpm-workspace.yaml')), 'pnpm-workspace.yaml');
    await write('IMPORT-GRAPH.json', serialize(graph));
    await write('PACKAGE-CHANGES.json', serialize(changes));
    const manifest = { schema: 1, kind: 'blackcrab-shared-native-runtime', upstream: UPSTREAM, sourcePatches: applied.patches, dependencyLock, externalVersions: versions, seeds: graph.seeds, packages: graph.packages.map(pkg => pkg.name), files: records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
    await fs.writeFile(path.join(staging, 'VENDOR-MANIFEST.json'), serialize(manifest));
    const { verifySharedRuntime } = await import('./verify.mjs');
    await verifySharedRuntime(staging);
    await absent(output); await fs.rename(staging, output);
    return { output, sourceRoot: source, packages: graph.packages.length, sourceFiles: graph.files.length, files: records.length, bytes: records.reduce((sum, file) => sum + file.bytes, 0), manifestSha256: hash(serialize(manifest)) };
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}
