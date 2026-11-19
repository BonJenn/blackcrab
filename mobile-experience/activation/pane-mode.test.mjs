import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { applyRecordedAdapter } from './generator.mjs';
import {
  MAX_PANES, MIN_PANE_HEIGHT, MIN_PANE_WIDTH, PANE_GAP, addPane, bringPaneForward, createPaneStore, layoutPanes, paneKey, removePane,
} from './adapters/paneGrid.ts';

const ref = (id, env = 'e1') => ({ environmentId: env, threadId: id });
const refs = (...ids) => ids.map(id => ref(id));
const overlaps = (a, b) => a.x < b.x + b.width - 0.001 && b.x < a.x + a.width - 0.001 && a.y < b.y + b.height - 0.001 && b.y < a.y + a.height - 0.001;

test('opening keeps order, skips an open thread, and stops at the cap', () => {
  const two = addPane(addPane([], ref('a')), ref('b'));
  assert.deepEqual(two.map(p => p.threadId), ['a', 'b']);
  assert.equal(addPane(two, ref('a')), two);
  const full = refs('a', 'b', 'c', 'd');
  assert.equal(full.length, MAX_PANES);
  assert.equal(addPane(full, ref('e')), full);
  // The same thread id in another environment is a different thread.
  assert.equal(addPane(two, ref('a', 'e2')).length, 3);
});

test('closing and bringing forward leave the other panes alone', () => {
  const panes = refs('a', 'b', 'c');
  assert.deepEqual(removePane(panes, ref('b')).map(p => p.threadId), ['a', 'c']);
  assert.equal(removePane(panes, ref('zzz')), panes);
  assert.deepEqual(bringPaneForward(panes, ref('c')).map(p => p.threadId), ['c', 'a', 'b']);
  assert.equal(bringPaneForward(panes, ref('a')), panes);
  assert.equal(bringPaneForward(panes, ref('zzz')), panes);
});

test('a lone pane fills the area and nothing is hidden', () => {
  const { cells, hidden } = layoutPanes(refs('a'), 700, 600);
  assert.deepEqual(cells.map(c => c.rect), [{ x: 0, y: 0, width: 700, height: 600 }]);
  assert.deepEqual(hidden, []);
  assert.deepEqual(layoutPanes([], 700, 600), { cells: [], hidden: [] });
  assert.equal(layoutPanes(refs('a'), 0, 600).cells.length, 0);
});

test('two panes sit side by side in a landscape window and the front pane stands alone in a narrow one', () => {
  const wide = layoutPanes(refs('a', 'b'), 1100, 700);
  assert.deepEqual(wide.cells.map(c => c.ref.threadId), ['a', 'b']);
  assert.ok(wide.cells.every(c => c.rect.width >= MIN_PANE_WIDTH && c.rect.height === 700));
  assert.equal(wide.cells[1].rect.x, wide.cells[0].rect.width + PANE_GAP);
  const narrow = layoutPanes(refs('a', 'b'), MIN_PANE_WIDTH + 100, 700);
  assert.deepEqual(narrow.cells.map(c => c.ref.threadId), ['a']);
  assert.deepEqual(narrow.hidden.map(p => p.threadId), ['b']);
  assert.deepEqual(narrow.cells[0].rect, { x: 0, y: 0, width: MIN_PANE_WIDTH + 100, height: 700 });
});

test('three panes use three columns when they fit, else one tall pane beside two stacked', () => {
  const wide = layoutPanes(refs('a', 'b', 'c'), 3 * MIN_PANE_WIDTH + 2 * PANE_GAP, 600);
  assert.ok(wide.cells.every(c => c.rect.y === 0 && c.rect.height === 600));
  const mixed = layoutPanes(refs('a', 'b', 'c'), 1000, 2 * MIN_PANE_HEIGHT + PANE_GAP);
  assert.equal(mixed.cells[0].rect.height, 2 * MIN_PANE_HEIGHT + PANE_GAP);
  assert.equal(mixed.cells[1].rect.y, 0);
  assert.ok(mixed.cells[2].rect.y > 0);
  assert.equal(mixed.cells[1].rect.x, mixed.cells[2].rect.x);
});

test('four panes form a grid, or four columns when only the width allows', () => {
  const grid = layoutPanes(refs('a', 'b', 'c', 'd'), 1000, 2 * MIN_PANE_HEIGHT + PANE_GAP);
  assert.equal(grid.cells.length, 4);
  assert.deepEqual(new Set(grid.cells.map(c => c.rect.x)).size, 2);
  assert.deepEqual(new Set(grid.cells.map(c => c.rect.y)).size, 2);
  const row = layoutPanes(refs('a', 'b', 'c', 'd'), 4 * MIN_PANE_WIDTH + 3 * PANE_GAP, MIN_PANE_HEIGHT);
  assert.equal(row.cells.length, 4);
  assert.equal(new Set(row.cells.map(c => c.rect.y)).size, 1);
});

test('no layout overlaps panes, leaves the area, or squeezes a pane below its minimum', () => {
  for (const width of [320, 500, 744, 834, 1024, 1180, 1366, 1700]) {
    for (const height of [260, 400, 640, 820, 1000]) {
      for (let count = 1; count <= MAX_PANES; count += 1) {
        const panes = refs(...'abcd'.slice(0, count));
        const { cells, hidden } = layoutPanes(panes, width, height);
        assert.equal(cells.length + hidden.length, count, `${width}x${height} x${count}`);
        assert.ok(cells.length >= 1, `${width}x${height} x${count}`);
        for (const [i, cell] of cells.entries()) {
          const { x, y, width: w, height: h } = cell.rect;
          assert.ok(x >= -0.001 && y >= -0.001 && x + w <= width + 0.001 && y + h <= height + 0.001, `${width}x${height} x${count} bounds`);
          // A pane may only be small when the whole area is.
          if (width >= MIN_PANE_WIDTH) assert.ok(w >= MIN_PANE_WIDTH - 0.001, `${width}x${height} x${count} width ${w}`);
          for (const other of cells.slice(i + 1)) assert.ok(!overlaps(cell.rect, other.rect), `${width}x${height} x${count} overlap`);
        }
      }
    }
  }
});

test('a pane that stays on screen keeps its key when another opens or closes', () => {
  const before = layoutPanes(refs('a', 'b'), 1200, 700).cells.map(c => paneKey(c.ref));
  const after = layoutPanes(refs('a', 'b', 'c'), 1200, 700).cells.map(c => paneKey(c.ref));
  assert.deepEqual(after.slice(0, 2), before);
});

test('the store tells subscribers only about real changes and never exceeds the cap', () => {
  const store = createPaneStore(refs('a', 'b', 'c', 'd', 'e'));
  assert.equal(store.getSnapshot().length, MAX_PANES);
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  store.open(ref('a'));
  store.open(ref('e'));
  store.close(ref('zzz'));
  assert.equal(calls, 0);
  store.close(ref('d'));
  store.open(ref('e'));
  store.bringForward(ref('e'));
  assert.equal(calls, 3);
  assert.deepEqual(store.getSnapshot().map(p => p.threadId), ['e', 'a', 'b', 'c']);
  stop();
  store.clear();
  assert.equal(calls, 3);
  assert.deepEqual(store.getSnapshot(), []);
});

const require = createRequire(import.meta.url), ts = require('typescript');
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
const upstream = new URL('../../vendor/t3-mobile/apps/mobile/', import.meta.url);
const adapted = path => applyRecordedAdapter(fs.readFileSync(new URL(path, upstream)), registry.adapters.find(r => r.path === path)).toString();
const parses = (name, text) => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.deepEqual(file.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], name);
};

test('pane mode is four exact additions and four adapters that all parse', () => {
  for (const name of ['paneGrid.ts', 'paneStore.ts', 'PaneCellHeader.tsx', 'ThreadPanesScreen.tsx']) {
    const record = registry.additions.find(a => a.path === 'src/features/panes/' + name);
    assert.ok(record, name);
    const bytes = fs.readFileSync(new URL('./' + record.template, import.meta.url));
    assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
    parses(name, bytes.toString());
  }
  for (const path of ['src/Stack.tsx', 'src/features/threads/ThreadHeader.tsx', 'src/features/threads/ThreadRouteScreen.tsx', 'src/features/threads/thread-inspector-preview.tsx']) parses(path, adapted(path));
});

test('the Panes route exists and is reached from the header only where the file inspector is', () => {
  assert.match(adapted('src/Stack.tsx'), /ThreadPanes: createNativeStackScreen\(\{\n      screen: ThreadPanesScreen,/);
  const header = adapted('src/features/threads/ThreadHeader.tsx');
  assert.match(header, /props\.fileInspectorSupported && props\.onOpenPanes/);
  assert.match(header, /readonly onOpenPanes\?: \(\) => void;/);
  // It sits beside the IDE entry and leaves the Files and IDE buttons as they were.
  assert.match(header, /ideVisible \? toggleAuxiliaryPane : props\.onOpenIdeInspector/);
  const route = adapted('src/features/threads/ThreadRouteScreen.tsx');
  assert.match(route, /paneStore\.open\(\{/);
  assert.match(route, /navigation\.navigate\("ThreadPanes"\)/);
  assert.match(route, /onOpenPanes=\{handleOpenPanes\}/);
});

test('a pane is a thread on its own route with its own bar, so it never borrows the screen header', () => {
  const preview = adapted('src/features/threads/thread-inspector-preview.tsx');
  assert.match(preview, /if \("pane" in props\) \{\n    return \(\n      <PaneCellHeader/);
  // The existing maximize and close presentations are still there, after the pane one.
  assert.ok(preview.indexOf('"pane" in props') < preview.indexOf('"onMaximize" in props'));
  const screen = fs.readFileSync(new URL('./adapters/ThreadPanesScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /<ThreadPreviewRoute/);
  assert.match(screen, /WorkspaceSlotOptionsContext value=\{slot\}/);
  assert.doesNotMatch(screen, /sendMessage|dispatchCommand|startTurn/);
});
