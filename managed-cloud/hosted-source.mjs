import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareSource } from '../managed-desktop/source.mjs';
import { applySourcePatchRecords } from '../managed-host/source.mjs';
import { hostedAssociationFiles, hostedOutputConfig, hostedWebConfigFromEnvironment } from './hosted-config.mjs';

const patchDirectory = fileURLToPath(new URL('./hosted-patches/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';

export async function configureHostedSource(source, config) {
  const records = JSON.parse(await fs.readFile(path.join(patchDirectory, 'registry.json'), 'utf8'));
  const inputs = JSON.parse(await fs.readFile(path.join(patchDirectory, 'asset-inputs.json'), 'utf8'));
  const publicRoot = path.join(source, 'apps/web/public'), originals = new Map();
  for (const [relative, expected] of Object.entries(inputs)) {
    const target = path.join(publicRoot, relative), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Hosted asset input must be an original regular file.');
    const bytes = await fs.readFile(target);
    if (hash(bytes) !== expected) throw new Error('Hosted asset input differs from the pinned source: ' + relative);
    originals.set(relative, bytes);
  }
  const sourcePatches = await applySourcePatchRecords(source, { records, patchDirectory });
  const changes = [];
  async function replaceAsset(relative, bytes) {
    const before = originals.get(relative);
    await fs.writeFile(path.join(publicRoot, relative), bytes, before ? undefined : { flag: 'wx' });
    changes.push({ path: 'apps/web/public/' + relative, beforeSha256: before ? hash(before) : null, afterSha256: hash(bytes) });
  }
  for (const [name, value] of Object.entries(hostedAssociationFiles(config))) await replaceAsset('.well-known/' + name, Buffer.from(json(value)));
  const icon = await fs.readFile(new URL('../apps/mobile/assets/blackcrab.png', import.meta.url));
  if (icon.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Owned web icon must be PNG.');
  await replaceAsset('blackcrab.png', icon);
  await replaceAsset('apple-touch-icon.png', icon);
  const manifest = JSON.parse(originals.get('manifest.webmanifest').toString());
  manifest.name = 'Blackcrab'; manifest.short_name = 'Blackcrab';
  manifest.icons = [{ src: '/blackcrab.png', sizes: `${icon.readUInt32BE(16)}x${icon.readUInt32BE(20)}`, type: 'image/png' }];
  await replaceAsset('manifest.webmanifest', Buffer.from(json(manifest)));
  const output = hostedOutputConfig(config);
  const project = { framework: null, installCommand: '', buildCommand: '', outputDirectory: 'dist', git: { deploymentEnabled: false }, routes: output.routes };
  const projectBytes = Buffer.from(json(project));
  await fs.writeFile(path.join(source, 'apps/web/blackcrab-hosted-project.json'), projectBytes, { flag: 'wx' });
  changes.push({ path: 'apps/web/blackcrab-hosted-project.json', beforeSha256: null, afterSha256: hash(projectBytes) });
  const tests = await fs.readFile(new URL('./hosted-tests.config.ts', import.meta.url));
  await fs.writeFile(path.join(source, 'blackcrab-hosted-test.config.ts'), tests, { flag: 'wx' });
  changes.push({ path: 'blackcrab-hosted-test.config.ts', beforeSha256: null, afterSha256: hash(tests) });
  const result = { sourcePatches, assets: changes, config, deployed: false };
  await fs.writeFile(path.join(source, 'BLACKCRAB-HOSTED-SOURCE.json'), json(result), { flag: 'wx' });
  return result;
}

export async function prepareHostedWeb({ archive, cacheDir, environment = process.env }) {
  const config = hostedWebConfigFromEnvironment(environment);
  const prepared = await prepareSource({ archive, cacheDir });
  const hosted = await configureHostedSource(prepared.source, config);
  return { ...prepared, hosted };
}
