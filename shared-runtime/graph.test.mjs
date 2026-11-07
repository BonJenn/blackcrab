import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeMobileSlice } from './graph.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcrab-mobile-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  const exports = {};
  for (const [key, file] of [['./connection', 'connection/index.ts'], ['./authorization', 'authorization/index.ts'], ['./rpc', 'rpc/index.ts'], ['./platform', 'platform/index.ts'], ['./relay', 'relay/index.ts'], ['./state/shell', 'state/shell.ts']]) {
    exports[key] = { types: './src/' + file, default: './src/' + file };
    write('packages/client-runtime/src/' + file, 'export const value = 1;\n');
  }
  write('packages/client-runtime/package.json', { name: '@t3tools/client-runtime', exports, dependencies: { effect: 'catalog:', '@unused/native-sdk': '1.0.0' } });
  return { root, write };
}
const connection = 'packages/client-runtime/src/connection/index.ts';

test('the slice is deterministic, records seed exports, and ignores unused SDK metadata', t => {
  const { root, write } = fixture(t);
  write(connection, 'import * as Effect from "effect/Effect"; import { sha256 } from "@noble/hashes/sha2"; export { Effect, sha256 };');
  write('packages/unrelated/package.json', { name: '@fixture/unrelated', exports: './server.ts', dependencies: { '@cursor/sdk': '1.2.0' } });
  write('packages/unrelated/server.ts', 'import fs from "node:fs"; export { fs };');
  const first = analyzeMobileSlice(root), second = analyzeMobileSlice(root);
  assert.deepEqual(first, second);
  assert.deepEqual(first.externalNames, ['@noble/hashes', 'effect']);
  assert.deepEqual(first.packages.map(pkg => pkg.name), ['@t3tools/client-runtime']);
  assert.deepEqual(first.packages[0].dependencies, { workspace: [], external: ['@noble/hashes', 'effect'] });
  assert.deepEqual([...new Set(first.packages[0].usedExports.map(value => value.key))].sort(), ['./authorization', './connection', './platform', './relay', './rpc', './state/shell']);
  assert.ok(first.packages[0].originalManifest.dependencies['@unused/native-sdk']);
  assert.ok(!JSON.stringify(first).includes(root));
  assert.equal(first.files.find(file => file.path === connection).sha256, createHash('sha256').update(fs.readFileSync(path.join(root, connection))).digest('hex'));
});

test('the public relay seed retains required service contexts even without another import', t => {
  const { root, write } = fixture(t);
  write('packages/client-runtime/src/relay/index.ts', 'export * as ManagedRelay from "./managedRelay.ts";');
  write('packages/client-runtime/src/relay/managedRelay.ts', 'import * as Context from "effect/Context"; export class ManagedRelayClient {} export class ManagedRelayDpopSigner {} export { Context };');
  const result = analyzeMobileSlice(root), client = result.packages.find(pkg => pkg.name === '@t3tools/client-runtime');
  assert.ok(result.seeds.includes('packages/client-runtime/src/relay/index.ts'));
  assert.ok(result.files.some(file => file.path === 'packages/client-runtime/src/relay/managedRelay.ts' && file.runtime));
  assert.ok(client.usedExports.some(value => value.key === './relay'));
  assert.deepEqual(client.dependencies.external, ['effect']);
});

test('type-only imports, inline import types, exports and import-equals remain available without becoming runtime files', t => {
  const { root, write } = fixture(t);
  write(connection, `
import type { A } from "../type.ts";
import { type B } from "../mixed-type.ts";
import type C = require("../equals-type.ts");
import runtime = require("../equals-runtime.ts");
export type * from "../export-type.ts";
export type D = import("../query.ts").D;
export * from "../barrel.ts";
void import("../lazy.ts");
export { runtime };
`);
  for (const file of ['type', 'mixed-type', 'equals-type', 'equals-runtime', 'export-type', 'query', 'barrel', 'lazy']) write('packages/client-runtime/src/' + file + '.ts', 'export interface A {} export interface B {} export interface D {} export const value = 1;');
  const result = analyzeMobileSlice(root), file = name => result.files.find(value => value.path === 'packages/client-runtime/src/' + name + '.ts');
  for (const name of ['type', 'mixed-type', 'equals-type', 'export-type', 'query']) assert.equal(file(name).runtime, false, name);
  for (const name of ['equals-runtime', 'barrel', 'lazy']) assert.equal(file(name).runtime, true, name);
  assert.ok(result.edges.some(edge => edge.kind === 'import-type-query' && edge.typeOnly));
  assert.ok(result.edges.some(edge => edge.kind === 'import-equals' && !edge.typeOnly));
});

test('workspace export keys/conditions and literal JSON imports are retained with actual dependency edges', t => {
  const { root, write } = fixture(t);
  write(connection, 'import { value } from "@fixture/data/client"; export { value };');
  write('packages/data/package.json', { name: '@fixture/data', exports: { './client': { types: './src/client.d.ts', import: './src/client.ts', default: './src/client.ts' } }, dependencies: { 'native-unused': '1' } });
  write('packages/data/src/client.ts', 'import value from "./value.json" with { type: "json" }; export { value };');
  write('packages/data/src/client.d.ts', 'export declare const value: { answer: number };');
  write('packages/data/src/value.json', '{"answer":42}');
  const result = analyzeMobileSlice(root), data = result.packages.find(pkg => pkg.name === '@fixture/data');
  assert.ok(result.files.find(file => file.path === 'packages/data/src/value.json' && file.runtime));
  assert.ok(result.files.find(file => file.path === 'packages/data/src/client.d.ts' && !file.runtime));
  assert.deepEqual(result.packages.find(pkg => pkg.name === '@t3tools/client-runtime').dependencies.workspace, ['@fixture/data']);
  assert.deepEqual(data.dependencies, { workspace: [], external: [] });
  assert.ok(data.usedExports.some(value => value.key === './client' && value.conditions.includes('import')));
  assert.ok(data.usedExports.some(value => value.key === './client' && value.conditions.includes('types')));
});

test('runtime barrels cannot hide Node imports even when their exported symbol would be unused', t => {
  const { root, write } = fixture(t);
  write(connection, 'export * from "../barrel.ts";');
  write('packages/client-runtime/src/barrel.ts', 'import fs from "node:fs"; export const unused = fs;');
  assert.throws(() => analyzeMobileSlice(root), /Node builtin/);
});

test('Node builtins and unsupported external dependencies fail closed, including type-only requirements', async t => {
  for (const source of ['import "fs";', 'import "node:fs/promises";', 'import type { Stats } from "node:fs";', 'import "@cursor/sdk";', 'import "@t3tools/missing";', 'import "effect/../fs";']) {
    await t.test(source, t => { const { root, write } = fixture(t); write(connection, source); assert.throws(() => analyzeMobileSlice(root), /Node builtin|unsupported external|unsafe package subpath/); });
  }
});

test('nonliteral imports and requires are rejected rather than guessed', async t => {
  for (const source of ['const name="./x.ts"; void import(name);', 'const name="./x.ts"; require(name);']) {
    await t.test(source, t => { const { root, write } = fixture(t); write(connection, source); assert.throws(() => analyzeMobileSlice(root), /nonliteral dynamic/); });
  }
});

test('missing local files and escaping import/export targets are rejected', async t => {
  for (const source of ['import "../missing.ts";', 'import "../../../../outside.ts";', 'import "/tmp/outside.ts";']) {
    await t.test(source, t => { const { root, write } = fixture(t); write(connection, source); assert.throws(() => analyzeMobileSlice(root), /unresolved source|escapes source root|absolute import/); });
  }
  await t.test('workspace target escape', t => { const { root, write } = fixture(t); write(connection, 'import "@fixture/data";'); write('packages/data/package.json', { name: '@fixture/data', exports: '../outside.ts' }); assert.throws(() => analyzeMobileSlice(root), /unsafe workspace export/); });
});

test('divergent runtime export conditions are rejected', t => {
  const { root, write } = fixture(t);
  write(connection, 'import "@fixture/data";');
  write('packages/data/package.json', { name: '@fixture/data', exports: { 'react-native': './native.ts', default: './other.ts' } });
  write('packages/data/native.ts', 'export {};'); write('packages/data/other.ts', 'export {};');
  assert.throws(() => analyzeMobileSlice(root), /ambiguous divergent runtime export targets/);
});

test('source roots and reached source or package paths cannot be symlinks', { skip: process.platform === 'win32' }, async t => {
  await t.test('root', t => { const { root } = fixture(t); const link = root + '-link'; t.after(() => fs.rmSync(link, { force: true })); fs.symlinkSync(root, link, 'dir'); assert.throws(() => analyzeMobileSlice(link), /real directory/); });
  await t.test('source', t => { const { root, write } = fixture(t); write(connection, 'import "../linked.ts";'); write('packages/client-runtime/src/real.ts', 'export {};'); fs.symlinkSync('real.ts', path.join(root, 'packages/client-runtime/src/linked.ts')); assert.throws(() => analyzeMobileSlice(root), /symbolic link/); });
  await t.test('package ancestor', t => { const { root } = fixture(t); fs.symlinkSync('client-runtime', path.join(root, 'packages/linked'), 'dir'); assert.throws(() => analyzeMobileSlice(root), /symbolic link/); });
});
