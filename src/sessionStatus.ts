// Small pure helpers for the read-only session view.

/** The word shown in the status bar for the current session. */
export function sessionStatusLabel(opts: {
  busy: boolean;
  sessionOn: boolean;
  readOnly: boolean;
}): "running" | "read-only" | "connected" | "idle" {
  if (opts.busy) return "running";
  if (opts.readOnly) return "read-only";
  if (opts.sessionOn) return "connected";
  return "idle";
}

/**
 * Cheap change-detector for a transcript tail, so the read-only live-tail poll
 * only re-renders when the transcript actually changed. Folds in the entry
 * count, the last entry's id, and its serialized size — the last captures a
 * still-growing final message that keeps the same id.
 */
export function entriesSignature(
  entries: ReadonlyArray<{ id: string }>,
): string {
  if (entries.length === 0) return "0";
  const last = entries[entries.length - 1];
  return `${entries.length}:${last.id}:${JSON.stringify(last).length}`;
}
