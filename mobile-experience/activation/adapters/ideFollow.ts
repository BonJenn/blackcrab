/**
 * IDE mode follows only structured host file-change items. It never executes or animates tool
 * text, and it never invents file contents: a change without a host diff shows the file on disk.
 * Written with erasable TypeScript only so the node test runner can import it directly.
 */
export interface IdeFileChangeDetail {
  readonly operation: string;
  readonly path: string;
  readonly oldPath?: string | undefined;
}

export interface IdeTurnItem {
  readonly id: string;
  readonly type: string;
  readonly status?: string | undefined;
  readonly updatedAt?: unknown;
  readonly fileName?: string | undefined;
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  readonly diffStr?: string | undefined;
  readonly changes?: ReadonlyArray<IdeFileChangeDetail> | undefined;
}

export interface IdeChange {
  /** Path relative to the thread workspace. */
  readonly path: string;
  readonly operation: string;
  readonly status: string;
  readonly additions: number | null;
  readonly deletions: number | null;
  /** The host's unified diff for this file, or null when the host reported none. */
  readonly diff: string | null;
  /** Changes whenever the host updates the item, so the open file knows to reload. */
  readonly token: string;
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/** A path inside the workspace, or null for anything that would escape it. */
export function workspaceRelativePath(root: string, file: string): string | null {
  const windows = isWindowsPath(root);
  const normalize = (value: string) => (windows ? value.replaceAll("\\", "/") : value);
  const compare = (value: string) => (windows ? value.toLowerCase() : value);
  const base = normalize(root).replace(/\/+$/, "");
  let value = normalize(file);
  if (compare(value).startsWith(compare(base) + "/")) value = value.slice(base.length + 1);
  if (value.length === 0 || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\0")) {
    return null;
  }
  const parts = value.split("/").filter((part) => part !== ".");
  if (parts.length === 0 || parts.some((part) => part === ".." || part === "")) return null;
  return parts.join("/");
}

function stripDiffPrefix(path: string): string {
  const trimmed = path.trim().replace(/^"|"$/g, "");
  return trimmed.startsWith("a/") || trimmed.startsWith("b/") ? trimmed.slice(2) : trimmed;
}

/** Splits a multi-file unified diff by file; keys are the post-change paths as the diff names them. */
export function splitUnifiedDiff(diff: string): Map<string, string> {
  const files = new Map<string, string>();
  const lines = diff.split("\n");
  let start = -1;
  let name: string | null = null;
  const flush = (end: number) => {
    if (start >= 0 && name !== null) files.set(name, lines.slice(start, end).join("\n"));
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("diff --git ")) {
      flush(index);
      start = index;
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      name = match ? (match[2] ?? null) : null;
    } else if (line.startsWith("+++ ")) {
      const target = line.slice(4);
      if (start < 0) {
        // A plain `--- a` / `+++ b` pair has no `diff --git` header; the pair begins one line earlier.
        start = Math.max(0, index - 1);
        name = target === "/dev/null" ? null : stripDiffPrefix(target);
      } else if (target !== "/dev/null") {
        name = stripDiffPrefix(target);
      }
    }
  }
  flush(lines.length);
  return files;
}

export interface IdeDiffLine {
  readonly kind: "add" | "delete" | "context" | "hunk" | "meta";
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

/** Numbers each diff line from its hunk header so the viewer can show a code gutter. */
export function parseDiffLines(diff: string): IdeDiffLine[] {
  const rows: IdeDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line, oldLine: null, newLine: null });
    } else if (!inHunk || line.startsWith("diff --git ")) {
      inHunk = line.startsWith("diff --git ") ? false : inHunk;
      rows.push({ kind: "meta", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "delete", text: line.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "meta", text: line, oldLine: null, newLine: null });
    } else {
      rows.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}

export function countDiffChanges(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const row of parseDiffLines(diff)) {
    if (row.kind === "add") additions += 1;
    else if (row.kind === "delete") deletions += 1;
  }
  return { additions, deletions };
}

/**
 * The files the agent has changed in this thread, oldest first. A file changed again moves to the
 * end, so the last entry is always what the agent touched most recently.
 */
export function ideChanges(
  workspaceRoot: string,
  turnItems: ReadonlyArray<{ readonly item: IdeTurnItem }>,
): IdeChange[] {
  const files = new Map<string, IdeChange>();
  for (const { item } of turnItems) {
    if (item.type !== "file_change") continue;
    const details: ReadonlyArray<IdeFileChangeDetail> =
      item.changes !== undefined && item.changes.length > 0
        ? item.changes
        : item.fileName === undefined
          ? []
          : [{ operation: "edit", path: item.fileName }];
    const single = details.length === 1;
    const perFile = !single && item.diffStr !== undefined ? splitUnifiedDiff(item.diffStr) : null;
    for (const detail of details) {
      const path = workspaceRelativePath(workspaceRoot, detail.path);
      if (path === null) continue;
      const diff = single ? (item.diffStr ?? null) : (perFile?.get(path) ?? null);
      const counted = diff !== null && !single ? countDiffChanges(diff) : null;
      files.delete(path);
      files.set(path, {
        path,
        operation: detail.operation,
        status: `${detail.operation} · ${item.status ?? "updated"}`,
        additions: counted?.additions ?? (single ? (item.additions ?? null) : null),
        deletions: counted?.deletions ?? (single ? (item.deletions ?? null) : null),
        diff: diff !== null && diff.trim().length > 0 ? diff : null,
        token: JSON.stringify([item.id, item.updatedAt ?? null, item.status ?? null, path]),
      });
    }
  }
  return [...files.values()];
}

/**
 * Following shows the newest change. Choosing a file pins it; a pin that no longer names a
 * changed file (for example after switching threads) falls back to following.
 */
export function selectIdeChange(
  changes: ReadonlyArray<IdeChange>,
  pinnedPath: string | null,
): IdeChange | null {
  if (pinnedPath !== null) {
    const pinned = changes.find((change) => change.path === pinnedPath);
    if (pinned) return pinned;
  }
  return changes.at(-1) ?? null;
}
