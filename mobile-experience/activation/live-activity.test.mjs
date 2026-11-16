import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { digest } from './generator.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
const read = name => fs.readFileSync(new URL('./adapters/' + name, import.meta.url), 'utf8');

function load(name, dependencies, scope = {}) {
  const code = ts.transpileModule(read(name), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }, fileName: name }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { ...scope, module, exports: module.exports, Date, JSON, Number, Map, Math, Promise,
    require: id => { assert.ok(id in dependencies, 'Unexpected dependency ' + id); return dependencies[id]; } });
  return module.exports;
}

function progressModule(overrides = {}) {
  const state = { activities: [], started: [], threads: [], projects: [], listeners: [], appState: [] };
  const threadShellsAtom = { name: 'threads' }, projectsAtom = { name: 'projects' };
  const exports = load('liveActivityProgress.ts', {
    '@t3tools/contracts': { isListedThreadLineage: lineage => lineage !== 'child' },
    '@t3tools/shared/orchestrationV2PendingBackgroundWork': { backgroundWorkHoldsCompletion: tasks => tasks.some(task => task.awaited === true) },
    'react-native': { Platform: { OS: overrides.os ?? 'ios' }, AppState: { addEventListener: (_, listener) => { state.appState.push(listener); return { remove() {} }; } } },
    '../../state/atom-registry': { appAtomRegistry: {
      get: atom => atom === threadShellsAtom ? state.threads : state.projects,
      subscribe: (atom, listener) => { state.listeners.push(listener); return () => {}; },
    } },
    '../../state/projects': { environmentProjects: { projectsAtom } },
    '../../state/threads': { environmentThreadShells: { threadShellsAtom } },
    './agentLiveActivity': {
      getAgentLiveActivities: () => state.activities,
      startAgentLiveActivity: (props, staleDate) => { const activity = { getId: () => 'sample', props, staleDate, end: async () => {} }; state.started.push(activity); return activity; },
    },
  }, { setTimeout: overrides.setTimeout ?? (() => 1), clearTimeout: () => {} });
  return { exports, state };
}

const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
function thread(id, changes = {}) {
  return { environmentId: 'env', id, projectId: 'project', title: 'Thread ' + id, itemCount: 5, updatedAt: ago(1),
    settledOverride: null, archivedAt: null, deletedAt: null, pendingBackgroundTasks: [], modelSelection: { model: 'model-x' },
    listed: true, status: 'running', activityRunStatus: 'running', activityRunStartedAt: ago(4), latestRunStartedAt: ago(4),
    latestRunStopRequested: false, pendingRequestKind: null, pendingRequestAt: null, latestMessage: null, ...changes };
}
const projects = [{ environmentId: 'env', id: 'project', title: 'storefront' }];

test('the registry ships the owned Live Activity layout, progress writer and brand mark', () => {
  const widget = registry.adapters.find(record => record.path === 'src/widgets/AgentActivity.tsx');
  assert.equal(widget.kind, 'template'); assert.equal(widget.template, 'adapters/AgentActivity.tsx');
  assert.equal(widget.templateSha256, digest(Buffer.from(read('AgentActivity.tsx'))));
  const addition = registry.additions.find(record => record.path === 'src/features/agent-awareness/liveActivityProgress.ts');
  assert.equal(addition.sha256, digest(Buffer.from(read('liveActivityProgress.ts'))));
  const app = registry.adapters.find(record => record.path === 'src/App.tsx');
  assert.ok(app.replacements.some(change => change.after.includes('installLiveActivityProgress(),')));
  const layout = read('AgentActivity.tsx');
  // The pinned widget drew upstream's mark; the owned one draws the crab and opens Blackcrab.
  assert.match(layout, /assetName="BlackcrabMark"/); assert.doesNotMatch(layout, /T3Mark|t3code:/);
  assert.match(layout, /`blackcrab-remote:\/\/\$\{/);
  assert.match(layout, /dateStyle="timer"/); assert.match(layout, /<ProgressView/);
  const config = JSON.parse(fs.readFileSync(new URL('../../apps/mobile/app.json', import.meta.url))).expo;
  const names = config.plugins.map(entry => Array.isArray(entry) ? entry[0] : entry);
  // Native mods run in reverse: the mark is added after expo-widgets creates its target.
  assert.ok(names.indexOf('./plugins/with-widget-brand-mark.cjs') >= 0);
  assert.ok(names.indexOf('./plugins/with-widget-brand-mark.cjs') < names.indexOf('expo-widgets'));
  for (const file of ['BlackcrabMark.png', 'BlackcrabMark@2x.png', 'BlackcrabMark@3x.png']) {
    assert.ok(fs.existsSync(new URL('../../apps/mobile/assets/widget/' + file, import.meta.url)), file);
  }
});

test('a thread phase follows the rule the computer publishes with', () => {
  const { progressPhase } = progressModule().exports;
  assert.equal(progressPhase(thread('a')), 'running');
  assert.equal(progressPhase(thread('a', { activityRunStatus: 'starting' })), 'starting');
  assert.equal(progressPhase(thread('a', { pendingRequestKind: 'user_input' })), 'waiting_for_input');
  assert.equal(progressPhase(thread('a', { pendingRequestKind: 'approval' })), 'waiting_for_approval');
  assert.equal(progressPhase(thread('a', { pendingRequestKind: 'auth_refresh' })), 'running');
  const done = { activityRunStatus: null, status: 'completed' };
  assert.equal(progressPhase(thread('a', done)), 'completed');
  assert.equal(progressPhase(thread('a', { ...done, settledOverride: 'settled' })), null);
  assert.equal(progressPhase(thread('a', { ...done, latestRunStopRequested: true })), null);
  assert.equal(progressPhase(thread('a', { ...done, pendingBackgroundTasks: [{ kind: 'shell', awaited: true }] })), 'running');
  assert.equal(progressPhase(thread('a', { activityRunStatus: null, status: 'failed' })), 'failed');
  assert.equal(progressPhase(thread('a', { activityRunStatus: null, status: 'idle' })), null);
  assert.equal(progressPhase(thread('a', { activityRunStatus: null, status: 'interrupted' })), null);
});

test('step detail is the last plain line of what the agent said', () => {
  const { progressDetail } = progressModule().exports;
  assert.equal(progressDetail('## Plan\n\n- Read the test\n- **Running** the `checkout` suite now'), 'Running the checkout suite now');
  assert.equal(progressDetail('Done.\n```ts\nconst hidden = 1;\n```\n'), 'Done.');
  assert.equal(progressDetail('See [the log](https://example.test/log) for details'), 'See the log for details');
  assert.equal(progressDetail('   \n\n'), null);
  const long = progressDetail('word '.repeat(80));
  assert.equal(long.length, 140); assert.ok(long.endsWith('…'));
});

test('the card lists what needs the user first and carries progress for each agent', () => {
  const { buildProgressActivity } = progressModule().exports;
  const result = buildProgressActivity({ nowMs: NOW, projects, threads: [
    thread('working', { latestMessage: { role: 'assistant', text: 'Reading files\n\nRunning the test suite', updatedAt: ago(0.5) }, itemCount: 37 }),
    thread('approval', { pendingRequestKind: 'approval', pendingRequestAt: ago(2), latestMessage: { role: 'assistant', text: 'May I run npm install?', updatedAt: ago(2) } }),
    thread('finished', { activityRunStatus: null, status: 'completed', updatedAt: ago(6) }),
    thread('old', { activityRunStatus: null, status: 'completed', updatedAt: ago(40) }),
    thread('settled', { activityRunStatus: null, status: 'completed', settledOverride: 'settled' }),
    thread('idle', { activityRunStatus: null, status: 'idle' }),
    thread('child', { listed: false }),
    thread('archived', { archivedAt: ago(1) }),
    thread('elsewhere', { projectId: 'unknown-project' }),
  ] });
  assert.equal(result.title, 'Blackcrab'); assert.equal(result.subtitle, 'Agent work in progress');
  assert.equal(result.activeCount, 2);
  // Compared as text: the module runs in its own context, so its arrays are not this file's.
  assert.equal(JSON.stringify(result.activities.map(row => [row.threadId, row.phase, row.status])),
    JSON.stringify([['approval', 'waiting_for_approval', 'Approval'], ['working', 'running', 'Working'], ['finished', 'completed', 'Done']]));
  const [approval, working, finished] = result.activities;
  assert.equal(working.detail, 'Running the test suite'); assert.equal(working.detailAt, ago(0.5));
  assert.equal(working.startedAt, ago(4)); assert.equal(working.steps, 37);
  assert.equal(working.projectTitle, 'storefront'); assert.equal(working.modelTitle, 'model-x');
  assert.equal(working.deepLink, '/threads/env/working');
  // A waiting row counts the wait and leaves the words to the layout's call to action.
  assert.equal(approval.updatedAt, ago(2)); assert.equal(approval.detail, undefined);
  assert.equal(finished.startedAt, undefined); assert.equal(finished.detail, undefined);
});

test('finished work alone reports its outcome, and nothing to show yields no card', () => {
  const { buildProgressActivity } = progressModule().exports;
  const done = buildProgressActivity({ nowMs: NOW, projects, threads: [thread('a', { activityRunStatus: null, status: 'failed', updatedAt: ago(3) })] });
  assert.equal(done.activeCount, 0); assert.equal(done.subtitle, 'Agent work failed');
  assert.equal(buildProgressActivity({ nowMs: NOW, projects, threads: [thread('a', { activityRunStatus: null, status: 'idle' })] }), null);
  const many = buildProgressActivity({ nowMs: NOW, projects, threads: Array.from({ length: 8 }, (_, index) => thread('t' + index)) });
  assert.equal(many.activities.length, 5); assert.equal(many.activeCount, 8);
});

test('progress is written only into an existing card, and again when the app leaves the foreground', () => {
  const timers = [];
  const { exports, state } = progressModule({ setTimeout: callback => { timers.push(callback); return timers.length; } });
  const shell = (id, extra = {}) => ({ environmentId: 'env', id, projectId: 'project', title: 'Thread ' + id, itemCount: 3, updatedAt: ago(1),
    settledOverride: null, archivedAt: null, deletedAt: null, pendingBackgroundTasks: [], modelSelection: { model: 'model-x' }, lineage: 'root',
    source: { status: 'running', activityRunStatus: 'running', activityRunStartedAt: new Date(NOW - 60_000), latestRunStartedAt: null,
      pendingRuntimeRequest: null, latestVisibleMessage: { role: 'assistant', text: 'Editing the reducer', updatedAt: { epochMilliseconds: NOW - 5_000 } }, ...extra } });
  state.projects = projects; state.threads = [shell('a')];
  const stop = exports.installLiveActivityProgress();
  timers.shift()();
  assert.equal(state.started.length, 0, 'never starts a card');
  const updates = []; state.activities = [{ getId: () => 'real', update: async (props, staleDate) => { updates.push({ props, staleDate }); } }];
  for (const listener of state.listeners) listener();
  timers.shift()();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].props.activities[0].detail, 'Editing the reducer');
  assert.equal(updates[0].props.activities[0].startedAt, new Date(NOW - 60_000).toISOString());
  assert.ok(updates[0].staleDate instanceof Date);
  // Unchanged contents are not written again.
  for (const listener of state.listeners) listener(); timers.shift()();
  assert.equal(updates.length, 1);
  state.threads = [shell('a', { latestVisibleMessage: { role: 'assistant', text: 'Running tests', updatedAt: { epochMilliseconds: NOW } } })];
  state.appState[0]('background');
  assert.equal(updates.length, 2); assert.equal(updates[1].props.activities[0].detail, 'Running tests');
  stop();
  assert.equal(progressModule({ os: 'android' }).exports.installLiveActivityProgress()(), undefined);
});

test('the sample card is an example with every kind of row', () => {
  const { exports, state } = progressModule();
  const sample = exports.sampleProgressActivity(NOW);
  assert.equal(sample.activities.map(row => row.phase).join(), 'running,waiting_for_approval,completed');
  assert.equal(sample.activeCount, 2); assert.doesNotMatch(JSON.stringify(sample), /T3/);
  assert.equal(exports.showSampleLiveActivity(), true); assert.equal(state.started.length, 1);
  // A card already on screen is left alone.
  state.activities = [{ getId: () => 'real' }];
  assert.equal(exports.showSampleLiveActivity(), true); assert.equal(state.started.length, 1);
});

test('account deletion unlinks computers and unregisters the phone before deleting the account', async () => {
  const order = []; let confirm, alerts = [];
  const React = require('react');
  const { useAccountDeletion } = load('AccountDeletion.tsx', {
    '@clerk/expo': {
      useAuth: () => ({ getToken: async () => 'token', isLoaded: true, isSignedIn: true }),
      useUser: () => ({ user: { delete: async () => { order.push('delete-account'); } } }),
    },
    react: { useRef: value => ({ current: value }), useState: value => [value, () => {}] },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View' },
    '../../components/ui/AppActivityIndicator': { AppActivityIndicator: 'Indicator' },
    '../../components/ui/Dialog': { confirm: request => { confirm = request; }, alert: (...args) => { alerts.push(args); } },
    '../../lib/runtime': { runtime: { runPromiseExit: async effect => { order.push(effect); } } },
    '../../state/use-atom-command': { useAtomCommand: () => async input => { order.push('unlink:' + input.environmentId); if (input.environmentId === 'b') throw new Error('relay offline'); } },
    '../agent-awareness/remoteRegistration': { unregisterAgentAwarenessDeviceForCurrentUser: () => 'unregister-phone' },
    './managedRelayState': { deregisterManagedRelayEnvironmentCommand: {}, useManagedRelayEnvironments: () => ({ accountId: 'account', data: [{ environmentId: 'a' }, { environmentId: 'b' }] }) },
    './publicConfig': { resolveRelayClerkTokenOptions: () => ({}) },
  });
  assert.ok(React);
  const deletion = useAccountDeletion();
  assert.equal(deletion.available, true);
  deletion.requestDeletion();
  assert.equal(confirm.destructive, true); assert.equal(confirm.confirmText, 'Delete account');
  assert.match(confirm.message, /cannot be undone/); assert.deepEqual(order, [], 'nothing happens before confirmation');
  confirm.onConfirm(); await new Promise(resolve => setImmediate(resolve));
  // A relay failure does not stop the account itself from being deleted.
  assert.deepEqual(order, ['unlink:a', 'unlink:b', 'unregister-phone', 'delete-account']);
  assert.equal(alerts[0][0], 'Account deleted');
});

test('a failed account deletion is reported and deletion is offered only when signed in', async () => {
  let confirm; const alerts = [];
  const dependencies = signedIn => ({
    '@clerk/expo': {
      useAuth: () => ({ getToken: async () => 'token', isLoaded: true, isSignedIn: signedIn }),
      useUser: () => ({ user: signedIn ? { delete: async () => { throw { errors: [{ longMessage: 'Verify your identity first.' }] }; } } : null }),
    },
    react: { useRef: value => ({ current: value }), useState: value => [value, () => {}] },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View' },
    '../../components/ui/AppActivityIndicator': { AppActivityIndicator: 'Indicator' },
    '../../components/ui/Dialog': { confirm: request => { confirm = request; }, alert: (...args) => { alerts.push(args); } },
    '../../lib/runtime': { runtime: { runPromiseExit: async () => {} } },
    '../../state/use-atom-command': { useAtomCommand: () => async () => {} },
    '../agent-awareness/remoteRegistration': { unregisterAgentAwarenessDeviceForCurrentUser: () => 'unregister-phone' },
    './managedRelayState': { deregisterManagedRelayEnvironmentCommand: {}, useManagedRelayEnvironments: () => ({ accountId: null, data: null }) },
    './publicConfig': { resolveRelayClerkTokenOptions: () => ({}) },
  });
  assert.equal(load('AccountDeletion.tsx', dependencies(false)).useAccountDeletion().available, false);
  load('AccountDeletion.tsx', dependencies(true)).useAccountDeletion().requestDeletion();
  confirm.onConfirm(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(alerts, [['Could not delete account', 'Verify your identity first.']]);
  const page = registry.adapters.find(record => record.path === 'src/features/cloud/T3ConnectProfilePage.tsx');
  assert.ok(page.replacements.some(change => change.after.includes('<DeleteAccountSection />')));
});
