import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const magic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

export function validateSigningIdentity(identity, teamId) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '') ||
      typeof identity !== 'string' ||
      !identity.startsWith('Developer ID Application: ') ||
      !identity.endsWith(` (${teamId})`) || /[\r\n\0]/.test(identity)) {
    throw Error('An explicit Developer ID Application identity and matching team are required');
  }
}

export function validateSignatureDetails(details, {teamId, identity, executable = true}) {
  validateSigningIdentity(identity, teamId);
  const lines = new Set(details.trim().split(/\r?\n/));
  if (!lines.has(`TeamIdentifier=${teamId}`) || !lines.has(`Authority=${identity}`) ||
      !/^Timestamp=.+$/m.test(details) || /^(?:Signature=adhoc|Timestamp=none)$/m.test(details) ||
      (executable && !/^CodeDirectory .*flags=.*\bruntime\b/m.test(details))) {
    throw Error('Release code signature lacks the required identity, timestamp, or hardened runtime');
  }
}

/** Do not follow links: the artifact verifier separately authenticates their topology. */
export async function machoFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name), stat = await fs.lstat(file);
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile() && stat.size >= 4) {
        const handle = await fs.open(file, 'r'), bytes = Buffer.alloc(4);
        try { await handle.read(bytes, 0, 4, 0); } finally { await handle.close(); }
        if (magic.has(bytes.toString('hex'))) files.push(path.relative(root, file));
      }
    }
  }
  await visit(root);
  return files;
}

export async function verifySignature(file, options, {deep = false} = {}) {
  await exec('/usr/bin/codesign', ['--verify', '--strict', ...(deep ? ['--deep'] : []), file], {timeout: 300000});
  const {stderr} = await exec('/usr/bin/codesign', ['-d', '--verbose=4', file], {timeout: 30000});
  validateSignatureDetails(stderr, options);
}

/** Signing may alter native code and signature seals, never JavaScript or resource content. */
export function verifySigningDelta(before, after, binaries) {
  const old = new Map(before.map(entry => [entry.path, entry]));
  const native = new Set(binaries);
  const changed = [];
  const seal = value => /(?:^|\/)_(?:CodeSignature)\/CodeResources$/.test(value) || /(?:^|\/)Contents\/CodeResources$/.test(value);
  for (const entry of after) {
    const previous = old.get(entry.path);
    old.delete(entry.path);
    if (JSON.stringify(previous) === JSON.stringify(entry)) continue;
    const allowed = entry.type === 'file' && (native.has(entry.path) || seal(entry.path));
    const sealDirectory = !previous && entry.type === 'directory' && entry.path.endsWith('/_CodeSignature');
    if ((!allowed && !sealDirectory) || (previous && previous.type !== entry.type) ||
        (previous?.type === 'file' && previous.executable !== entry.executable)) {
      throw Error('Signing changed non-signature artifact content: ' + entry.path);
    }
    changed.push(entry.path);
  }
  if (old.size) throw Error('Signing removed artifact content: ' + old.keys().next().value);
  return changed;
}
