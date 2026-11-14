import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { applyRecordedAdapter } from './generator.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
function adapted(file) {
  const path = 'src/features/layout/workspace/' + file;
  return applyRecordedAdapter(fs.readFileSync(new URL('../../vendor/t3-mobile/apps/mobile/' + path, import.meta.url)),
    registry.adapters.find(record => record.path === path)).toString();
}
function execute(source, scope) {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS }, fileName: 'fixture.ts' }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { ...scope, module, exports: module.exports });
  return module.exports;
}
function eventHandler(file, name, scope) {
  const source = adapted(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === name) expression = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(expression, name);
  return execute('export const handle = ' + expression, scope).handle;
}

test('iOS system tab feedback follows user selections, never programmatic or unknown tabs', () => {
  const events = [];
  const handler = eventHandler('WorkspaceNativeTabs.ios.tsx', 'onTabSelected', {
    setProvenance: p => events.push(['provenance', p]), primaryTabs: ['threads'],
    workspaceTabForNativeSlot: (_tabs, slot) => slot === 'primary' ? 'threads' : slot === 'settings' ? 'settings' : null,
    selectTab: tab => events.push(['navigate', tab]), navigationSelectionFeedback: () => events.push(['haptic']),
  });
  handler({ nativeEvent: { provenance: 1, actionOrigin: 'programmatic-js', selectedScreenKey: 'primary' } });
  handler({ nativeEvent: { provenance: 2, actionOrigin: 'user', selectedScreenKey: 'unknown' } });
  assert.deepEqual(events, [['provenance', 1], ['provenance', 2]]);
  for (const selectedScreenKey of ['primary', 'settings']) handler({ nativeEvent: { provenance: 3, actionOrigin: 'user', selectedScreenKey } });
  assert.deepEqual(events.slice(2), [['provenance', 3], ['haptic'], ['navigate', 'threads'], ['provenance', 3], ['haptic'], ['navigate', 'settings']]);
});
test('floating iOS tabs and compose emit one feedback and preserve their actions', () => {
  const events = [], props = { onNewTask: () => events.push('compose') };
  const scope = { tabs: ['threads', 'settings'], props,
    selectTab: tab => events.push(tab), navigationSelectionFeedback: () => events.push('select-feedback'),
    navigationComposeFeedback: () => events.push('compose-feedback') };
  const select = eventHandler('WorkspaceSidebarTabs.ios.tsx', 'onSelectionChange', scope);
  select({ nativeEvent: { tab: 'unknown' } }); assert.deepEqual(events, []);
  select({ nativeEvent: { tab: 'threads' } }); select({ nativeEvent: { tab: 'settings' } });
  const compose = eventHandler('WorkspaceSidebarTabs.ios.tsx', 'onCompose', scope);
  compose(); props.onNewTask = undefined; compose();
  assert.deepEqual(events, ['select-feedback', 'threads', 'select-feedback', 'settings', 'compose-feedback', 'compose']);
});
test('unsupported, disabled or failing haptics cannot reject or delay navigation', async () => {
  const source = fs.readFileSync(new URL('./adapters/navigationHaptics.ts', import.meta.url), 'utf8');
  let mode = 'pending', calls = [];
  const attempt = kind => { calls.push(kind); if (mode === 'throw') throw Error('unsupported');
    return mode === 'reject' ? Promise.reject(Error('unavailable')) : new Promise(() => {}); };
  const { navigationSelectionFeedback: select, navigationComposeFeedback: compose } = execute(source, {
    require: name => { assert.equal(name, 'expo-haptics'); return { selectionAsync: () => attempt('selection'),
      impactAsync: style => attempt(style), ImpactFeedbackStyle: { Light: 'light' } }; },
  });
  for (mode of ['pending', 'throw', 'reject']) { assert.equal(select(), undefined); assert.equal(compose(), undefined); }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['selection', 'light', 'selection', 'light', 'selection', 'light']);
});

test('Android bottom controls retain navigation and compose actions with feedback', () => {
  const events = [];
  const scope = {
    navigationSelectionFeedback: () => events.push('selection-feedback'),
    navigationComposeFeedback: () => events.push('compose-feedback'),
    Keyboard: { dismiss: () => events.push('dismiss-keyboard') },
    workspace: { dispatch: action => events.push(action.tab) },
    rootNavigationRef: { getRootState: () => undefined }, root: undefined,
    props: { onSelect: () => events.push('select'), onNewThread: () => events.push('compose') },
  };
  eventHandler('AndroidWorkspaceNavigation.android.tsx', 'onTabSelected', scope)({ nativeEvent: { tab: 'threads' } });
  eventHandler('AndroidWorkspaceNavigation.android.tsx', 'onNewThread', scope)();
  assert.deepEqual(events, ['selection-feedback', 'dismiss-keyboard', 'threads', 'select', 'compose-feedback', 'dismiss-keyboard', 'compose']);
});

test('Settings opens retained paired hosts through the existing voice ownership guard', async () => {
  const path = 'src/features/settings/SettingsRouteScreen.tsx';
  const source = applyRecordedAdapter(fs.readFileSync(new URL('../../vendor/t3-mobile/apps/mobile/' + path, import.meta.url)), registry.adapters.find(r => r.path === path)).toString();
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let action;
  function visit(node) {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => p.name?.getText(ast) === 'id' && p.initializer?.text === 'previousHosts')) {
      action = node.properties.find(p => p.name?.getText(ast) === 'onPress').initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(action);
  const { createRootLifecycle } = await import('./adapters/owned-root-lifecycle.mjs');
  const lifecycle = createRootLifecycle(), events = [];
  const press = execute('export const press = ' + action, { managedRootLifecycle: lifecycle,
    Keyboard: { dismiss: () => events.push('dismiss-keyboard') }, Alert: { alert: title => events.push(title) } }).press;
  lifecycle.setVoicePhase('recording'); press();
  assert.equal(lifecycle.isManagedVisible(), true);
  assert.deepEqual(events, ['Voice input is active']);
  lifecycle.setVoicePhase('idle'); press();
  assert.equal(lifecycle.isManagedVisible(), false);
  assert.deepEqual(events, ['Voice input is active', 'dismiss-keyboard']);
});
