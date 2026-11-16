/** IDE follows only structured host file-change events; tool text is never executed or animated. */
export interface IdeFileEvent {
  readonly id: string;
  readonly updatedAt?: unknown;
  readonly type: string;
  readonly status: string;
  readonly fileName?: string | undefined;
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
  const files = new Map<string, { path: string; status: string; token: string }>();
  for (const { item } of events) {
    if (item.type !== "file_change") continue;
    for (const change of item.changes?.length ? item.changes : [{ path: item.fileName ?? "", operation: "edit" }]) {
      const path = workspaceRelativePath(root, change.path);
      if (!path) continue;
      files.delete(path);
      files.set(path, { path, status: `${change.operation} · ${item.status}`, token: JSON.stringify([item.id, item.updatedAt, item.status, path]) });
    }
  }
  return [...files.values()];
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
