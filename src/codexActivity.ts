import type { CodexLiveState } from "./codexLive";
export type CodexActivity = "idle" | "running" | "approval" | "detached" | "confirmation";
export function codexActivity(state: CodexLiveState): CodexActivity {
  return state.phase === "detached" ? "detached" : state.approvals.length ? "approval" : state.busy || state.phase === "starting" || state.phase === "stopping" ? "running" : state.pending || state.recoveryBlocked ? "confirmation" : "idle";
}
