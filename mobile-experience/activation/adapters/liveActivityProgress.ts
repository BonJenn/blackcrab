// Blackcrab-owned. Keeps an existing Live Activity current from the app's own connection.
//
// The relay starts no card and pushes only coarse state (working, needs approval, done). While
// the app is running it knows more: what each agent last said, when its run started and how
// many steps it has taken. This module writes that into the card that already exists, and once
// more as the app leaves the foreground so the lock screen holds the freshest picture. It never
// starts or ends a card; that stays with the pinned registration code and the relay.
import { isListedThreadLineage } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { AppState, Platform } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import type {
  AgentActivityPhase,
  AgentActivityProps,
  AgentActivityRowProps,
} from "../../widgets/AgentActivity";
import { getAgentLiveActivities, startAgentLiveActivity } from "./agentLiveActivity";

/** The parts of a thread shell this module reads. */
export interface ProgressThread {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly itemCount: number;
  readonly updatedAt: string;
  readonly settledOverride: "settled" | "active" | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly pendingBackgroundTasks: ReadonlyArray<{
    readonly kind: string;
    readonly awaited?: boolean | undefined;
  }>;
  readonly modelSelection: { readonly model: string };
  readonly listed: boolean;
  readonly status: string;
  readonly activityRunStatus: string | null;
  readonly activityRunStartedAt: string | null;
  readonly latestRunStartedAt: string | null;
  readonly latestRunStopRequested: boolean;
  readonly pendingRequestKind: string | null;
  readonly pendingRequestAt: string | null;
  readonly latestMessage: {
    readonly role: string;
    readonly text: string;
    readonly updatedAt: string;
  } | null;
}

export interface ProgressProject {
  readonly environmentId: string;
  readonly id: string;
  readonly title: string;
}

const MAX_ROWS = 5;
const MAX_DETAIL_LENGTH = 140;
// The relay keeps a finished agent on the card this long; match it.
const TERMINAL_DISPLAY_MS = 15 * 60_000;
// Matches the relay's stale window, so a card the app stops updating degrades the same way.
const STALE_AFTER_MS = 10 * 60_000;
// Leave room in ActivityKit's update budget: one write per interval at most.
const MIN_UPDATE_INTERVAL_MS = 4_000;

const STATUS_BY_PHASE: Record<AgentActivityPhase, string> = {
  starting: "Connecting",
  running: "Working",
  waiting_for_approval: "Approval",
  waiting_for_input: "Input",
  completed: "Done",
  failed: "Failed",
  stale: "Waiting",
};

/** The same rule the computer uses to decide what it publishes for a thread. */
export function progressPhase(thread: ProgressThread): AgentActivityPhase | null {
  if (thread.pendingRequestKind === "user_input") return "waiting_for_input";
  if (thread.pendingRequestKind !== null && thread.pendingRequestKind !== "auth_refresh") {
    return "waiting_for_approval";
  }
  const holdsCompletion = backgroundWorkHoldsCompletion(
    thread.pendingBackgroundTasks as Parameters<typeof backgroundWorkHoldsCompletion>[0],
  );
  switch (thread.activityRunStatus ?? thread.status) {
    case "preparing":
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "completed":
      if (holdsCompletion) return "running";
      if (thread.latestRunStopRequested) return null;
      return thread.settledOverride === "settled" ? null : "completed";
    case "failed":
      return thread.settledOverride === "settled" && !holdsCompletion ? null : "failed";
    default:
      return null;
  }
}

/** One or two lines of plain text from a message that may hold Markdown and code. */
export function progressDetail(text: string): string | null {
  const lines = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+[.)])\s+/, "")
        .replace(/[*_`]+/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
  // The last paragraph is the most recent thing the agent said.
  const latest = lines[lines.length - 1];
  if (!latest) return null;
  return latest.length > MAX_DETAIL_LENGTH
    ? latest.slice(0, MAX_DETAIL_LENGTH - 1).trimEnd() + "…"
    : latest;
}

function phasePriority(phase: AgentActivityPhase): number {
  if (phase === "waiting_for_approval" || phase === "waiting_for_input") return 0;
  if (phase === "failed") return 1;
  if (phase === "starting" || phase === "running") return 2;
  return 3;
}

function rowFor(
  thread: ProgressThread,
  phase: AgentActivityPhase,
  projectTitle: string,
): AgentActivityRowProps {
  const waiting = phase === "waiting_for_approval" || phase === "waiting_for_input";
  const terminal = phase === "completed" || phase === "failed";
  const message = thread.latestMessage;
  const detail =
    !terminal && message !== null && message.role === "assistant"
      ? progressDetail(message.text)
      : null;
  const startedAt = thread.activityRunStartedAt ?? thread.latestRunStartedAt;
  return {
    environmentId: thread.environmentId,
    threadId: thread.id,
    projectTitle,
    threadTitle: thread.title.trim() || "Untitled thread",
    modelTitle: thread.modelSelection.model,
    phase,
    status: STATUS_BY_PHASE[phase],
    // A waiting row counts from the request, so its clock shows how long the agent has waited.
    updatedAt: waiting && thread.pendingRequestAt ? thread.pendingRequestAt : thread.updatedAt,
    deepLink: `/threads/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.id)}`,
    ...(detail !== null && !waiting ? { detail, detailAt: message!.updatedAt } : {}),
    ...(startedAt !== null && !terminal ? { startedAt } : {}),
    ...(thread.itemCount > 0 ? { steps: thread.itemCount } : {}),
  };
}

/**
 * The card contents for the threads this phone can see, or null when none of them is active
 * or recently finished. Row choice and order follow the relay's aggregate.
 */
export function buildProgressActivity(input: {
  readonly threads: ReadonlyArray<ProgressThread>;
  readonly projects: ReadonlyArray<ProgressProject>;
  readonly nowMs: number;
}): AgentActivityProps | null {
  const projectTitles = new Map(
    input.projects.map((project) => [`${project.environmentId}\u0000${project.id}`, project.title]),
  );
  const active: AgentActivityRowProps[] = [];
  const finished: AgentActivityRowProps[] = [];
  for (const thread of input.threads) {
    if (!thread.listed || thread.archivedAt !== null || thread.deletedAt !== null) continue;
    const phase = progressPhase(thread);
    if (phase === null) continue;
    const projectTitle = projectTitles.get(`${thread.environmentId}\u0000${thread.projectId}`);
    if (!projectTitle) continue;
    const row = rowFor(thread, phase, projectTitle);
    if (phase === "completed" || phase === "failed") {
      const updatedAtMs = Date.parse(thread.updatedAt);
      if (Number.isFinite(updatedAtMs) && input.nowMs - updatedAtMs <= TERMINAL_DISPLAY_MS) {
        finished.push(row);
      }
    } else {
      active.push(row);
    }
  }
  finished.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (active.length === 0 && finished.length === 0) return null;
  active.sort((a, b) => phasePriority(a.phase) - phasePriority(b.phase));
  const rows = [...active.slice(0, MAX_ROWS), ...finished].slice(0, MAX_ROWS);
  const updatedAt = [...active, ...finished].reduce(
    (latest, row) => (row.updatedAt.localeCompare(latest) > 0 ? row.updatedAt : latest),
    rows[0]!.updatedAt,
  );
  const failed = active.length === 0 && finished[0]?.phase === "failed";
  return {
    title: "Blackcrab",
    subtitle:
      active.length > 0
        ? "Agent work in progress"
        : failed
          ? "Agent work failed"
          : "Agent work completed",
    activeCount: active.length,
    updatedAt,
    activities: rows,
  };
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    const ms =
      value instanceof Date
        ? value.getTime()
        : typeof (value as { epochMilliseconds?: unknown }).epochMilliseconds === "number"
          ? (value as { epochMilliseconds: number }).epochMilliseconds
          : Number.NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch {
    return null;
  }
}

export function currentThreads(): ReadonlyArray<ProgressThread> {
  return appAtomRegistry.get(environmentThreadShells.threadShellsAtom).map((shell) => {
    const source = shell.source;
    const message = source.latestVisibleMessage;
    const messageAt = message ? isoOrNull(message.updatedAt) : null;
    return {
      environmentId: shell.environmentId,
      id: shell.id,
      projectId: shell.projectId,
      title: shell.title,
      itemCount: shell.itemCount,
      updatedAt: shell.updatedAt,
      settledOverride: shell.settledOverride,
      archivedAt: shell.archivedAt,
      deletedAt: shell.deletedAt,
      pendingBackgroundTasks: shell.pendingBackgroundTasks,
      modelSelection: shell.modelSelection,
      listed: isListedThreadLineage(shell.lineage),
      status: source.status,
      activityRunStatus: source.activityRunStatus ?? null,
      activityRunStartedAt: isoOrNull(source.activityRunStartedAt),
      latestRunStartedAt: isoOrNull(source.latestRunStartedAt),
      latestRunStopRequested: source.latestRunStopRequested === true,
      pendingRequestKind: source.pendingRuntimeRequest?.kind ?? null,
      pendingRequestAt: isoOrNull(source.pendingRuntimeRequest?.createdAt),
      latestMessage:
        message && messageAt !== null
          ? { role: message.role, text: message.text, updatedAt: messageAt }
          : null,
    };
  });
}

export function currentProjects(): ReadonlyArray<ProgressProject> {
  return appAtomRegistry
    .get(environmentProjects.projectsAtom)
    .map((project) => ({
      environmentId: project.environmentId,
      id: project.id,
      title: project.title,
    }));
}

let lastWritten: string | null = null;

function writeProgress(): void {
  let activities: ReturnType<typeof getAgentLiveActivities>;
  try {
    activities = getAgentLiveActivities();
  } catch {
    return;
  }
  if (activities.length === 0) {
    lastWritten = null;
    return;
  }
  const next = buildProgressActivity({
    threads: currentThreads(),
    projects: currentProjects(),
    nowMs: Date.now(),
  });
  // Nothing visible from this phone: leave the relay's picture alone.
  if (next === null) return;
  const serialized = JSON.stringify(next);
  if (serialized === lastWritten) return;
  lastWritten = serialized;
  const staleDate = new Date(Date.now() + STALE_AFTER_MS);
  // The relay tracks one card per device; only that one is kept current.
  activities[0]!.update(next, staleDate).catch(() => {
    lastWritten = null;
  });
}

/** Starts keeping the Live Activity current. Returns a function that stops it. */
export function installLiveActivityProgress(): () => void {
  if (Platform.OS !== "ios") return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRunAt = 0;
  const run = () => {
    timer = null;
    lastRunAt = Date.now();
    try {
      writeProgress();
    } catch {
      // A failed refresh leaves the relay's last picture in place.
    }
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(run, Math.max(250, MIN_UPDATE_INTERVAL_MS - (Date.now() - lastRunAt)));
  };
  const unsubscribeThreads = appAtomRegistry.subscribe(
    environmentThreadShells.threadShellsAtom,
    schedule,
  );
  const unsubscribeProjects = appAtomRegistry.subscribe(environmentProjects.projectsAtom, schedule);
  // Leaving the foreground suspends timers within seconds: write the latest picture now.
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      schedule();
      return;
    }
    if (timer !== null) clearTimeout(timer);
    run();
  });
  schedule();
  return () => {
    unsubscribeThreads();
    unsubscribeProjects();
    appState.remove();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

/**
 * Fixed examples shown from Settings so people can see the card without running an agent:
 * several agents at once, one agent at work, and finished work.
 */
export function sampleProgressActivity(nowMs: number, variant = 0): AgentActivityProps {
  const at = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString();
  const row = (
    id: string,
    threadTitle: string,
    projectTitle: string,
    phase: AgentActivityPhase,
    minutesAgo: number,
    extra: Partial<AgentActivityRowProps> = {},
  ): AgentActivityRowProps => ({
    environmentId: "",
    threadId: id,
    projectTitle,
    threadTitle,
    modelTitle: "claude-sonnet-5",
    phase,
    status: STATUS_BY_PHASE[phase],
    updatedAt: at(minutesAgo),
    deepLink: "/",
    ...extra,
  });
  const working = row("sample-1", "Fix flaky checkout test", "storefront", "running", 4, {
    detail: "Running the checkout suite again with the retry removed.",
    detailAt: at(0),
    startedAt: at(4),
    steps: 37,
  });
  switch (((variant % 3) + 3) % 3) {
    case 1:
      return {
        title: "Blackcrab",
        subtitle: "Agent work in progress",
        activeCount: 1,
        updatedAt: at(0),
        activities: [working],
      };
    case 2:
      return {
        title: "Blackcrab",
        subtitle: "Agent work completed",
        activeCount: 0,
        updatedAt: at(0),
        activities: [
          row("sample-1", "Fix flaky checkout test", "storefront", "completed", 0, { steps: 41 }),
          row("sample-3", "Update README badges", "storefront", "completed", 6, { steps: 9 }),
        ],
      };
    default:
      return {
        title: "Blackcrab",
        subtitle: "Agent work in progress",
        activeCount: 2,
        updatedAt: at(0),
        activities: [
          working,
          row("sample-2", "Add CSV export", "reports", "waiting_for_approval", 1, { steps: 12 }),
          row("sample-3", "Update README badges", "storefront", "completed", 6, { steps: 9 }),
        ],
      };
  }
}

let sampleId: string | null = null;
let sampleVariant = 0;
let sampleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Shows an example card, or the next example when one is already showing. Returns false when
 * the system would not start it.
 */
export function showSampleLiveActivity(): boolean {
  if (Platform.OS !== "ios") return false;
  try {
    const now = Date.now();
    // A short stale window ends the example's claim that agents are working, even if the app
    // is suspended before the timer below can remove the card.
    const staleDate = new Date(now + 2 * 60_000);
    const existing = getAgentLiveActivities();
    const showing = existing.find((activity) => activity.getId() === sampleId);
    if (showing) {
      sampleVariant += 1;
      showing.update(sampleProgressActivity(now, sampleVariant), staleDate).catch(() => undefined);
    } else {
      // A real card, if one is showing, is more useful than the example.
      if (existing.length > 0) return true;
      sampleVariant = 0;
      const sample = startAgentLiveActivity(sampleProgressActivity(now, 0), staleDate);
      if (sample === null) return false;
      sampleId = sample.getId();
    }
    const endingId = sampleId;
    if (sampleTimer !== null) clearTimeout(sampleTimer);
    sampleTimer = setTimeout(() => {
      sampleTimer = null;
      try {
        for (const activity of getAgentLiveActivities()) {
          // Real progress written into the card since then makes it a real card: keep it.
          if (activity.getId() === endingId && lastWritten === null) {
            activity.end("immediate").catch(() => undefined);
          }
        }
      } catch {
        // The system removes a stale card by itself.
      }
      if (sampleId === endingId) sampleId = null;
    }, 75_000);
    return true;
  } catch {
    return false;
  }
}
