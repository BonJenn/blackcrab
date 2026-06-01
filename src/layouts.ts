// Saved Layouts & Workspaces helpers.
//
// A grid arrangement is spread across several localStorage keys that App.tsx
// already persists. A saved layout snapshots those raw key->value strings under
// a name, scoped to a project (cwd), so it can be restored in one action. This
// module is pure (no DOM / localStorage access) so it stays unit-testable; the
// side effects live in App.tsx.

export const LAYOUTS_KEY = "blackcrab.savedLayouts.v1";

// The localStorage keys that together describe the grid arrangement. Captured
// and restored verbatim, like src/backup.ts.
export const LAYOUT_KEYS: readonly string[] = [
  "gridMode",
  "gridPanels",
  "gridPanelSessionIds",
  "newPanelCwds",
  "newPanelWorktree",
  "gridRowTopFraction",
  "gridColWeightsByCount",
];

export type SavedLayout = {
  id: string;
  name: string;
  // The project (session cwd) this layout was saved for.
  project: string;
  createdAt: string;
  // Raw localStorage values for LAYOUT_KEYS present at save time.
  values: Record<string, string>;
};

/** Parse the saved-layouts store; tolerates missing/malformed input. */
export function parseLayouts(raw: string | null): SavedLayout[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (l): l is SavedLayout =>
      !!l &&
      typeof l === "object" &&
      typeof (l as SavedLayout).id === "string" &&
      typeof (l as SavedLayout).name === "string" &&
      typeof (l as SavedLayout).values === "object",
  );
}

export function serializeLayouts(list: SavedLayout[]): string {
  return JSON.stringify(list);
}

/** Build a layout from a snapshot of LAYOUT_KEYS (keys absent from the snapshot
 *  are simply omitted). */
export function captureLayout(
  name: string,
  project: string,
  snapshot: Record<string, string | null>,
  meta: { id: string; createdAt: string },
): SavedLayout {
  const values: Record<string, string> = {};
  for (const key of LAYOUT_KEYS) {
    const value = snapshot[key];
    if (typeof value === "string") values[key] = value;
  }
  return { id: meta.id, name: name.trim(), project, createdAt: meta.createdAt, values };
}

/** Replace an existing layout with the same name+project, otherwise append. */
export function upsertLayout(
  list: SavedLayout[],
  layout: SavedLayout,
): SavedLayout[] {
  const idx = list.findIndex(
    (l) => l.name === layout.name && l.project === layout.project,
  );
  if (idx === -1) return [...list, layout];
  const next = list.slice();
  next[idx] = layout;
  return next;
}

export function removeLayout(list: SavedLayout[], id: string): SavedLayout[] {
  return list.filter((l) => l.id !== id);
}

/** "<name> · <project basename>" for command titles. */
export function layoutLabel(layout: SavedLayout): string {
  const base = layout.project.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "";
  return base ? `${layout.name} · ${base}` : layout.name;
}
