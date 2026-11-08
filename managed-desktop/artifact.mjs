import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NAMESPACE } from './descriptor.mjs';
export const UPSTREAM = Object.freeze({ repository: 'BonJenn/t3code', commit: '7f02de2eb8e253e0ec23f005b3cfff8e2c963be8', archiveSha256: 'eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6' });
export const ELECTRON = Object.freeze({ version: '44.10.1', platform: 'darwin', arch: 'arm64', archiveSha256: '687f922034f1e991ab34ed7f47c4cb4e5c5e85e974b0ce155c22ce6d6f699aa3', url: 'https://github.com/electron/electron/releases/download/v44.10.1/electron-v44.10.1-darwin-arm64.zip' });
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
export async function writeManifest(root, { sourcePatches, availability,qaPolicy }) {
 const manifest = { format: 1, kind: qaPolicy?'blackcrab-managed-desktop-qa':'blackcrab-managed-desktop', namespace: NAMESPACE, upstream: UPSTREAM, electron: ELECTRON, sourcePatches, availability,...(qaPolicy?{qaPolicy}:{}), files: await inventory(root) };
 await fs.writeFile(path.join(root,MANIFEST), JSON.stringify(manifest,null,2)+'\n'); return manifest;
}
export async function verifyArtifact(root, { expectedManifestSha256,allowQA=false } = {}) {
 const file = path.join(root,MANIFEST), stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 ** 2) throw Error('Invalid desktop manifest file');
 const bytes = await fs.readFile(file); if (expectedManifestSha256 && digest(bytes) !== expectedManifestSha256) throw Error('Desktop manifest trust digest mismatch');
 const manifest = JSON.parse(bytes); if (manifest.format !== 1 || (manifest.kind !== 'blackcrab-managed-desktop' && !(allowQA&&manifest.kind==='blackcrab-managed-desktop-qa'&&Array.isArray(manifest.qaPolicy))) || JSON.stringify(manifest.namespace) !== JSON.stringify(NAMESPACE) || JSON.stringify(manifest.upstream) !== JSON.stringify(UPSTREAM) || JSON.stringify(manifest.electron) !== JSON.stringify(ELECTRON)) throw Error('Desktop provenance/namespace mismatch');
 if(manifest.kind==='blackcrab-managed-desktop'&&Object.hasOwn(manifest,'qaPolicy'))throw Error('QA policy is not a production package');
 const registry = JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8'));
 if (JSON.stringify(manifest.sourcePatches) !== JSON.stringify(registry.map(({id,sha256})=>({id,sha256})))) throw Error('Desktop patch provenance mismatch');
 if(await fileDigest(path.join(root,'source-patches/registry.json'))!==await fileDigest(new URL('./patches/registry.json',import.meta.url)))throw Error('Packaged source registry differs from reviewed before/after records');
 if(manifest.kind==='blackcrab-managed-desktop-qa'){const policy=JSON.parse(await fs.readFile(path.join(root,'qa-policy/registry.json'),'utf8'));if(JSON.stringify(policy)!==JSON.stringify(manifest.qaPolicy))throw Error('QA policy registry differs');const payload=policy.find(p=>p.target==='apps/desktop/src/app/ManagedQA.ts');if(!payload||await fileDigest(path.join(root,'qa-policy/ManagedQA.ts'))!==payload.afterSha256)throw Error('QA policy payload differs');}
 for(const patch of registry)if(await fileDigest(path.join(root,'source-patches',patch.file))!==patch.sha256)throw Error('Packaged desktop source patch/payload differs');
 const assets=JSON.parse(await fs.readFile(new URL('./assets/registry.json',import.meta.url),'utf8'));for(const asset of assets)if(await fileDigest(path.join(root,'Blackcrab.app/Contents/Resources/app',asset.target))!==asset.afterSha256)throw Error('Packaged Blackcrab branding asset mismatch');
 if (!Array.isArray(manifest.files) || manifest.files.length > 50000) throw Error('Invalid desktop manifest inventory'); validateLinks(manifest.files);
 if (JSON.stringify(await inventory(root)) !== JSON.stringify(manifest.files)) throw Error('Desktop artifact integrity mismatch');
 if(!allowQA&&manifest.files.some(e=>e.path==='qa-policy'||e.path.startsWith('qa-policy/')))throw Error('QA artifact cannot be adopted as production');
 const packageJson=JSON.parse(await fs.readFile(path.join(root,'Blackcrab.app/Contents/Resources/app/package.json'),'utf8'));if(packageJson.blackcrabManagedClient!==(manifest.kind==='blackcrab-managed-desktop-qa'?'qa':'production'))throw Error('Desktop application role/provenance mismatch');
 const required = ['Blackcrab.app/Contents/MacOS/Blackcrab','Blackcrab.app/Contents/Resources/app/package.json','Blackcrab.app/Contents/Resources/app/apps/desktop/dist-electron/main.cjs','Blackcrab.app/Contents/Resources/app/apps/desktop/dist-electron/preload.cjs','Blackcrab.app/Contents/Resources/app/apps/server/dist/client/index.html','LICENSE.upstream','LICENSE.electron','BUILD-PROVENANCE.json'];
 for (const name of required) if (!manifest.files.some(e=>e.path===name&&e.type==='file')) throw Error(`Desktop package missing ${name}`);
 return manifest;
}
