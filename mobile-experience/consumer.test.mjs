import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unionConsumerGraphs, createExperienceConsumerManifests } from './consumer.mjs';
const pkg = { name: '@t3tools/test', folder: 'packages/test', manifestSha256: 'a', originalManifest: { version: '1.0.0', license: 'MIT' }, usedExports: [{ key: './connection', conditions: ['import'], target: 'packages/test/src/connection.ts' }], dependencies: { workspace: [], external: ['effect'] } };
const graph = { seeds: ['a'], files: [{ path: 'a', sha256: 'x', runtime: false }], packages: [pkg], edges: [], externalNames: ['effect'] };
test('union retains direct entries and runtime flags deterministically', () => { const direct = { ...graph, seeds: ['b'], files: [{ path: 'a', sha256: 'x', runtime: true }], packages: [{ ...pkg, usedExports: [{ key: './relay', conditions: ['import'], target: 'packages/test/src/relay.ts' }] }] }; const a = unionConsumerGraphs(graph, direct); assert.deepEqual(a.seeds, ['a', 'b']); assert.equal(a.files[0].runtime, true); assert.equal(a.packages[0].usedExports.length, 2); assert.throws(() => unionConsumerGraphs(graph, { ...direct, files: [{ path: 'a', sha256: 'different' }] }), /disagreement/); });
test('consumer metadata omits unreachable executors and pins actual source deps', () => { const lock = { owners: [{ name: pkg.name, actualExternalEdges: [{ name: 'effect', manifestName: 'effect', groups: ['dependencies'] }], groups: { dependencies: { effect: { resolution: '4.1.2(peer@1)' } } } }] }; const m = createExperienceConsumerManifests(graph, lock)['packages/test/package.json']; assert.deepEqual(m.dependencies, { effect: '4.1.2' }); assert.equal(m.exports['./connection'].import, './src/connection.ts'); assert.equal(m.scripts, undefined); assert.throws(() => createExperienceConsumerManifests(graph, { owners: [] }), /Missing/); });

test('recomputed source closure rejects injected dependency edges and extra source files', async () => {
  const { validateConsumerGraphClosure } = await import('./consumer.mjs');
  validateConsumerGraphClosure(graph, structuredClone(graph));
  const injected = structuredClone(graph); injected.packages[0].dependencies.external.push('unreachable-sdk');
  assert.throws(() => validateConsumerGraphClosure(injected, graph), /closure differs/);
  const extra = structuredClone(graph); extra.files.push({ path: 'node-only.ts', sha256: 'x', runtime: true });
  assert.throws(() => validateConsumerGraphClosure(extra, graph), /closure differs/);
});
test('original preparation paths cannot escape or inspect installed dependency trees', async () => {
  const { validatePreparationPaths } = await import('./consumer.mjs');
  for(const path of ['source/../../secret','source/packages/x/node_modules/shadow/file.js','C:secret','source\\secret','source/file\nname'])assert.throws(()=>validatePreparationPaths({files:[{path}]}),/Unsafe/);
  validatePreparationPaths({files:[{path:'source/packages/shared/package.json'}]});
});
