import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { applyRecordedAdapter } from './generator.mjs';
import { buildWidgetJobs, stampWidgetJobs, widgetJobsIdle, withJobsDeadline, WIDGET_JOBS_FRESH_MS, WIDGET_MAX_JOB_ROWS, WIDGET_RECENT_JOB_MS } from './adapters/widgetJobs.ts';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const projects = [{ environmentId: 'e', id: 'p', title: 'Blackcrab' }];
const thread = (id, over = {}) => ({
  environmentId: 'e', id, projectId: 'p', title: 'Thread ' + id, itemCount: 9, updatedAt: iso(NOW - 60_000), settledOverride: null,
  archivedAt: null, deletedAt: null, pendingBackgroundTasks: [], modelSelection: { model: 'claude-opus-5-5' }, listed: true, status: 'running',
  activityRunStatus: 'running', activityRunStartedAt: iso(NOW - 600_000), latestRunStartedAt: null, latestRunStopRequested: false,
  pendingRequestKind: null, pendingRequestAt: null, latestMessage: null, ...over,
});
// The real phase rule is covered with the Live Activity; here each thread names its phase.
const phaseOf = t => t.title.split(':')[1] ?? null;
const jobs = threads => buildWidgetJobs({ threads, projects, nowMs: NOW, phaseOf });

test('counts every kind of job and orders rows by what needs the user first', () => {
  const result = jobs([
    thread('1', { title: 'a:completed' }),
    thread('2', { title: 'b:running', activityRunStartedAt: iso(NOW - 60_000) }),
    thread('3', { title: 'c:waiting_for_approval', pendingRequestAt: iso(NOW - 120_000) }),
    thread('4', { title: 'd:failed' }),
    thread('5', { title: 'e:running', activityRunStartedAt: iso(NOW - 900_000) }),
    thread('6', { title: 'f:starting' }),
  ]);
  assert.deepEqual([result.attention, result.failed, result.working, result.done], [1, 1, 3, 1]);
  assert.deepEqual(result.rows.map(r => r.phase), ['waiting_for_approval', 'failed', 'running', 'starting', 'running', 'completed']);
  // The longest-running job comes first so a stuck one stays visible.
  assert.equal(result.rows[2].title, 'e:running');
  assert.equal(widgetJobsIdle(result), false);
});

test('a waiting job counts from its request and a finished one has no clock', () => {
  const [waiting, finished] = jobs([
    thread('1', { title: 'w:waiting_for_input', pendingRequestAt: iso(NOW - 90_000), activityRunStartedAt: iso(NOW - 900_000) }),
    thread('2', { title: 'x:completed' }),
  ]).rows;
  assert.equal(waiting.startedAt, NOW - 90_000);
  assert.equal(waiting.status, 'Needs input');
  assert.equal(finished.startedAt, null);
  assert.equal(finished.deepLink, '/threads/e/2');
});

test('finished jobs expire from the widget; unlisted, archived, deleted and project-less threads never appear', () => {
  const result = jobs([
    thread('old', { title: 'o:completed', updatedAt: iso(NOW - WIDGET_RECENT_JOB_MS - 1000) }),
    thread('edge', { title: 'e:failed', updatedAt: iso(NOW - WIDGET_RECENT_JOB_MS + 1000) }),
    thread('un', { title: 'u:running', listed: false }),
    thread('ar', { title: 'a:running', archivedAt: iso(NOW) }),
    thread('de', { title: 'd:running', deletedAt: iso(NOW) }),
    thread('np', { title: 'n:running', projectId: 'missing' }),
    thread('bad', { title: 'b:completed', updatedAt: 'not a date' }),
    thread('idle', { title: 'i:null' }),
  ]);
  assert.deepEqual(result.rows.map(r => r.title), ['e:failed']);
  assert.deepEqual([result.working, result.attention, result.failed, result.done], [0, 0, 1, 0]);
  assert.equal(widgetJobsIdle(jobs([])), true);
});

test('rows are capped but counts are not, and volatile detail never enters the picture', () => {
  const many = Array.from({ length: 10 }, (_, i) => thread(String(i), { title: `t${i}:running`, itemCount: i * 7, latestMessage: { role: 'assistant', text: 'streaming ' + i, updatedAt: iso(NOW) } }));
  const result = jobs(many);
  assert.equal(result.working, 10);
  assert.equal(result.rows.length, WIDGET_MAX_JOB_ROWS);
  const first = JSON.stringify(jobs(many));
  const streamed = JSON.stringify(jobs(many.map(t => ({ ...t, itemCount: t.itemCount + 50, latestMessage: { role: 'assistant', text: 'more text', updatedAt: iso(NOW + 5000) } }))));
  assert.equal(streamed, first, 'steps and message text must not change the published picture');
});

test('the picture is stamped fresh and gets a timeline entry exactly when it goes stale', () => {
  const stamped = stampWidgetJobs(jobs([thread('1', { title: 'a:running' })]), NOW);
  assert.equal(stamped.expiresAt, NOW + WIDGET_JOBS_FRESH_MS);
  const entries = [{ date: new Date(NOW), props: { n: 'now' } }, { date: new Date(NOW + 5 * 60_000), props: { n: 'limit deadline' } }, { date: new Date(NOW + 20 * 60_000), props: { n: 'late' } }];
  const out = withJobsDeadline(entries, stamped, NOW);
  assert.deepEqual(out.map(e => e.date.getTime()), [NOW, NOW + 5 * 60_000, stamped.expiresAt, NOW + 20 * 60_000]);
  assert.equal(out[2].props.n, 'limit deadline', 'the stale entry keeps the limits as they stand then');
  assert.deepEqual(withJobsDeadline(entries, undefined, NOW), entries);
  assert.deepEqual(withJobsDeadline(entries, { expiresAt: NOW - 1 }, NOW), entries);
  assert.equal(withJobsDeadline(entries, { expiresAt: NOW + 5 * 60_000 }, NOW).length, 3);
  assert.deepEqual(withJobsDeadline([], stamped, NOW), []);
});

const require = createRequire(import.meta.url), ts = require('typescript');
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
const upstream = new URL('../../vendor/t3-mobile/apps/mobile/', import.meta.url);
const parses = (name, text) => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.deepEqual(file.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], name);
};
const adapter = path => registry.adapters.find(r => r.path === path);

test('the widget, coordinator and publisher are exact recorded adapters over the pinned originals', () => {
  for (const [path, template] of [['src/widgets/SubscriptionUsage.tsx', 'adapters/SubscriptionUsage.tsx'], ['src/widgets/SubscriptionUsageCoordinator.tsx', 'adapters/SubscriptionUsageCoordinator.tsx']]) {
    const record = adapter(path);
    assert.equal(record.kind, 'template');
    assert.equal(record.template, template);
    const templateBytes = fs.readFileSync(new URL('./' + template, import.meta.url));
    const text = applyRecordedAdapter(fs.readFileSync(new URL(path, upstream)), record, templateBytes).toString();
    assert.equal(text, templateBytes.toString());
    parses(path, text);
  }
  const publisher = applyRecordedAdapter(fs.readFileSync(new URL('src/widgets/publishSubscriptionUsage.ios.ts', upstream)), adapter('src/widgets/publishSubscriptionUsage.ios.ts')).toString();
  parses('publish.ts', publisher);
  assert.match(publisher, /withJobsDeadline\(subscriptionUsageTimeline\(snapshot, now\), snapshot\.jobs, now\)/);
  const record = registry.additions.find(a => a.path === 'src/widgets/widgetJobs.ts');
  const bytes = fs.readFileSync(new URL('./' + record.template, import.meta.url));
  assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
  parses('widgetJobs.ts', bytes.toString());
  // The Android copy-only adapter is unchanged and the iOS one no longer takes it.
  assert.equal(adapter('src/widgets/SubscriptionUsage.android.tsx').kind, 'replace');
});

test('the widget shows jobs with every family, a live clock, and honest stale/empty states', () => {
  const widget = fs.readFileSync(new URL('./adapters/SubscriptionUsage.tsx', import.meta.url), 'utf8');
  for (const family of ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge', 'accessoryRectangular']) assert.match(widget, new RegExp(family));
  assert.match(widget, /dateStyle="timer"/);
  assert.match(widget, /Open Blackcrab to refresh jobs/);
  assert.match(widget, /No agents running/);
  assert.match(widget, /now < jobs\.expiresAt/);
  assert.doesNotMatch(widget, /\bT3\b/);
  // Widget functions are serialized without module scope: nothing may be imported at runtime from the app.
  const runtimeImports = [...widget.matchAll(/^import (?!type)[^\n]*from "([^"]+)"/gm)].map(m => m[1]);
  assert.deepEqual(runtimeImports.filter(s => s.startsWith('.')), []);
});

test('the coordinator throttles, heartbeats and keeps volatile detail out of the publish trigger', () => {
  const text = fs.readFileSync(new URL('./adapters/SubscriptionUsageCoordinator.tsx', import.meta.url), 'utf8');
  assert.match(text, /MIN_PUBLISH_INTERVAL_MS/);
  assert.match(text, /HEARTBEAT_MS/);
  assert.match(text, /if \(serialized === last\) return;/);
  assert.match(text, /clearTimeout\(timer\)/);
  assert.match(text, /Platform\.OS !== "ios"/);
});
