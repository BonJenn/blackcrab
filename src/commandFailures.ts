// Recent-errors buffer for the Diagnostics view.
//
// Command errors are surfaced to the user as transient toasts via notifyErr();
// once a toast fades there's nothing left to put in a bug report. This keeps a
// small in-memory ring of recent failures so the Diagnostics panel can show
// them and fold them into its copyable report. Module-level + pub/sub, mirroring
// the toast bus in toast.ts.

export type CommandFailure = {
  at: number;
  context: string;
  detail: string;
};

// How many recent failures to retain. Enough for a useful bug report without
// growing unbounded.
const MAX_FAILURES = 25;

let failures: CommandFailure[] = [];
type Listener = (failures: CommandFailure[]) => void;
const listeners = new Set<Listener>();

/** Record a failure (newest kept last; oldest dropped past the cap). */
export function recordCommandFailure(context: string, detail: string): void {
  const entry: CommandFailure = { at: Date.now(), context, detail };
  failures = [...failures, entry].slice(-MAX_FAILURES);
  listeners.forEach((cb) => cb(failures));
}

/** Snapshot of recent failures, oldest first. */
export function getRecentCommandFailures(): CommandFailure[] {
  return failures;
}

export function subscribeCommandFailures(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Pure one-line rendering for the diagnostics report / panel. */
export function formatCommandFailure(f: CommandFailure): string {
  const time = new Date(f.at).toISOString().slice(11, 19); // HH:MM:SS (UTC)
  return `${time}  ${f.context} — ${f.detail}`;
}

/** Test-only: clear the buffer between cases. */
export function __resetCommandFailures(): void {
  failures = [];
  listeners.clear();
}
