/**
 * Blackcrab remote protocol.
 *
 * Typed message shapes shared between the Blackcrab desktop host and the
 * mobile companion. This package intentionally has no transport, no relay
 * client, and no runtime side effects beyond a few small validation helpers.
 */

export const REMOTE_PROTOCOL_VERSION = 1 as const;

export type RemoteProtocolVersion = typeof REMOTE_PROTOCOL_VERSION;

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export type HostId = string;
export type SessionId = string;
export type MessageId = string;
export type ApprovalId = string;
export type PairingCode = string;

// ---------------------------------------------------------------------------
// Paired host summary
// ---------------------------------------------------------------------------

export type HostPlatform = "macos" | "windows" | "linux" | "unknown";

export interface PairedHostSummary {
  hostId: HostId;
  displayName: string;
  platform: HostPlatform;
  appVersion: string;
  lastSeenAt: string;
  online: boolean;
}

// ---------------------------------------------------------------------------
// Session summary
// ---------------------------------------------------------------------------

export type SessionState =
  | "idle"
  | "running"
  | "awaiting_input"
  | "awaiting_approval"
  | "completed"
  | "errored";

export interface SessionSummary {
  hostId: HostId;
  sessionId: SessionId;
  title: string;
  projectPath: string;
  model: string;
  state: SessionState;
  updatedAt: string;
  pendingApprovalCount: number;
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// Transcript tail entries
// ---------------------------------------------------------------------------

export type TranscriptEntryKind =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "system_notice";

export interface TranscriptEntry {
  id: MessageId;
  sessionId: SessionId;
  kind: TranscriptEntryKind;
  createdAt: string;
  /** Short, already-truncated preview safe to render on a phone. */
  preview: string;
  /** True when the host has more content for this entry than `preview` shows. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Approval requests
// ---------------------------------------------------------------------------

export type ApprovalKind =
  | "tool_call"
  | "file_write"
  | "shell_command"
  | "network_request"
  | "other";

export interface ApprovalRequest {
  id: ApprovalId;
  hostId: HostId;
  sessionId: SessionId;
  kind: ApprovalKind;
  summary: string;
  requestedAt: string;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Actions (mobile -> host)
// ---------------------------------------------------------------------------

export interface SendMessageAction {
  type: "send_message";
  hostId: HostId;
  sessionId: SessionId;
  body: string;
}

export interface StopSessionAction {
  type: "stop_session";
  hostId: HostId;
  sessionId: SessionId;
}

export interface ApproveAction {
  type: "approve";
  hostId: HostId;
  approvalId: ApprovalId;
}

export interface DenyAction {
  type: "deny";
  hostId: HostId;
  approvalId: ApprovalId;
  reason?: string;
}

export type RemoteAction =
  | SendMessageAction
  | StopSessionAction
  | ApproveAction
  | DenyAction;

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export interface PairingRequest {
  type: "pairing_request";
  /** Short human-readable code shown on the desktop host. */
  code: PairingCode;
  /** Display name the mobile device suggests for itself. */
  deviceName: string;
  /** ISO-8601 timestamp the request was created. */
  requestedAt: string;
}

export type PairingResponseStatus = "accepted" | "rejected" | "expired";

export interface PairingResponse {
  type: "pairing_response";
  code: PairingCode;
  status: PairingResponseStatus;
  hostId?: HostId;
  /** Token the mobile client uses on subsequent connections. Present only on accept. */
  remoteToken?: string;
  rejectedReason?: string;
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

export type ConnectionStatusState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ConnectionStatus {
  state: ConnectionStatusState;
  hostId?: HostId;
  since: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Events (host -> mobile)
// ---------------------------------------------------------------------------

export interface PairedHostsEvent {
  type: "paired_hosts";
  hosts: PairedHostSummary[];
}

export interface SessionsEvent {
  type: "sessions";
  hostId: HostId;
  sessions: SessionSummary[];
}

export interface TranscriptTailEvent {
  type: "transcript_tail";
  hostId: HostId;
  sessionId: SessionId;
  entries: TranscriptEntry[];
}

export interface ApprovalRequestedEvent {
  type: "approval_requested";
  approval: ApprovalRequest;
}

export interface ApprovalResolvedEvent {
  type: "approval_resolved";
  approvalId: ApprovalId;
  resolution: "approved" | "denied" | "expired";
}

export interface ConnectionStatusEvent {
  type: "connection_status";
  status: ConnectionStatus;
}

export type RemoteEvent =
  | PairedHostsEvent
  | SessionsEvent
  | TranscriptTailEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ConnectionStatusEvent;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pairing codes are short, user-readable strings shown on the desktop. We
 * accept 6–10 characters from an unambiguous alphabet (no 0/O/1/I) so users
 * can read them off-screen without typos.
 */
const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,10}$/;

export function isPairingCode(value: unknown): value is PairingCode {
  return typeof value === "string" && PAIRING_CODE_PATTERN.test(value);
}

export function isRemoteAction(value: unknown): value is RemoteAction {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown };
  switch (v.type) {
    case "send_message":
    case "stop_session":
    case "approve":
    case "deny":
      return true;
    default:
      return false;
  }
}

export function isRemoteEvent(value: unknown): value is RemoteEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown };
  switch (v.type) {
    case "paired_hosts":
    case "sessions":
    case "transcript_tail":
    case "approval_requested":
    case "approval_resolved":
    case "connection_status":
      return true;
    default:
      return false;
  }
}

/**
 * Mock data for early UI work. Lives in the protocol package so the mobile
 * app does not invent shapes that drift from the contract.
 */
export const MOCK_PAIRED_HOSTS: PairedHostSummary[] = [
  {
    hostId: "host-local-mac",
    displayName: "Studio MacBook Pro",
    platform: "macos",
    appVersion: "0.2.0",
    lastSeenAt: "2026-05-17T12:00:00Z",
    online: true,
  },
  {
    hostId: "host-linux-box",
    displayName: "Workshop Linux",
    platform: "linux",
    appVersion: "0.2.0",
    lastSeenAt: "2026-05-16T22:14:00Z",
    online: false,
  },
];

export const MOCK_SESSIONS: SessionSummary[] = [
  {
    hostId: "host-local-mac",
    sessionId: "sess-abc",
    title: "Mobile remote foundation",
    projectPath: "~/Desktop/Programming/blackcrab",
    model: "claude-opus-4-7",
    state: "running",
    updatedAt: "2026-05-17T11:58:00Z",
    pendingApprovalCount: 1,
    unreadCount: 3,
  },
  {
    hostId: "host-local-mac",
    sessionId: "sess-def",
    title: "Release notes draft",
    projectPath: "~/Desktop/Programming/blackcrab",
    model: "claude-sonnet-4-6",
    state: "awaiting_input",
    updatedAt: "2026-05-17T10:42:00Z",
    pendingApprovalCount: 0,
    unreadCount: 0,
  },
];

export const MOCK_TRANSCRIPT_TAIL: TranscriptEntry[] = [
  {
    id: "msg-1",
    sessionId: "sess-abc",
    kind: "user_message",
    createdAt: "2026-05-17T11:55:00Z",
    preview: "Add the mobile remote foundation per the plan.",
    truncated: false,
  },
  {
    id: "msg-2",
    sessionId: "sess-abc",
    kind: "assistant_message",
    createdAt: "2026-05-17T11:55:30Z",
    preview: "Creating workspaces, protocol package, and Expo skeleton...",
    truncated: true,
  },
  {
    id: "msg-3",
    sessionId: "sess-abc",
    kind: "tool_call",
    createdAt: "2026-05-17T11:56:00Z",
    preview: "Write packages/remote-protocol/src/index.ts",
    truncated: false,
  },
];

export const MOCK_APPROVALS: ApprovalRequest[] = [
  {
    id: "appr-1",
    hostId: "host-local-mac",
    sessionId: "sess-abc",
    kind: "shell_command",
    summary: "Run `npm test` in repo root",
    requestedAt: "2026-05-17T11:57:00Z",
  },
];
