import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLockedTauriVersions } from './check-tauri-versions.mjs';

const compatible = {
  api: '2.11.1', 'plugin-opener': '2.5.4', 'plugin-notification': '2.3.3',
  'plugin-updater': '2.10.1', 'plugin-dialog': '2.7.1', 'plugin-process': '2.3.1',
};
const failedRelease = {
  api: '2.12.4', 'plugin-opener': '2.7.2', 'plugin-notification': '2.8.0',
  'plugin-updater': '2.14.1', 'plugin-dialog': '2.8.4', 'plugin-process': '2.4.0',
};
function fixture(versions = compatible) {
  const entries = Object.entries(versions);
  return { packages: {
    '': { dependencies: Object.fromEntries(entries.map(([name, version]) => [`@tauri-apps/${name}`, version])) },
    ...Object.fromEntries(entries.map(([name, version]) => [`node_modules/@tauri-apps/${name}`, { version }])),
  } };
}
const cargo = Object.entries(compatible).map(([name, version]) =>
  `[[package]]\nname = "${name === 'api' ? 'tauri' : `tauri-${name}`}"\nversion = "${version}"\n`,
).join('\n');

test('accepts compatible locked major/minor families, including distinct patch versions and CRLF', () => {
  assert.equal(checkLockedTauriVersions(fixture({ ...compatible, api: '2.11.2' }), cargo.replaceAll('\n', '\r\n')), 6);
});
test('rejects each of the six mismatches that stopped the actual Mac release', () => {
  for (const [name, version] of Object.entries(failedRelease)) {
    assert.throws(() => checkLockedTauriVersions(fixture({ ...compatible, [name]: version }), cargo),
      (error) => error.message.includes(`@tauri-apps/${name} (${version})`));
  }
});
test('rejects missing npm resolution, missing Rust resolution, and ambiguous Rust versions', () => {
  const lock = fixture(); delete lock.packages['node_modules/@tauri-apps/api'];
  assert.throws(() => checkLockedTauriVersions(lock, cargo), /missing/);
  assert.throws(() => checkLockedTauriVersions(fixture(), cargo.replace('name = "tauri"', 'name = "unrelated"')), /missing or ambiguous/);
  assert.throws(() => checkLockedTauriVersions(fixture(), cargo + '\n[[package]]\nname = "tauri"\nversion = "2.12.0"\n'), /ambiguous/);
});
test('does not accept an empty dependency graph as a successful compatibility check', () => {
  assert.throws(() => checkLockedTauriVersions({ packages: {} }, cargo), /root Tauri API/);
});
