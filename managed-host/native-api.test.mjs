import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const original = await fs.readFile(new URL('./fixtures/local-api.before.ts', import.meta.url), 'utf8');
const registry = JSON.parse(await fs.readFile(new URL('./patches/registry.json', import.meta.url), 'utf8'));
const patches = registry.filter(entry => entry.target === 'apps/web/src/localApi.ts');
const hash = text => createHash('sha256').update(text).digest('hex');
let patched = original;
for (const patch of patches) {
  assert.equal(hash(patched), patch.beforeSha256);
  for (const replacement of patch.replacements) {
    assert.equal(patched.split(replacement.before).length, 2);
    patched = patched.replace(replacement.before, replacement.after);
  }
  assert.equal(hash(patched), patch.afterSha256);
}
const javascript = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client(native, desktop, withWindow = true) {
  const calls = [], exports = {};
  const window = { blackcrabNative: native, desktopBridge: desktop, open: (...args) => calls.push(['browser', ...args]) };
  const require = name => {
    switch (name) {
      case './confirmDialog': return { requestConfirmDialog: (...args) => { calls.push(['confirm', ...args]); return true; } };
      case './contextMenuFallback': return { showContextMenuFallback: (...args) => { calls.push(['menu', ...args]); return Promise.resolve('item'); }, dismissContextMenu: () => calls.push(['dismiss']) };
      case './clientPersistenceStorage': return { readBrowserClientSettings: () => ({ setting: true }), writeBrowserClientSettings: value => calls.push(['settings', value]) };
      default: throw new Error(`Unexpected runtime import ${name}`);
    }
  };
  const context = vm.createContext({ exports, require, ...(withWindow ? { window } : {}) });
  vm.runInContext(javascript, context, { timeout: 1000 });
  return { module: exports, api: exports.createLocalApi(), calls, window };
}
test('ordinary browser retains picker absence and external-link fallback', async () => {
  const c = client(); assert.equal(c.module.hasBlackcrabNativeBridge(), false);
  assert.equal(await c.api.dialogs.pickFolder(), null);
  await c.api.shell.openExternal('https://example.com/help');
  assert.deepEqual(c.calls, [['browser', 'https://example.com/help', '_blank', 'noopener,noreferrer']]);
  assert.equal(await c.api.dialogs.confirm('Continue?'), true);
  assert.equal(await c.api.contextMenu.show([{ id: 'item', label: 'Item' }]), 'item');
  await c.api.contextMenu.close();
  assert.equal(c.calls.at(-1)[0], 'dismiss');
  assert.equal((await c.api.persistence.getClientSettings()).setting, true);
});
test('native picker forwards options and cancellation without entering Electron mode', async () => {
  const options = { initialPath: '/tmp/project', targetEnvironmentId: 'env_fixture' }, requests = [];
  const native = Object.freeze({ apiVersion: 1, pickFolder: async value => { requests.push(value); return null; }, openExternal: async () => true });
  const c = client(native);
  assert.equal(c.module.hasBlackcrabNativeBridge(), true);
  assert.equal(c.window.desktopBridge, undefined);
  assert.equal(await c.api.dialogs.pickFolder(options), null); assert.equal(requests[0], options);
  assert.equal((await c.api.persistence.getClientSettings()).setting, true);
  await assert.rejects(c.api.shell.openSystemSettings('privacy'), /Unable to open System Settings/);
});
test('native success is returned; native failures never fall through to browser or Electron', async () => {
  const calls = [], desktop = { pickFolder: async () => { throw Error('unexpected Electron'); }, openExternal: async () => { throw Error('unexpected Electron'); } };
  const native = { apiVersion: 1, pickFolder: async () => '/tmp/chosen', openExternal: async url => { calls.push(url); return true; } };
  const c = client(native, desktop);
  assert.equal(await c.api.dialogs.pickFolder(), '/tmp/chosen');
  await c.api.shell.openExternal('https://example.com'); assert.deepEqual(calls, ['https://example.com']); assert.deepEqual(c.calls, []);
  native.openExternal = async () => false;
  await assert.rejects(c.api.shell.openExternal('https://example.com'), /Unable to open link/);
  native.pickFolder = async () => { throw Error('picker unavailable'); };
  await assert.rejects(c.api.dialogs.pickFolder(), /picker unavailable/); assert.deepEqual(c.calls, []);
});
test('unknown or partial native API versions retain browser behavior', async () => {
  for (const native of [{ apiVersion: 2, pickFolder() { throw Error('unknown'); }, openExternal() {} }, { apiVersion: 1, pickFolder() { throw Error('partial'); } }]) {
    const c = client(native); assert.equal(c.module.hasBlackcrabNativeBridge(), false);
    assert.equal(await c.api.dialogs.pickFolder(), null);
    await c.api.shell.openExternal('https://example.com'); assert.equal(c.calls[0][0], 'browser');
  }
});
test('genuine Electron bridge retains its existing delegation', async () => {
  const calls = [], desktop = { pickFolder: async value => { calls.push(value); return '/electron'; }, openExternal: async () => true, openSystemSettings: async () => true, showContextMenu: async () => 'native-item', getClientSettings: async () => ({ native: true }), setClientSettings: async value => calls.push(value) };
  const c = client(undefined, desktop); const options = { initialPath: '/tmp' };
  assert.equal(await c.api.dialogs.pickFolder(options), '/electron'); assert.equal(calls[0], options);
  await c.api.shell.openExternal('https://example.com'); await c.api.shell.openSystemSettings('privacy');
  assert.equal(await c.api.contextMenu.show([]), 'native-item'); assert.equal((await c.api.persistence.getClientSettings()).native, true);
  assert.deepEqual(c.calls, []);
});
test('server rendering does not require a browser window', () => {
  const c = client(undefined, undefined, false);
  assert.equal(c.module.readLocalApi(), undefined); assert.equal(c.module.hasBlackcrabNativeBridge(), false);
});

test('native namespace leaves the actual upstream Electron detector false', async () => {
  // Vite import.meta.env is a build/platform boundary; leave detector code unchanged.
  const source = (await fs.readFile(new URL('./fixtures/env.before.ts', import.meta.url), 'utf8')).replaceAll('import.meta.env', '({})');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const native = Object.freeze({ apiVersion: 1, pickFolder: async () => null, openExternal: async () => true });
  for (const [window, expected] of [[{ blackcrabNative: native }, false], [{ desktopBridge: {} }, true], [{}, false]]) {
    const exports = {};
    vm.runInNewContext(code, { exports, window }, { timeout: 1000 });
    assert.equal(exports.isElectron, expected);
  }
});

test('the patched command-palette gate permits native folders only for the primary environment', async () => {
  const original = await fs.readFile(new URL('./fixtures/project-picker.before.ts', import.meta.url), 'utf8');
  const pickerPatch = registry.find(entry => entry.id === 'managed-native-folder-picker-entry');
  const replacement = pickerPatch.replacements.find(entry => entry.before.includes('typeof window'));
  assert.equal(original.split(replacement.before).length, 2);
  const gate = original.replace(replacement.before, replacement.after) + '\nglobalThis.result = canOpenProjectFromFileManager;';
  const native = client({ apiVersion: 1, pickFolder: async () => null, openExternal: async () => true });
  const base = { isBrowsing: true, browseEnvironmentId: 'primary', primaryEnvironmentId: 'primary', browseEnvironmentIsDesktopLocal: false, browseDesktopInstanceId: null, window: native.window, hasBlackcrabNativeBridge: native.module.hasBlackcrabNativeBridge };
  function allowed(overrides = {}) { const context = { ...base, ...overrides }; vm.runInNewContext(gate, context, { timeout: 1000 }); return context.result; }
  assert.equal(allowed(), true);
  assert.equal(allowed({ isBrowsing: false }), false);
  assert.equal(allowed({ browseEnvironmentId: null }), false);
  assert.equal(allowed({ browseEnvironmentId: 'other', browseEnvironmentIsDesktopLocal: true, browseDesktopInstanceId: 'pool' }), false);
  assert.equal(allowed({ window: undefined }), false);
  const browser = client(); assert.equal(allowed({ window: browser.window, hasBlackcrabNativeBridge: browser.module.hasBlackcrabNativeBridge }), false);
  assert.equal(allowed({ window: { desktopBridge: {} }, browseEnvironmentId: 'other', browseEnvironmentIsDesktopLocal: true, browseDesktopInstanceId: 'pool' }), true);
});

test('native adapter typechecks against the retained canonical LocalApi contract', () => {
  const root = fileURLToPath(new URL('./__native_typecheck__/', import.meta.url));
  const files = new Map([
    ['localApi.ts', patched],
    ['confirmDialog.ts', 'import type {LocalApi} from "@t3tools/contracts"; export declare const requestConfirmDialog: (...args: Parameters<LocalApi["dialogs"]["confirm"]>) => ReturnType<LocalApi["dialogs"]["confirm"]> | undefined;'],
    ['contextMenuFallback.ts', 'import type {LocalApi} from "@t3tools/contracts"; export declare const showContextMenuFallback: LocalApi["contextMenu"]["show"]; export declare const dismissContextMenu: () => void;'],
    ['clientPersistenceStorage.ts', 'import type {LocalApi} from "@t3tools/contracts"; export declare const readBrowserClientSettings: LocalApi["persistence"]["getClientSettings"]; export declare const writeBrowserClientSettings: LocalApi["persistence"]["setClientSettings"];'],
    ['desktop.d.ts', 'import type {DesktopBridge} from "@t3tools/contracts"; declare global { interface Window { desktopBridge?: DesktopBridge } } export {};'],
  ].map(([name, text]) => [root + name, text]));
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, types: [] };
  const host = ts.createCompilerHost(options), originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host), originalDirectory = host.directoryExists?.bind(host);
  host.readFile = file => files.get(file) ?? originalRead(file);
  host.fileExists = file => files.has(file) || originalExists(file);
  host.directoryExists = directory => directory.replace(/\/$/, '') === root.replace(/\/$/, '') || Boolean(originalDirectory?.(directory));
  host.getSourceFile = (file, languageVersion) => { const text = host.readFile(file); return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true); };
  const program = ts.createProgram([root + 'localApi.ts', root + 'desktop.d.ts'], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: file => file, getNewLine: () => '\n' }));
});

test('optional project-icon capability preserves old bridges and forwards only local picker options', async () => {
  const base = { apiVersion: 1, pickFolder: async () => null, openExternal: async () => true };
  assert.equal(client(base).module.readBlackcrabNativeProjectFaviconPicker(), undefined);
  const requests = [], native = { ...base, pickProjectFavicon: async options => { requests.push(options); return '/outside/project/Icon.ICNS'; } };
  const c = client(native);
  assert.equal(await c.module.readBlackcrabNativeProjectFaviconPicker()('/workspace'), '/outside/project/Icon.ICNS');
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ initialPath: '/workspace' }]);
  native.pickProjectFavicon = async () => null;
  assert.equal(await c.module.readBlackcrabNativeProjectFaviconPicker()(), null);
  native.pickProjectFavicon = async () => { throw Error('image picker unavailable'); };
  await assert.rejects(c.module.readBlackcrabNativeProjectFaviconPicker()('/workspace'), /unavailable/);
  for (const value of [null, 1, 'unsupported']) assert.equal(client({ ...base, pickProjectFavicon: value }).module.readBlackcrabNativeProjectFaviconPicker(), undefined);
});
async function patchedFixture(fixture, target) {
  let text = await fs.readFile(new URL('./fixtures/' + fixture, import.meta.url), 'utf8');
  for (const entry of registry.filter(entry => entry.target === target)) {
    assert.equal(hash(text), entry.beforeSha256);
    for (const replacement of entry.replacements) { assert.equal(text.split(replacement.before).length, 2); text = text.replace(replacement.before, replacement.after); }
    assert.equal(hash(text), entry.afterSha256);
  }
  return text;
}
test('exported icon adapter preserves browser/Electron support and native cancellation/errors', async () => {
  const source = await patchedFixture('project-favicon-picker.before.tsx', 'apps/web/src/components/settings/ProjectFaviconPickerDialog.tsx');
  const tree = ts.createSourceFile('picker.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const adapter = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readExternalProjectFaviconPicker');
  assert.ok(adapter);
  const js = ts.transpileModule(adapter.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  function picker(native, desktop, withWindow = true) {
    const c = client(native, desktop, withWindow), exports = {};
    vm.runInNewContext(js, { exports, ...(withWindow ? { window: c.window } : {}), readBlackcrabNativeProjectFaviconPicker: c.module.readBlackcrabNativeProjectFaviconPicker });
    return exports.readExternalProjectFaviconPicker();
  }
  assert.equal(picker(undefined, undefined), undefined);
  assert.equal(picker(undefined, undefined, false), undefined);
  const desktop = { pickProjectFavicon: async path => 'electron:' + path };
  assert.equal(await picker(undefined, desktop)('/project'), 'electron:/project');
  const base = { apiVersion: 1, pickFolder: async () => null, openExternal: async () => true };
  assert.equal(await picker(base, desktop)('/project'), 'electron:/project');
  assert.equal(await picker({ ...base, pickProjectFavicon: async () => null }, desktop)('/project'), null);
  await assert.rejects(picker({ ...base, pickProjectFavicon: async () => { throw Error('native failure'); } }, desktop)('/project'), /native failure/);
});
test('project icon entry requires every member to remain primary and locally eligible', async () => {
  const source = await patchedFixture('project-settings.before.tsx', 'apps/web/src/components/settings/ProjectSettingsPanel.tsx');
  const match = source.match(/const pickProjectFavicon =([\s\S]*?);/); assert.ok(match);
  function gate(members, withWindow = true) {
    let adapterCalls = 0;
    const chosen = vm.runInNewContext('(' + match[1] + ')', { ...(withWindow ? { window: {} } : {}), group: { memberProjects: members }, primaryEnvironmentId: 'primary', navigator: { platform: 'MacIntel' }, canPickExternalProjectFavicon: cwd => cwd.startsWith('/'), readExternalProjectFaviconPicker: () => { adapterCalls++; return 'picker'; } });
    return { chosen, adapterCalls };
  }
  assert.deepEqual(gate([{ environmentId: 'primary', workspaceRoot: '/workspace' }]), { chosen: 'picker', adapterCalls: 1 });
  for (const members of [[{ environmentId: 'remote', workspaceRoot: '/workspace' }], [{ environmentId: 'primary', workspaceRoot: '/workspace' }, { environmentId: 'remote', workspaceRoot: '/other' }], [{ environmentId: 'primary', workspaceRoot: 'C:\\WSL' }]]) {
    assert.deepEqual(gate(members), { chosen: undefined, adapterCalls: 0 });
  }
  assert.deepEqual(gate([{ environmentId: 'primary', workspaceRoot: '/workspace' }], false), { chosen: undefined, adapterCalls: 0 });
});
