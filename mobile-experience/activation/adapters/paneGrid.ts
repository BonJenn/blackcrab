// Blackcrab-owned. Pane mode: which threads sit side by side and where each one is drawn.
//
// Pure and written with erasable TypeScript only so the node test runner can import it.

export const MAX_PANES = 4;
/** Narrowest a pane can be before a thread and its composer stop being usable. */
export const MIN_PANE_WIDTH = 380;
export const MIN_PANE_HEIGHT = 300;
export const PANE_GAP = 8;

export interface PaneRef {
  readonly environmentId: string;
  readonly threadId: string;
}

export interface PaneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaneCell {
  readonly ref: PaneRef;
  readonly rect: PaneRect;
}

export interface PaneLayout {
  /** Panes that fit, with where each one goes. Their order follows the open order. */
  readonly cells: ReadonlyArray<PaneCell>;
  /** Open panes with no room at this size. They stay open and can be brought forward. */
  readonly hidden: ReadonlyArray<PaneRef>;
}

export function paneKey(ref: PaneRef): string {
  return `${ref.environmentId}\u0000${ref.threadId}`;
}

export function samePane(a: PaneRef, b: PaneRef): boolean {
  return a.environmentId === b.environmentId && a.threadId === b.threadId;
}

/** Opens a pane at the end. An open thread is left where it is; a full set is left unchanged. */
export function addPane(panes: ReadonlyArray<PaneRef>, ref: PaneRef): ReadonlyArray<PaneRef> {
  if (panes.some((pane) => samePane(pane, ref))) return panes;
  if (panes.length >= MAX_PANES) return panes;
  return [...panes, { environmentId: ref.environmentId, threadId: ref.threadId }];
}

export function removePane(panes: ReadonlyArray<PaneRef>, ref: PaneRef): ReadonlyArray<PaneRef> {
  const next = panes.filter((pane) => !samePane(pane, ref));
  return next.length === panes.length ? panes : next;
}

/** Moves a pane to the front so it has room first when the screen is too small for all. */
export function bringPaneForward(
  panes: ReadonlyArray<PaneRef>,
  ref: PaneRef,
): ReadonlyArray<PaneRef> {
  const index = panes.findIndex((pane) => samePane(pane, ref));
  if (index <= 0) return panes;
  return [panes[index]!, ...panes.slice(0, index), ...panes.slice(index + 1)];
}

function columnCapacity(width: number): number {
  return Math.max(1, Math.floor((width + PANE_GAP) / (MIN_PANE_WIDTH + PANE_GAP)));
}

function rowCapacity(height: number): number {
  return Math.max(1, Math.floor((height + PANE_GAP) / (MIN_PANE_HEIGHT + PANE_GAP)));
}

function columns(count: number, width: number, height: number, top = 0): PaneRect[] {
  const each = (width - PANE_GAP * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: index * (each + PANE_GAP),
    y: top,
    width: each,
    height,
  }));
}

/**
 * Splits the available area for the open panes. Panes keep their order and their keys, so a pane
 * that stays on screen is not remounted when another opens or closes. The rules favour full-height
 * columns, then a tall pane beside two stacked ones, then a grid; panes that do not fit at this
 * size (a narrow Split View, a small window) are returned as hidden, never squeezed.
 */
export function layoutPanes(
  panes: ReadonlyArray<PaneRef>,
  width: number,
  height: number,
): PaneLayout {
  if (panes.length === 0 || width <= 0 || height <= 0) return { cells: [], hidden: [...panes] };
  const wide = columnCapacity(width);
  const tall = rowCapacity(height);
  const open = panes.slice(0, MAX_PANES);
  const count = open.length;

  let rects: PaneRect[];
  if (count === 1 || wide === 1) {
    // One column fits: the front pane gets everything, the rest wait their turn.
    rects = [{ x: 0, y: 0, width, height }];
  } else if (count === 2) {
    rects = columns(2, width, height);
  } else if (count === 3) {
    if (wide >= 3) {
      rects = columns(3, width, height);
    } else if (tall >= 2) {
      // A tall pane on the left, two stacked on the right.
      const half = (width - PANE_GAP) / 2;
      const row = (height - PANE_GAP) / 2;
      rects = [
        { x: 0, y: 0, width: half, height },
        { x: half + PANE_GAP, y: 0, width: half, height: row },
        { x: half + PANE_GAP, y: row + PANE_GAP, width: half, height: row },
      ];
    } else {
      rects = columns(2, width, height);
    }
  } else if (tall >= 2) {
    const half = (width - PANE_GAP) / 2;
    const row = (height - PANE_GAP) / 2;
    rects = [
      { x: 0, y: 0, width: half, height: row },
      { x: half + PANE_GAP, y: 0, width: half, height: row },
      { x: 0, y: row + PANE_GAP, width: half, height: row },
      { x: half + PANE_GAP, y: row + PANE_GAP, width: half, height: row },
    ];
  } else if (wide >= 4) {
    rects = columns(4, width, height);
  } else {
    rects = columns(2, width, height);
  }

  const cells = rects.map((rect, index) => ({ ref: open[index]!, rect }));
  return { cells, hidden: panes.filter((pane) => !cells.some((cell) => samePane(cell.ref, pane))) };
}

/** One small shared snapshot of the open panes, so leaving and reopening pane mode keeps them. */
export function createPaneStore(initial: ReadonlyArray<PaneRef> = []) {
  let panes: ReadonlyArray<PaneRef> = initial.slice(0, MAX_PANES);
  const listeners = new Set<() => void>();
  const commit = (next: ReadonlyArray<PaneRef>) => {
    if (next === panes) return;
    panes = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => panes,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: (ref: PaneRef) => commit(addPane(panes, ref)),
    close: (ref: PaneRef) => commit(removePane(panes, ref)),
    bringForward: (ref: PaneRef) => commit(bringPaneForward(panes, ref)),
    clear: () => commit([]),
  };
}

export type PaneStore = ReturnType<typeof createPaneStore>;
