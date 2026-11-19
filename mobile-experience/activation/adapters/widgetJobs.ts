// Blackcrab-owned. What the home screen widget knows about agent jobs.
//
// The phase rule, project titles and thread fields come from the Live Activity module so the
// widget and the lock screen always agree about what a job is doing. Written with erasable
// TypeScript only so the node test runner can import it; the phase rule is injected.
import type { ProgressProject, ProgressThread } from "../features/agent-awareness/liveActivityProgress";

export type WidgetJobPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed";

export interface WidgetJobRow {
  readonly title: string;
  readonly project: string;
  readonly model: string;
  readonly phase: WidgetJobPhase;
  readonly status: string;
  /** When the current run started, or when a waiting job began to wait. Null when unknown. */
  readonly startedAt: number | null;
  /** Path inside the app, opened when the row's widget is tapped. */
  readonly deepLink: string;
}

/** The part of the picture that changes only when something worth showing changes. */
export interface WidgetJobsBase {
  /** Starting or running. */
  readonly working: number;
  /** Waiting for an approval or an answer. */
  readonly attention: number;
  /** Failed within the recent window. */
  readonly failed: number;
  /** Finished within the recent window. */
  readonly done: number;
  readonly rows: ReadonlyArray<WidgetJobRow>;
}

export interface WidgetJobs extends WidgetJobsBase {
  readonly checkedAt: number;
  /** After this the widget says the picture is old instead of showing it. */
  readonly expiresAt: number;
}

export const WIDGET_MAX_JOB_ROWS = 6;
/** A finished job stays on the widget this long. */
export const WIDGET_RECENT_JOB_MS = 60 * 60_000;
/** Matches the usage snapshot: a picture the app stops refreshing degrades the same way. */
export const WIDGET_JOBS_FRESH_MS = 15 * 60_000;

const STATUS: Record<WidgetJobPhase, string> = {
  starting: "Connecting",
  running: "Working",
  waiting_for_approval: "Needs approval",
  waiting_for_input: "Needs input",
  completed: "Done",
  failed: "Failed",
};

function parseMs(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function rank(phase: WidgetJobPhase): number {
  if (phase === "waiting_for_approval" || phase === "waiting_for_input") return 0;
  if (phase === "failed") return 1;
  if (phase === "starting" || phase === "running") return 2;
  return 3;
}

/**
 * Counts and rows for every listed thread this phone can see. Needs-you rows come first, then
 * failures, then running jobs (longest running first, so a stuck one stays visible), then the
 * newest finished ones. Volatile detail such as step counts and the latest message is left
 * out on purpose: it would republish the widget on every streamed token.
 */
export function buildWidgetJobs(input: {
  readonly threads: ReadonlyArray<ProgressThread>;
  readonly projects: ReadonlyArray<ProgressProject>;
  readonly nowMs: number;
  readonly phaseOf: (thread: ProgressThread) => string | null;
}): WidgetJobsBase {
  const projectTitles = new Map(
    input.projects.map((project) => [`${project.environmentId}\u0000${project.id}`, project.title]),
  );
  let working = 0;
  let attention = 0;
  let failed = 0;
  let done = 0;
  const entries: Array<{ row: WidgetJobRow; sort: number }> = [];
  for (const thread of input.threads) {
    if (!thread.listed || thread.archivedAt !== null || thread.deletedAt !== null) continue;
    const phase = input.phaseOf(thread);
    if (
      phase !== "starting" &&
      phase !== "running" &&
      phase !== "waiting_for_approval" &&
      phase !== "waiting_for_input" &&
      phase !== "completed" &&
      phase !== "failed"
    ) {
      continue;
    }
    const project = projectTitles.get(`${thread.environmentId}\u0000${thread.projectId}`);
    if (project === undefined) continue;
    const terminal = phase === "completed" || phase === "failed";
    const updatedAt = parseMs(thread.updatedAt);
    if (terminal && (updatedAt === null || input.nowMs - updatedAt > WIDGET_RECENT_JOB_MS)) continue;
    const waiting = phase === "waiting_for_approval" || phase === "waiting_for_input";
    if (phase === "failed") failed += 1;
    else if (phase === "completed") done += 1;
    else if (waiting) attention += 1;
    else working += 1;
    const startedAt = terminal
      ? null
      : waiting
        ? (parseMs(thread.pendingRequestAt) ?? parseMs(thread.activityRunStartedAt))
        : (parseMs(thread.activityRunStartedAt) ?? parseMs(thread.latestRunStartedAt));
    entries.push({
      row: {
        title: thread.title.trim() || "Untitled thread",
        project,
        model: thread.modelSelection.model,
        phase,
        status: STATUS[phase],
        startedAt,
        deepLink: `/threads/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.id)}`,
      },
      // Older starts and waits first for live jobs; newest first for finished ones.
      sort: terminal ? -(updatedAt ?? 0) : (startedAt ?? Number.MAX_SAFE_INTEGER),
    });
  }
  entries.sort((a, b) => rank(a.row.phase) - rank(b.row.phase) || a.sort - b.sort);
  return {
    working,
    attention,
    failed,
    done,
    rows: entries.slice(0, WIDGET_MAX_JOB_ROWS).map((entry) => entry.row),
  };
}

/** True when there is nothing to show, so the widget can say so instead of drawing zeros. */
export function widgetJobsIdle(jobs: WidgetJobsBase): boolean {
  return jobs.working + jobs.attention + jobs.failed + jobs.done === 0;
}

export function stampWidgetJobs(base: WidgetJobsBase, nowMs: number): WidgetJobs {
  return { ...base, checkedAt: nowMs, expiresAt: nowMs + WIDGET_JOBS_FRESH_MS };
}

/**
 * Adds a timeline entry at the moment the jobs picture goes stale, so the widget redraws with
 * "open Blackcrab to refresh" even if the app never runs again. Entries before then are kept.
 */
export function withJobsDeadline<Entry extends { readonly date: Date }>(
  entries: ReadonlyArray<Entry>,
  jobs: { readonly expiresAt: number } | undefined,
  nowMs: number,
): Entry[] {
  if (jobs === undefined || jobs.expiresAt <= nowMs) return [...entries];
  if (entries.some((entry) => entry.date.getTime() === jobs.expiresAt)) return [...entries];
  const before = entries.filter((entry) => entry.date.getTime() <= jobs.expiresAt);
  const source = before.at(-1) ?? entries[0];
  if (source === undefined) return [];
  return [...entries, { ...source, date: new Date(jobs.expiresAt) }].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}
