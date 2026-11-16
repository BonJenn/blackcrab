// Adds the Linux and Windows installers to a release's update manifest.
//
// The Apple-silicon release job writes latest.json first. This reads that
// manifest, checks each installer against its updater signature and the public
// key the launcher is built with, and writes the manifest for all three
// platforms. It never signs anything and never talks to the network.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const REPOSITORY = 'BonJenn/blackcrab';
const DARWIN = ['darwin-aarch64', 'darwin-aarch64-app'];
// The updater asks for `<os>-<arch>-<installer kind>` first, then `<os>-<arch>`.
// A .deb installation must never be offered the AppImage, so Linux has no
// plain `linux-x86_64` entry.
const ADDED = {
  windows: {keys: ['windows-x86_64', 'windows-x86_64-nsis'], name: /^Blackcrab_\d+\.\d+\.\d+_x64-setup\.exe$/},
  appimage: {keys: ['linux-x86_64-appimage'], name: /^Blackcrab_\d+\.\d+\.\d+_amd64\.AppImage$/},
  deb: {keys: ['linux-x86_64-deb'], name: /^Blackcrab_\d+\.\d+\.\d+_amd64\.deb$/},
};

function lines(base64, what) {
  const text = Buffer.from(String(base64).trim(), 'base64').toString('utf8').split('\n');
  if (text.length < 2 || !text[0].startsWith('untrusted comment:')) throw Error(what + ' is not in minisign form');
  return text;
}

/** Verifies a Tauri updater signature (minisign, Ed25519) over `bytes`. */
export function verifyUpdaterSignature(bytes, signature, publicKey) {
  const key = Buffer.from(lines(publicKey, 'The updater public key')[1], 'base64');
  const signed = lines(signature, 'The updater signature');
  const blob = Buffer.from(signed[1], 'base64');
  if (key.length !== 42 || key.subarray(0, 2).toString('latin1') !== 'Ed' || blob.length !== 74) throw Error('Unexpected updater key or signature length');
  const algorithm = blob.subarray(0, 2).toString('latin1');
  if (!blob.subarray(2, 10).equals(key.subarray(2, 10))) throw Error('The updater signature was made with a different key');
  // "ED" signs the BLAKE2b-512 digest of the file; the older "Ed" signs the file.
  const message = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : algorithm === 'Ed' ? bytes : null;
  if (!message) throw Error('Unknown updater signature algorithm');
  const object = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki'});
  if (!verify(null, message, object, blob.subarray(10))) throw Error('The updater signature does not match the file');
  // The trusted comment is signed too: signature bytes followed by the comment.
  const comment = signed[2]?.startsWith('trusted comment: ') ? signed[2].slice('trusted comment: '.length) : null;
  const global = Buffer.from(signed[3] ?? '', 'base64');
  if (comment === null || global.length !== 64 || !verify(null, Buffer.concat([blob.subarray(10), Buffer.from(comment, 'utf8')]), object, global)) throw Error('The updater signature comment is not signed');
}

function releaseUrl(tag, name) { return `https://github.com/${REPOSITORY}/releases/download/${tag}/${name}`; }

/** Checks a complete three-platform manifest. `deb` says whether it must carry a .deb entry. */
export function validateReleaseManifest(value, {tag, deb}) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '') || value?.version !== tag.slice(1)) throw Error('The update manifest is for a different version');
  const expected = [...DARWIN, ...ADDED.windows.keys, ...ADDED.appimage.keys, ...(deb ? ADDED.deb.keys : [])].sort();
  if (JSON.stringify(Object.keys(value.platforms ?? {}).sort()) !== JSON.stringify(expected)) throw Error('The update manifest names unexpected platforms');
  const patterns = Object.fromEntries([...DARWIN.map(key => [key, /^Blackcrab[^/]*_aarch64\.app\.tar\.gz$/]), ...Object.values(ADDED).flatMap(kind => kind.keys.map(key => [key, kind.name]))]);
  for (const [key, entry] of Object.entries(value.platforms)) {
    const url = new URL(entry.url), name = url.pathname.split('/').pop();
    if (url.origin !== 'https://github.com' || url.search || url.hash || url.username || url.password
      || url.pathname !== `/${REPOSITORY}/releases/download/${tag}/${name}` || !patterns[key].test(name)
      || typeof entry.signature !== 'string' || !entry.signature.trim()) throw Error('Update entry ' + key + ' points to the wrong release, file or signature');
    if (!key.startsWith('darwin') && !name.includes('_' + tag.slice(1) + '_')) throw Error('Update entry ' + key + ' is for a different version');
  }
  return value;
}

/** `installers`: {windows, appimage, deb?}, each {name, bytes, signature}. */
export function mergeUpdateManifest(existing, {tag, publicKey, installers}) {
  if (JSON.stringify(Object.keys(existing?.platforms ?? {}).sort()) !== JSON.stringify(DARWIN)) throw Error('Expected the Apple-silicon update manifest to add to');
  const platforms = {...existing.platforms};
  for (const kind of ['windows', 'appimage', 'deb']) {
    const installer = installers[kind];
    if (!installer) { if (kind === 'deb') continue; throw Error('Missing the ' + kind + ' installer'); }
    verifyUpdaterSignature(installer.bytes, installer.signature, publicKey);
    for (const key of ADDED[kind].keys) platforms[key] = {signature: installer.signature.trim(), url: releaseUrl(tag, installer.name)};
  }
  return validateReleaseManifest({...existing, platforms}, {tag, deb: Boolean(installers.deb)});
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const {values} = parseArgs({options: {tag: {type: 'string'}, manifest: {type: 'string'}, windows: {type: 'string'}, appimage: {type: 'string'}, deb: {type: 'string'}, out: {type: 'string'}}});
  for (const name of ['tag', 'manifest', 'windows', 'appimage', 'out']) if (!values[name]) throw Error('--' + name + ' is required');
  const publicKey = JSON.parse(await fs.readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).plugins.updater.pubkey;
  const installers = {};
  for (const kind of ['windows', 'appimage', 'deb']) {
    if (!values[kind]) continue;
    installers[kind] = {name: path.basename(values[kind]), bytes: await fs.readFile(values[kind]), signature: await fs.readFile(values[kind] + '.sig', 'utf8')};
  }
  const merged = mergeUpdateManifest(JSON.parse(await fs.readFile(values.manifest, 'utf8')), {tag: values.tag, publicKey, installers});
  await fs.writeFile(values.out, JSON.stringify(merged, null, 2) + '\n', {flag: 'wx'});
  console.log('Update manifest now covers: ' + Object.keys(merged.platforms).sort().join(', '));
}
