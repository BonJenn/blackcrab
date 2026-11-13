import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const UPSTREAM = Object.freeze({ repository: 'BonJenn/t3code', commit: '7f02de2eb8e253e0ec23f005b3cfff8e2c963be8', archiveSha256: 'eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6' });
import {desktopTarget} from './targets.mjs';
// Keep the production manifest fixed to the implemented Mac producer.
export const ELECTRON = desktopTarget('darwin-arm64').electron;
export const MANIFEST = 'blackcrab-managed-desktop.json';
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function fileDigest(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
export function relativePath(value) { if (typeof value !== 'string' || value.length > 4096 || !value || value.includes('\\') || value.includes('\0') || value.includes(':') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe desktop artifact path'); return value; }
export function validateLinks(entries) {
 const lookup = new Map(entries.map(e => [relativePath(e.path), e])); if (lookup.size !== entries.length) throw Error('Duplicate artifact path');
 for (const entry of entries) if (entry.type === 'symlink') {
  if (typeof entry.target !== 'string' || !entry.target || entry.target.length > 1024 || entry.target.startsWith('/') || /[\\\0:]/.test(entry.target)) throw Error('Unsafe artifact link');
  let current = entry.path; const seen = new Set();
  for (let depth = 0;; depth++) {
   if (depth >= 32 || seen.has(current)) throw Error('Cyclic or excessive artifact links'); seen.add(current);
   const parts = current.split('/'); let changed = false;
   for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0,i).join('/'), link = lookup.get(prefix);
    if (link?.type !== 'symlink') continue;
    const next = path.posix.normalize(path.posix.join(path.posix.dirname(prefix), link.target, ...parts.slice(i)));
    relativePath(next); current = next; changed = true; break;
   }
   if (!changed) { if (!lookup.has(current)) throw Error('Dangling artifact link'); break; }
  }
 }
}
export async function inventory(root) {
 const entries = []; let bytes = 0;
 async function visit(directory, prefix = '') {
  for (const name of (await fs.readdir(directory)).sort()) {
   const relative = prefix ? `${prefix}/${name}` : name; relativePath(relative); if (relative === MANIFEST) continue;
   const file = path.join(directory,name), stat = await fs.lstat(file); if (entries.length >= 50000) throw Error('Desktop artifact entry bound exceeded');
   if (stat.isSymbolicLink()) entries.push({ path: relative, type: 'symlink', target: await fs.readlink(file) });
   else if (stat.isDirectory()) { entries.push({ path: relative, type: 'directory' }); await visit(file,relative); }
   else if (stat.isFile()) { bytes += stat.size; if (bytes > 8 * 1024 ** 3) throw Error('Desktop artifact byte bound exceeded'); entries.push({ path: relative, type: 'file', bytes: stat.size, executable: Boolean(stat.mode & 0o111), sha256: await fileDigest(file) }); }
   else throw Error('Unsupported desktop artifact entry');
  }
 }
 const stat = await fs.lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Desktop artifact root is not a real directory'); await visit(root); validateLinks(entries); return entries;
}
