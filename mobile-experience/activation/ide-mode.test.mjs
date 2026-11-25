import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { countDiffChanges, ideChanges, parseDiffLines, selectIdeChange, splitUnifiedDiff, workspaceRelativePath } from './adapters/ideFollow.ts';

const edit = (id, path, extra = {}) => ({ item: { id, type: 'file_change', status: 'completed', fileName: path, changes: [{ operation: 'edit', path }], ...extra } });

test('workspace paths are relative and never escape the workspace', () => {
  assert.equal(workspaceRelativePath('/work/app', '/work/app/src/a.ts'), 'src/a.ts');
  assert.equal(workspaceRelativePath('/work/app/', 'src/./a.ts'), 'src/a.ts');
  assert.equal(workspaceRelativePath('/work/app', '/work/other/a.ts'), null);
  assert.equal(workspaceRelativePath('/work/app', '../secret'), null);
  assert.equal(workspaceRelativePath('/work/app', 'src/../../secret'), null);
  assert.equal(workspaceRelativePath('/work/app', '/work/app'), null);
  assert.equal(workspaceRelativePath('/work/app', 'a\0b'), null);
  assert.equal(workspaceRelativePath('C:\\work\\app', 'c:\\work\\app\\src\\a.ts'), 'src/a.ts');
  assert.equal(workspaceRelativePath('C:\\work\\app', 'D:\\x.ts'), null);
});

test('the file touched most recently is last, and a retouched file moves to the end', () => {
  const changes = ideChanges('/w', [edit('1', '/w/a.ts'), edit('2', '/w/b.ts'), edit('3', '/w/a.ts')]);
  assert.deepEqual(changes.map(c => c.path), ['b.ts', 'a.ts']);
  assert.equal(changes.at(-1).token, JSON.stringify(['3', null, 'completed', 'a.ts']));
});

test('only structured file changes inside the workspace are followed', () => {
  const changes = ideChanges('/w', [
    { item: { id: 'c', type: 'command_execution', status: 'completed' } },
    edit('1', '/etc/passwd'),
    edit('2', '../x.ts'),
    { item: { id: '3', type: 'file_change', status: 'running', fileName: 'src/only-name.ts' } },
  ]);
  assert.deepEqual(changes.map(c => [c.path, c.operation, c.status]), [['src/only-name.ts', 'edit', 'edit · running']]);
});

test('a single-file change keeps its host diff and totals; nothing is fabricated without a diff', () => {
  const diff = '--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+more\n';
  const [withDiff] = ideChanges('/w', [edit('1', 'a.ts', { diffStr: diff, additions: 2, deletions: 1 })]);
  assert.equal(withDiff.diff, diff);
  assert.deepEqual([withDiff.additions, withDiff.deletions], [2, 1]);
  const [without] = ideChanges('/w', [edit('2', 'a.ts', { newStr: 'secret contents' })]);
  assert.equal(without.diff, null);
  const [blank] = ideChanges('/w', [edit('3', 'a.ts', { diffStr: '  \n' })]);
  assert.equal(blank.diff, null);
});

test('a multi-file diff is split so each file shows only its own hunks', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' x', '+added',
    'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -3 +3 @@', '-gone', '+here', '',
  ].join('\n');
  const split = splitUnifiedDiff(diff);
  assert.deepEqual([...split.keys()], ['src/a.ts', 'src/b.ts']);
  assert.ok(!split.get('src/a.ts').includes('gone'));
  const changes = ideChanges('/w', [{ item: { id: 'm', type: 'file_change', status: 'completed', fileName: 'src/a.ts', additions: 2, deletions: 1, diffStr: diff, changes: [{ operation: 'edit', path: 'src/a.ts' }, { operation: 'edit', path: 'src/b.ts' }, { operation: 'edit', path: 'src/c.ts' }] } }]);
  const byPath = Object.fromEntries(changes.map(c => [c.path, c]));
  assert.deepEqual([byPath['src/a.ts'].additions, byPath['src/a.ts'].deletions], [1, 0]);
  assert.deepEqual([byPath['src/b.ts'].additions, byPath['src/b.ts'].deletions], [1, 1]);
  // The host reported no hunk for c.ts: it must not borrow the item totals or another file's diff.
  assert.deepEqual([byPath['src/c.ts'].diff, byPath['src/c.ts'].additions, byPath['src/c.ts'].deletions], [null, null, null]);
});

test('diff lines carry gutter numbers from their hunk headers', () => {
  const rows = parseDiffLines('--- a/f\n+++ b/f\n@@ -10,3 +20,4 @@ fn\n ctx\n-old\n+new\n+newer\n ctx2\n\\ No newline at end of file\n');
  assert.deepEqual(rows.map(r => r.kind), ['meta', 'meta', 'hunk', 'context', 'delete', 'add', 'add', 'context', 'meta']);
  assert.deepEqual(rows.filter(r => r.kind !== 'meta' && r.kind !== 'hunk').map(r => [r.oldLine, r.newLine]), [[10, 20], [11, null], [null, 21], [null, 22], [12, 23]]);
  assert.deepEqual(countDiffChanges('--- a/f\n+++ b/f\n@@ -1 +1 @@\n--removed dashes\n++added pluses\n'), { additions: 1, deletions: 1 });
});

test('following shows the newest change until a file is pinned, and a stale pin falls back', () => {
  const changes = ideChanges('/w', [edit('1', 'a.ts'), edit('2', 'b.ts')]);
  assert.equal(selectIdeChange(changes, null).path, 'b.ts');
  assert.equal(selectIdeChange(changes, 'a.ts').path, 'a.ts');
  assert.equal(selectIdeChange(changes, 'gone.ts').path, 'b.ts');
  assert.equal(selectIdeChange([], 'a.ts'), null);
});

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { applyRecordedAdapter } from './generator.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
const upstream = new URL('../../vendor/t3-mobile/apps/mobile/', import.meta.url);
const adapted = path => applyRecordedAdapter(fs.readFileSync(new URL(path, upstream)), registry.adapters.find(r => r.path === path)).toString();
const parses = (name, text) => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.deepEqual(file.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], name);
};

test('IDE mode is registered as exact additions plus three adapters, and everything parses', () => {
  for (const name of ['ideFollow.ts', 'ThreadIdePane.tsx']) {
    const record = registry.additions.find(a => a.path === 'src/features/ide/' + name);
    assert.ok(record, name);
    const bytes = fs.readFileSync(new URL('./' + record.template, import.meta.url));
    assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
    parses(name, bytes.toString());
  }
  for (const path of ['src/features/threads/thread-inspector-navigation.ts', 'src/features/threads/ThreadHeader.tsx', 'src/features/threads/ThreadRouteScreen.tsx']) parses(path, adapted(path));
});

test('the IDE entry exists only where the file inspector is supported and never changes the Files button', () => {
  const header = adapted('src/features/threads/ThreadHeader.tsx');
  assert.match(header, /props\.fileInspectorSupported && props\.onOpenIdeInspector/);
  assert.match(header, /ideVisible \? toggleAuxiliaryPane : props\.onOpenIdeInspector/);
  assert.match(header, /accessibilityLabel: filesVisible \? "Close files" : "Open files"/);
  // Draft threads do not pass an IDE handler, so they keep their single Files button.
  assert.match(header, /readonly onOpenIdeInspector\?: \(\) => void;/);
});

test('the route opens the IDE pane in the inspector, unprewarmed, for a thread with a workspace', () => {
  const route = adapted('src/features/threads/ThreadRouteScreen.tsx');
  assert.match(route, /\{ key: "ide", render: renderIdeInspector \},/);
  assert.doesNotMatch(route, /key: "ide"[^}]*prewarm/);
  assert.match(route, /\(mode === "files" \|\| mode === "ide"\) && selectedThreadCwd === null \? null : mode/);
  assert.match(route, /onOpenIdeInspector=\{handleOpenIdeInspector\}/);
  assert.match(adapted('src/features/threads/thread-inspector-navigation.ts'), /"files" \| "ide" \| "preview"/);
});

test('the pane stays read-only: no writes, commands or fabricated contents', () => {
  const pane = fs.readFileSync(new URL('./adapters/ThreadIdePane.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(pane, /writeFile|TextInput|dispatchCommand|newStr|oldStr/);
});
