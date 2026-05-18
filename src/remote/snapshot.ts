/**
 * Adapter from desktop session shapes into typed remote-protocol payloads.
 *
 * This is intentionally a pure mapper. It does not subscribe to events, does
 * not open sockets, and does not push anything to a relay. It exists so the
 * future relay/pairing code has a single, tested place that converts what
 * the desktop already knows into what the protocol promises mobile.
 */

import {
  type ApprovalKind,
  type ApprovalRequest,
  type HostPlatform,
  type PairedHostSummary,
  type PairedHostsEvent,
  type RemoteEvent,
  type SessionState,
  type SessionSummary,
  type SessionsEvent,
} from "@blackcrab/remote-protocol";

/** Minimal slice of the desktop SessionInfo this module actually depends on. */
export interface DesktopSessionInfo {
  id: string;
  title: string;
  cwd: string;
  model: string;
  mtime_ms: number;
  interrupted: boolean;
  last_result_is_error: boolean;
}

/** Minimal slice of the desktop SessionActivity this module actually depends on. */
export interface DesktopSessionActivity {
  state: "idle" | "running" | "waiting" | "done" | "error" | "unread" | "interrupted";
  unread: boolean;
}

/** A pending permission/approval prompt visible on the desktop side. */
export interface DesktopApprovalPrompt {
  id: string;
  sessionId: string;
  kind: ApprovalKind;
  summary: string;
  requestedAtMs: number;
  expiresAtMs?: number;
}

export interface DesktopHostInfo {
  hostId: string;
  displayName: string;
  platform: HostPlatform;
  appVersion: string;
  online: boolean;
  lastSeenAtMs: number;
}

export function toPairedHostSummary(host: DesktopHostInfo): PairedHostSummary {
  return {
    hostId: host.hostId,
    displayName: host.displayName,
    platform: host.platform,
    appVersion: host.appVersion,
    online: host.online,
    lastSeenAt: new Date(host.lastSeenAtMs).toISOString(),
  };
}

export function toSessionState(
  info: Pick<DesktopSessionInfo, "interrupted" | "last_result_is_error">,
  activity: DesktopSessionActivity | undefined,
  pendingApprovalCount: number,
): SessionState {
  if (info.last_result_is_error || activity?.state === "error") return "errored";
  if (pendingApprovalCount > 0) return "awaiting_approval";
  if (info.interrupted) return "idle";
  switch (activity?.state) {
    case "running":
      return "running";
    case "waiting":
      return "awaiting_input";
    case "done":
      return "completed";
    case "unread":
      return "completed";
    case "interrupted":
      return "idle";
    case "idle":
    case undefined:
      return "idle";
  }
}

export function toSessionSummary(args: {
  hostId: string;
  info: DesktopSessionInfo;
  activity?: DesktopSessionActivity;
  pendingApprovalCount?: number;
  unreadCount?: number;
}): SessionSummary {
  const pendingApprovalCount = args.pendingApprovalCount ?? 0;
  return {
    hostId: args.hostId,
    sessionId: args.info.id,
    title: args.info.title,
    projectPath: args.info.cwd,
    model: args.info.model,
    state: toSessionState(args.info, args.activity, pendingApprovalCount),
    updatedAt: new Date(args.info.mtime_ms).toISOString(),
    pendingApprovalCount,
    unreadCount: args.unreadCount ?? (args.activity?.unread ? 1 : 0),
  };
}

export function toApprovalRequest(
  hostId: string,
  prompt: DesktopApprovalPrompt,
): ApprovalRequest {
  return {
    id: prompt.id,
    hostId,
    sessionId: prompt.sessionId,
    kind: prompt.kind,
    summary: prompt.summary,
    requestedAt: new Date(prompt.requestedAtMs).toISOString(),
    expiresAt:
      prompt.expiresAtMs !== undefined
        ? new Date(prompt.expiresAtMs).toISOString()
        : undefined,
  };
}

export interface SnapshotInput {
  host: DesktopHostInfo;
  sessions: {
    info: DesktopSessionInfo;
    activity?: DesktopSessionActivity;
  }[];
  approvals?: DesktopApprovalPrompt[];
}

/**
 * Build the initial bundle of events a freshly-connected mobile client would
 * receive: the paired-host summary and the sessions snapshot for that host.
 * Approvals are folded into per-session counts; the relay would emit
 * individual `approval_requested` events when wired up.
 */
export function buildSnapshotEvents(input: SnapshotInput): RemoteEvent[] {
  const approvalsBySession = new Map<string, number>();
  for (const approval of input.approvals ?? []) {
    approvalsBySession.set(
      approval.sessionId,
      (approvalsBySession.get(approval.sessionId) ?? 0) + 1,
    );
  }

  const hostsEvent: PairedHostsEvent = {
    type: "paired_hosts",
    hosts: [toPairedHostSummary(input.host)],
  };

  const sessionsEvent: SessionsEvent = {
    type: "sessions",
    hostId: input.host.hostId,
    sessions: input.sessions.map(({ info, activity }) =>
      toSessionSummary({
        hostId: input.host.hostId,
        info,
        activity,
        pendingApprovalCount: approvalsBySession.get(info.id) ?? 0,
      }),
    ),
  };

  return [hostsEvent, sessionsEvent];
}
