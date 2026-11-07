import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { UPSTREAM } from '../managed-host/artifact.mjs';
import { EXTERNAL_VERSIONS, createConsumerManifest, resolveExternalVersions } from './export.mjs';
import { analyzeMobileSlice } from './graph.mjs';
import { validateSharedSourcePatch, SHARED_SOURCE_PATCH_DIRECTORY } from './patches.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => { throw new Error(`Invalid shared native runtime: ${message}`); };

/** Verify checked-in source/metadata and recompute its actual consumer import boundary. */
export async function verifySharedRuntime(root) {
  root = path.resolve(root);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('root must be a real directory');
  const manifestFile = path.join(root, 'VENDOR-MANIFEST.json');
  const manifestStat = await fs.lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.size > 8 * 1024 * 1024) fail('manifest must be bounded regular JSON');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.schema !== 1 || manifest.kind !== 'blackcrab-shared-native-runtime' || !equal(manifest.upstream, UPSTREAM) || !equal(manifest.externalVersions, EXTERNAL_VERSIONS) || !Array.isArray(manifest.files) || manifest.files.length > 5000) fail('manifest metadata differs');
  const graphFile = path.join(root, 'IMPORT-GRAPH.json');
  const graphStat = await fs.lstat(graphFile);
  if (!graphStat.isFile() || graphStat.size > 8 * 1024 * 1024) fail('import graph must be bounded regular JSON');
  const graph = JSON.parse(await fs.readFile(graphFile, 'utf8'));
  if (!Array.isArray(graph.packages) || graph.packages.length > 100) fail('import graph package metadata differs');
  const dependencyDirectories = new Set();
  for (const pkg of graph.packages) {
    if (typeof pkg.folder !== 'string' || !/^packages\/[A-Za-z0-9._-]+$/.test(pkg.folder) || ['.', '..', 'node_modules'].includes(path.posix.basename(pkg.folder))) fail('unsafe import graph package folder');
    dependencyDirectories.add(`${pkg.folder}/node_modules`);
  }
  const registry = JSON.parse(await fs.readFile(new URL('registry.json', SHARED_SOURCE_PATCH_DIRECTORY), 'utf8'));
  if (!Array.isArray(registry) || registry.length !== 1) fail('known source patch registry differs');
  const descriptorKeys = ['id', 'target', 'sha256', 'beforeSha256', 'afterSha256', 'emittedJavaScriptSha256'];
  const knownPatches = registry.map(patch => Object.fromEntries(descriptorKeys.map(key => [key, patch[key]])));
  if (!equal(manifest.sourcePatches, knownPatches)) fail('known source patch list differs');
  const knownPatchTargets = new Map(knownPatches.map(patch => [patch.target, patch]));
  for (const patch of knownPatches) if (!manifest.files.some(file => file.path === patch.target)) fail('known source patch target is missing');
  const actual = [];
  async function walk(directory, depth = 0) {
    if (depth > 64) fail('tree is too deep');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), relative = path.relative(root, file).split(path.sep).join('/');
      if (entry.isSymbolicLink()) fail(`symbolic link: ${relative}`);
      // Only npm workspace package roots may hold consumer-installed dependencies.
      // A src/node_modules shadow would otherwise bypass the hashed source boundary.
      if (entry.name === 'node_modules') {
        if (!entry.isDirectory() || !dependencyDirectories.has(relative)) fail(`unexpected dependency directory: ${relative}`);
        continue;
      }
      if (entry.isDirectory()) { await walk(file, depth + 1); continue; }
      if (!entry.isFile()) fail(`non-file: ${relative}`);
      if (relative === 'VENDOR-MANIFEST.json') continue;
      if (actual.length >= 5000) fail('too many source files');
      const bytes = await fs.readFile(file); actual.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  await walk(root); actual.sort((a, b) => compare(a.path, b.path));
  if (actual.length !== manifest.files.length) fail('source file list differs');
  const usedPatches = new Set();
  for (let i = 0; i < actual.length; i++) {
    const found = actual[i], expected = manifest.files[i];
    if (found.path !== expected.path || found.bytes !== expected.bytes || found.sha256 !== expected.sha256) fail(`source integrity differs: ${found.path}`);
    const requiredPatch = knownPatchTargets.get(found.path);
    if (requiredPatch) {
      if (expected.upstreamPath !== found.path || expected.sourcePatchId !== requiredPatch.id || expected.upstreamSha256 !== requiredPatch.beforeSha256 || found.sha256 !== requiredPatch.afterSha256) fail('known source patch provenance differs');
      const original = await fs.readFile(path.join(root, 'upstream/original-files', found.path));
      validateSharedSourcePatch(original, await fs.readFile(path.join(root, found.path)), requiredPatch);
      usedPatches.add(requiredPatch.id);
    } else if (expected.upstreamPath && expected.upstreamSha256 !== found.sha256) {
      fail('unrecorded original source change');
    }
  }
  if (!Array.isArray(manifest.sourcePatches ?? []) || (manifest.sourcePatches ?? []).length !== usedPatches.size) fail('source patch list differs');
  if (usedPatches.size) {
    for (const entry of await fs.readdir(SHARED_SOURCE_PATCH_DIRECTORY, { withFileTypes: true })) {
      if (!entry.isFile()) fail('source patch attribution is not a regular file');
      const expected = await fs.readFile(new URL(entry.name, SHARED_SOURCE_PATCH_DIRECTORY));
      const found = await fs.readFile(path.join(root, 'source-patches', entry.name));
      if (hash(found) !== hash(expected)) fail('source patch attribution differs');
    }
  }
  const consumer = analyzeMobileSlice(root);
  if (!equal(consumer.files, graph.files) || !equal(consumer.externalNames, graph.externalNames) || !equal(graph.seeds, manifest.seeds)) fail('consumer source boundary differs');
  const packages = graph.packages.map(pkg => ({ name: pkg.name, folder: pkg.folder, dependencies: pkg.dependencies }));
  if (!equal(consumer.packages.map(pkg => ({ name: pkg.name, folder: pkg.folder, dependencies: pkg.dependencies })), packages) || !equal(manifest.packages, graph.packages.map(pkg => pkg.name))) fail('consumer dependency boundary differs');
  const lockText = await fs.readFile(path.join(root, 'upstream/pnpm-lock.yaml'), 'utf8');
  if (!equal(resolveExternalVersions(lockText, graph.packages), manifest.dependencyLock)) fail('dependency lock selection differs');
  const selected = new Set(graph.files.map(file => file.path));
  for (const pkg of graph.packages) {
    const original = await fs.readFile(path.join(root, 'upstream/manifests', `${path.posix.basename(pkg.folder)}.json`));
    if (hash(original) !== pkg.manifestSha256 || !equal(JSON.parse(original), pkg.originalManifest)) fail('original package metadata differs');
    const expected = createConsumerManifest(pkg, selected, graph.packages);
    const generated = JSON.parse(await fs.readFile(path.join(root, pkg.folder, 'package.json'), 'utf8'));
    if (!equal(generated, expected)) fail(`generated package metadata differs: ${pkg.name}`);
  }
  return { verified: true, packages: graph.packages.length, sourceFiles: graph.files.length, files: actual.length, externalVersions: EXTERNAL_VERSIONS };
}
