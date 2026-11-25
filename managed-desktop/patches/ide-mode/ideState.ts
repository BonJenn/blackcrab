/** IDE follows only structured host file-change events; tool text is never executed or animated. */
export interface IdeFileEvent {
  readonly id: string;
  readonly updatedAt?: unknown;
  readonly type: string;
  readonly status: string;
  readonly fileName?: string | undefined;
  readonly newStr?: string | undefined;
  readonly diffStr?: string | undefined;
  readonly changes?: readonly { readonly path: string; readonly operation: string }[] | undefined;
}
export function workspaceRelativePath(root: string, file: string): string | null {
  const windows = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\");
  const normalize = (s: string) => windows ? s.replaceAll("\\", "/") : s;
  const base = normalize(root).replace(/\/$/, "");
  let value = normalize(file);
  const compare = (s: string) => windows ? s.toLowerCase() : s;
  if (compare(value).startsWith(compare(base) + "/")) value = value.slice(base.length + 1);
  if (!value || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\0")) return null;
  const parts = value.split("/").filter(p => p !== ".");
  if (parts.some(p => p === ".." || p === "")) return null;
  return parts.join("/");
}
export function ideChanges(root: string, events: readonly { readonly item: IdeFileEvent }[]) {
  const files = new Map<string, { path: string; status: string; token: string; id: string; preview: string | undefined; running: boolean }>();
  for (const { item } of events) {
    if (item.type !== "file_change") continue;
    for (const change of item.changes?.length ? item.changes : [{ path: item.fileName ?? "", operation: "edit" }]) {
      const path = workspaceRelativePath(root, change.path);
      if (!path) continue;
      files.delete(path);
      const singleFile = (item.changes?.length ?? 0) <= 1;
      const preview = singleFile ? item.newStr ?? item.diffStr : undefined;
      files.set(path, { path, id: item.id, preview, running: item.status === "running" || item.status === "pending", status: `${change.operation} · ${item.status}`, token: JSON.stringify([item.id, item.updatedAt, item.status, path]) });
    }
  }
  return [...files.values()];
}
const isAbsolutePath = (path: string) => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
/**
 * The folder the panel should show. It is the thread's own folder unless the agent's latest edits,
 * since its last edit inside that folder, were to files outside it. Then it is the folder those
 * files share, which is never as wide as a user's home directory.
 */
export function agentFolder(home: string, events: readonly { readonly item: IdeFileEvent }[]): { folder: string; outside: boolean } {
  let run: string[] = [];
  for (const { item } of events) {
    if (item.type !== "file_change") continue;
    for (const change of item.changes?.length ? item.changes : [{ path: item.fileName ?? "" }]) {
      if (!change.path) continue;
      if (workspaceRelativePath(home, change.path) !== null) run = [];
      else if (isAbsolutePath(change.path)) run.push(change.path.replaceAll("\\", "/"));
    }
  }
  if (run.length === 0) return { folder: home, outside: false };
  return { folder: commonFolder(run), outside: true };
}
export function commonFolder(files: readonly string[]): string {
  const directory = (file: string) => file.slice(0, Math.max(file.lastIndexOf("/"), 0));
  const last = directory(files.at(-1)!) || "/";
  const lists = files.map(file => directory(file).split("/"));
  const shared: string[] = [];
  for (let index = 0; index < lists[0]!.length; index += 1) {
    const part = lists[0]![index]!;
    if (lists.some(list => list[index] !== part)) break;
    shared.push(part);
  }
  const windows = /^[A-Za-z]:/.test(files[0]!);
  const depth = shared.filter(Boolean).length;
  return depth >= (windows ? 4 : 3) ? shared.join("/") : last;
}
export interface IdeDraft { base: string; text: string; incoming: string | null; safe: boolean; truncated: boolean; }
export function receiveFile(previous: IdeDraft | undefined, contents: string, safe: boolean, truncated: boolean): IdeDraft {
  if (previous && previous.text !== previous.base) {
    return { ...previous, safe, truncated, incoming: contents === previous.base ? null : contents };
  }
  return { base: contents, text: contents, incoming: null, safe, truncated };
}
export function selectionContext(path: string, contents: string, startLine: number, endLine: number) {
  const start = Math.max(1, Math.min(startLine, endLine));
  const end = Math.max(startLine, endLine);
  return { filePath: path, startLine: start, endLine: end, contents };
}

/** What changed between two disk snapshots of one file: the first changed line (1-based, in the new text) and line counts. */
export interface ChangedRegion { firstLine: number; added: number; removed: number; }
export function changedRegion(before: string, after: string): ChangedRegion | null {
  if (before === after) return null;
  const a = before === "" ? [] : before.split("\n"), b = after === "" ? [] : after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { firstLine: head + 1, removed: a.length - head - tail, added: b.length - head - tail };
}

/** A change the panel has seen land on disk and will show briefly. */
export interface IdeFlash { key: string; path: string; before: string; after: string; }
export const MAX_QUEUED_FLASHES = 20;
/** Queue a change. A file already waiting keeps its first "before" so one flash shows everything since; the queue stays short. */
export function enqueueFlash(queue: readonly IdeFlash[], next: IdeFlash): IdeFlash[] {
  const waiting = queue.find(f => f.key === next.key);
  const merged = waiting ? { ...next, before: waiting.before } : next;
  const rest = queue.filter(f => f.key !== next.key);
  // A file that ends up as it started has nothing to show.
  const items = merged.before === merged.after ? rest : [...rest, merged];
  return items.slice(-MAX_QUEUED_FLASHES);
}
/** How long to show a change: long enough to read, shorter when more are waiting. */
export function flashDuration(waiting: number): number { return waiting > 0 ? 1400 : 2600; }
