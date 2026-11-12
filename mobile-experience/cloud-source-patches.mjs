import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applySourcePatchRecords } from '../managed-host/source.mjs';

const directory = fileURLToPath(new URL('../managed-host/patches/', import.meta.url));
const modules = ['connectAuth', 'providerAuthReturnUrl', 'threadLinks', 'promptLinks', 'remote', 'codexAuthHandoff'];
const targets = modules.flatMap(name => [`packages/shared/src/${name}.ts`, `packages/shared/src/${name}.test.ts`]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Reuse the desktop's exact patches, including its original test adaptations.
// Keep these runtime changes separate from the JavaScript-neutral RPC type patch.
export async function mobileCloudPatchRecords() {
  const registry = JSON.parse(await fs.readFile(path.join(directory, 'registry.json'), 'utf8'));
  return targets.map(target => {
    const matches = registry.filter(record => record.id.startsWith('owned-client-') && record.target === target);
    if (matches.length !== 1 || matches[0].kind !== undefined) throw new Error('Mobile cloud patch registry differs');
    return matches[0];
  });
}

function descriptor({ id, target, sha256, beforeSha256, afterSha256 }) {
  return { id, target, sha256, beforeSha256, afterSha256, kind: 'owned-cloud-runtime' };
}

export async function mobileCloudPatchDescriptors() {
  return (await mobileCloudPatchRecords()).map(descriptor);
}

export async function applyMobileCloudSourcePatches(root) {
  const records = await mobileCloudPatchRecords();
  const originals = await Promise.all(records.map(async record => ({ path: record.target, bytes: await fs.readFile(path.join(root, record.target)) })));
  await applySourcePatchRecords(root, { records, patchDirectory: directory });
  return { patches: records.map(descriptor), originals };
}

export async function validateMobileCloudSourcePatch(before, after, supplied) {
  const record = (await mobileCloudPatchRecords()).find(record => record.target === supplied.target);
  if (!record || JSON.stringify(supplied) !== JSON.stringify(descriptor(record))) throw new Error('Unregistered mobile cloud source patch');
  const patchBytes = await fs.readFile(path.join(directory, record.file));
  if (hash(patchBytes) !== record.sha256 || hash(before) !== record.beforeSha256) throw new Error('Mobile cloud source patch input differs');
  let expected = before.toString('utf8');
  for (const { before: anchor, after: replacement } of record.replacements) {
    if (!anchor || expected.split(anchor).length !== 2) throw new Error('Mobile cloud patch anchor differs');
    expected = expected.replace(anchor, () => replacement);
  }
  if (!Buffer.from(expected).equals(after) || hash(after) !== record.afterSha256) throw new Error('Mobile cloud source patch result differs');
}
