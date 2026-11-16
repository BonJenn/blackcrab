import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {mergeUpdateManifest, validateReleaseManifest, verifyUpdaterSignature} from './release-update-manifest.mjs';

// A throwaway key in the same minisign form the Tauri CLI writes.
function signer() {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const raw = publicKey.export({format: 'der', type: 'spki'}).subarray(-32), id = Buffer.from('0102030405060708', 'hex');
  const encode = text => Buffer.from(text).toString('base64');
  return {
    publicKey: encode('untrusted comment: minisign public key\n' + Buffer.concat([Buffer.from('Ed'), id, raw]).toString('base64') + '\n'),
    sign(bytes, {prehashed = true, keyId = id} = {}) {
      const signature = sign(null, prehashed ? createHash('blake2b512').update(bytes).digest() : bytes, privateKey), comment = 'timestamp:1\tfile:fixture';
      const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
      return encode(`untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from(prehashed ? 'ED' : 'Ed'), keyId, signature]).toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`);
    },
  };
}
const tag = 'v0.4.5', mac = 'https://github.com/BonJenn/blackcrab/releases/download/v0.4.5/Blackcrab_aarch64.app.tar.gz';
const existing = () => ({version: '0.4.5', notes: 'n', pub_date: 'd', platforms: {'darwin-aarch64': {signature: 'mac', url: mac}, 'darwin-aarch64-app': {signature: 'mac', url: mac}}});
function installers(key, {deb = true} = {}) {
  const make = name => { const bytes = Buffer.from('installer ' + name); return {name, bytes, signature: key.sign(bytes)}; };
  return {windows: make('Blackcrab_0.4.5_x64-setup.exe'), appimage: make('Blackcrab_0.4.5_amd64.AppImage'), ...(deb ? {deb: make('Blackcrab_0.4.5_amd64.deb')} : {})};
}

test('signatures verify only for the exact bytes and the launcher key', () => {
  const key = signer(), other = signer(), bytes = Buffer.from('payload');
  verifyUpdaterSignature(bytes, key.sign(bytes), key.publicKey);
  verifyUpdaterSignature(bytes, key.sign(bytes, {prehashed: false}), key.publicKey);
  assert.throws(() => verifyUpdaterSignature(Buffer.from('other'), key.sign(bytes), key.publicKey), /does not match/);
  assert.throws(() => verifyUpdaterSignature(bytes, other.sign(bytes), key.publicKey), /does not match/);
  assert.throws(() => verifyUpdaterSignature(bytes, key.sign(bytes, {keyId: Buffer.alloc(8)}), key.publicKey), /different key/);
  assert.throws(() => verifyUpdaterSignature(bytes, 'not a signature', key.publicKey));
});

test('the merged manifest keeps the Mac entries and adds each installer under the keys the updater asks for', () => {
  const key = signer(), merged = mergeUpdateManifest(existing(), {tag, publicKey: key.publicKey, installers: installers(key)});
  assert.deepEqual(Object.keys(merged.platforms).sort(), ['darwin-aarch64', 'darwin-aarch64-app', 'linux-x86_64-appimage', 'linux-x86_64-deb', 'windows-x86_64', 'windows-x86_64-nsis']);
  assert.deepEqual(merged.platforms['darwin-aarch64'], existing().platforms['darwin-aarch64']);
  assert.equal(merged.platforms['windows-x86_64'].url, 'https://github.com/BonJenn/blackcrab/releases/download/v0.4.5/Blackcrab_0.4.5_x64-setup.exe');
  assert.deepEqual(merged.platforms['windows-x86_64-nsis'], merged.platforms['windows-x86_64']);
  assert.match(merged.platforms['linux-x86_64-appimage'].url, /_amd64\.AppImage$/);
  // A .deb installation is never offered the AppImage.
  assert.equal(merged.platforms['linux-x86_64'], undefined);
  const without = mergeUpdateManifest(existing(), {tag, publicKey: key.publicKey, installers: installers(key, {deb: false})});
  assert.equal(without.platforms['linux-x86_64-deb'], undefined);
});

test('a wrong signature, version, base manifest or missing installer stops the merge', () => {
  const key = signer(), good = installers(key);
  assert.throws(() => mergeUpdateManifest(existing(), {tag, publicKey: key.publicKey, installers: {...good, windows: {...good.windows, bytes: Buffer.from('rebuilt')}}}), /does not match/);
  assert.throws(() => mergeUpdateManifest(existing(), {tag: 'v0.4.6', publicKey: key.publicKey, installers: good}), /different version/);
  assert.throws(() => mergeUpdateManifest(existing(), {tag, publicKey: key.publicKey, installers: {...good, appimage: undefined}}), /Missing/);
  assert.throws(() => mergeUpdateManifest({...existing(), platforms: {}}, {tag, publicKey: key.publicKey, installers: good}), /Apple-silicon/);
  const merged = mergeUpdateManifest(existing(), {tag, publicKey: key.publicKey, installers: good});
  assert.throws(() => mergeUpdateManifest(merged, {tag, publicKey: key.publicKey, installers: good}), /Apple-silicon/);
  const renamed = {...good.windows, name: 'Blackcrab_0.4.4_x64-setup.exe'};
  assert.throws(() => mergeUpdateManifest(existing(), {tag, publicKey: key.publicKey, installers: {...good, windows: renamed}}), /different version/);
});

test('a finished manifest is refused if any entry leaves the release', () => {
  const key = signer(), merged = mergeUpdateManifest(existing(), {tag, publicKey: key.publicKey, installers: installers(key)});
  validateReleaseManifest(merged, {tag, deb: true});
  assert.throws(() => validateReleaseManifest(merged, {tag, deb: false}), /unexpected platforms/);
  for (const url of ['https://example.com/BonJenn/blackcrab/releases/download/v0.4.5/Blackcrab_0.4.5_x64-setup.exe', 'https://github.com/BonJenn/blackcrab/releases/download/v0.4.4/Blackcrab_0.4.5_x64-setup.exe', 'https://github.com/BonJenn/blackcrab/releases/download/v0.4.5/Blackcrab_0.4.5_amd64.AppImage']) {
    const changed = structuredClone(merged); changed.platforms['windows-x86_64'].url = url;
    assert.throws(() => validateReleaseManifest(changed, {tag, deb: true}), /wrong release, file or signature/);
  }
});
