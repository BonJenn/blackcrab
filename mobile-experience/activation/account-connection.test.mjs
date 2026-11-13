import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { applyRecordedAdapter, digest } from './generator.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
const originalRoot = new URL('../../vendor/t3-mobile/apps/mobile/', import.meta.url);
function adapted(path) {
  const record = registry.adapters.find(record => record.path === path);
  return applyRecordedAdapter(fs.readFileSync(new URL(path, originalRoot)), record).toString();
}
function evaluate(source, scope = {}, dependencies = {}) {
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }, fileName: 'fixture.tsx' }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { ...scope, module, exports: module.exports,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    require: name => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

test('account loading times out, recovers when auth finishes, and cleans up on unmount', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const addition = registry.additions.find(r => r.path.endsWith('/AccountConnectionStatus.tsx'));
  const source = fs.readFileSync(new URL(addition.template, import.meta.url));
  assert.equal(digest(source), addition.sha256);
  const { useAccountConnectionStatus, AccountConnectionPending, ACCOUNT_CONNECTION_WAIT_MS } = evaluate(source.toString(), {}, {
    'react-native': { View: ({children}) => React.createElement('section', null, children),
      ActivityIndicator: () => React.createElement('progress') },
    '../../components/ui/EmptyState': { EmptyState: ({ title, detail, onAction, actionLabel }) =>
      React.createElement('div', null, title, detail, React.createElement('button', { onClick: onAction }, actionLabel)) },
  });
  let back = 0;
  function Screen({ loaded }) {
    const status = useAccountConnectionStatus(loaded);
    return status === 'ready' ? React.createElement('div', null, 'Ready to sign in')
      : React.createElement(AccountConnectionPending, { status, onBack: () => back++ });
  }
  const element = document.getElementById('root'), root = createRoot(element);
  try {
    act(() => root.render(React.createElement(Screen, { loaded: false })));
    assert.match(element.textContent, /Connecting to Blackcrab Account/);
    act(() => t.mock.timers.tick(ACCOUNT_CONNECTION_WAIT_MS));
    assert.match(element.textContent, /Blackcrab Account is unavailable/);
    assert.match(element.textContent, /saved environments and drafts are kept/);
    assert.equal(element.querySelector('progress'), null);
    act(() => element.querySelector('button').click()); assert.equal(back, 1);
    act(() => root.render(React.createElement(Screen, { loaded: true })));
    assert.equal(element.textContent, 'Ready to sign in');
    act(() => root.render(React.createElement(Screen, { loaded: false })));
    assert.match(element.textContent, /Connecting to Blackcrab Account/);
  } finally {
    act(() => root.unmount());
    act(() => t.mock.timers.tick(ACCOUNT_CONNECTION_WAIT_MS));
    dom.window.close();
    globalThis.window = previous.window; globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test('the actual Settings account row remains actionable before auth loads', () => {
  const source = adapted('src/features/settings/SettingsRouteScreen.tsx');
  const ast = ts.createSourceFile('settings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'ConfiguredSettingsRouteScreen');
  let loaded = false, signedIn = false, status = 'loading', destination;
  const { ConfiguredSettingsRouteScreen: render } = evaluate('export ' + fn.getText(ast), {
    useNavigation: () => ({ navigate: value => { destination = value; } }),
    useAuth: () => ({ isLoaded: loaded, isSignedIn: signedIn }),
    useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'fixture@example.test' } } }),
    useSavedRemoteConnections: () => ({ savedConnectionsById: { retained: {} } }),
    useAccountConnectionStatus: () => status,
    SettingsList: 'list', environmentsRow: count => ({ count }),
  });
  for (const expected of ['Connecting…', 'Unavailable']) {
    const rows = render().props.connections;
    assert.equal(rows[0].label, 'Blackcrab Account');
    assert.equal(rows[0].value, expected);
    assert.ok(!rows[0].disabled); rows[0].onPress(); assert.equal(destination, 'SettingsAuth');
    assert.equal(rows[1].count, 1);
    status = 'unavailable';
  }
  loaded = true; assert.equal(render().props.connections[0].value, 'Sign in');
  signedIn = true; assert.equal(render().props.connections[0].value, 'fixture@example.test');
});

test('auth route renders recovery instead of an empty page and Connect sign-in stays reachable', () => {
  const auth = adapted('src/features/settings/SettingsAuthRouteScreen.tsx');
  assert.match(auth, /AccountConnectionPending status=/);
  assert.match(auth, /hasBeenSignedIn && isLoaded && isSignedIn === false/);
  const connections = adapted('src/features/connection/ConnectionsNewRouteScreen.tsx');
  assert.match(connections, /label="Sign in to Blackcrab Connect"/);
  assert.doesNotMatch(connections, /disabled=\{!isLoaded\}/);
});
