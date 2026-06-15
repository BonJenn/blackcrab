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

const HOST_PLATFORMS: readonly HostPlatform[] = [
  "macos",
  "windows",
  "linux",
  "unknown",
];

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
  /**
   * True when the session is being actively written by another process the
   * phone can't take over (e.g. a terminal). Messaging it won't go through
   * until it's idle, so the UI can flag it.
   */
  liveElsewhere?: boolean;
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
  /** Message text (full, line breaks preserved) or a tool's key detail. */
  preview: string;
  /** True when the host clipped very long content. */
  truncated: boolean;
  /** For tool_call/tool_result: the tool name (e.g. "Bash", "Write"). */
  toolName?: string;
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

export interface FocusSessionAction {
  type: "focus_session";
  hostId: HostId;
  /**
   * Session the host should stream `transcript_tail` for. An empty string
   * clears the focus, returning to the most-recently-active session.
   */
  sessionId: SessionId;
}

export interface SetReadCursorAction {
  type: "set_read_cursor";
  hostId: HostId;
  sessionId: SessionId;
  /**
   * The newest transcript entry the user has read in this session. The host
   * only advances the stored cursor forward (by transcript order), so an
   * out-of-order request from a device showing an older window is ignored.
   */
  lastReadMessageId: MessageId;
  /** Unix epoch milliseconds when the read happened; used as a tiebreaker. */
  readAtMs: number;
}

export interface StartSessionAction {
  type: "start_session";
  hostId: HostId;
  /** Working directory to start the session in (a path on the host). */
  cwd: string;
  /** First message to send, which spawns the conversation. */
  body: string;
}

export type RemoteAction =
  | SendMessageAction
  | StopSessionAction
  | ApproveAction
  | DenyAction
  | FocusSessionAction
  | SetReadCursorAction
  | StartSessionAction;

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
  /**
   * base64 32-byte end-to-end key for relay traffic, minted by the desktop
   * over the trusted LAN pairing channel. Present only on accept.
   */
  e2eKey?: string;
  /** This device's id, used to address it through the relay. Accept only. */
  deviceId?: string;
  rejectedReason?: string;
}

export const DESKTOP_PAIRING_PAYLOAD_TYPE = "blackcrab_desktop_pairing" as const;

export interface DesktopPairingPayload {
  type: typeof DESKTOP_PAIRING_PAYLOAD_TYPE;
  protocolVersion: RemoteProtocolVersion;
  hostId: HostId;
  displayName: string;
  platform: HostPlatform;
  appVersion: string;
  code: PairingCode;
  /** Unix epoch milliseconds when the desktop-side code expires. */
  expiresAtMs: number;
  /** LAN hostname or IP literal the desktop is listening on. */
  lanHost: string;
  /** LAN TCP port the desktop WebSocket server is bound to. */
  lanPort: number;
  /**
   * Relay WebSocket URL the desktop is reachable through off-LAN, when it has
   * a relay configured. The phone connects here when the LAN endpoint is
   * unreachable.
   */
  relayUrl?: string;
}

export type DesktopPairingPayloadInput = Omit<
  DesktopPairingPayload,
  "type" | "protocolVersion"
>;

// ---------------------------------------------------------------------------
// Token auth (mobile -> host on reconnect)
// ---------------------------------------------------------------------------

export interface AuthMessage {
  type: "auth";
  /** Token previously issued by the host in a PairingResponse. */
  remoteToken: string;
}

export interface AuthResponse {
  type: "auth_response";
  status: "accepted" | "rejected";
  hostId?: HostId;
  rejectedReason?: string;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export interface PingMessage {
  type: "ping";
  /** Monotonic counter chosen by the sender. */
  seq: number;
}

export interface PongMessage {
  type: "pong";
  /** Echoes the `seq` from the matching ping. */
  seq: number;
}

export type Heartbeat = PingMessage | PongMessage;

// ---------------------------------------------------------------------------
// Wire envelope
// ---------------------------------------------------------------------------

/**
 * Every message on the LAN/relay transport is wrapped in this envelope. The
 * version field lets either side detect protocol skew before parsing the body.
 */
export interface RemoteEnvelope {
  v: RemoteProtocolVersion;
  msg: RemoteWireMessage;
}

export type RemoteWireMessage =
  | PairingRequest
  | PairingResponse
  | AuthMessage
  | AuthResponse
  | RemoteEvent
  | RemoteAction
  | Heartbeat;

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

/**
 * The host's canonical read cursor for a session, pushed to all connected
 * clients whenever it advances (from any device) and in the connect snapshot.
 */
export interface ReadCursorEvent {
  type: "read_cursor";
  hostId: HostId;
  sessionId: SessionId;
  lastReadMessageId: MessageId;
  readAtMs: number;
}

/** Recent working directories on a host, offered when starting a session. */
export interface ProjectDirsEvent {
  type: "project_dirs";
  hostId: HostId;
  dirs: string[];
}

/** Sent after a phone-initiated session spawns, so the phone can open it. */
export interface SessionStartedEvent {
  type: "session_started";
  hostId: HostId;
  sessionId: SessionId;
  cwd: string;
}

/** A phone-initiated action (start/resume/send) the host couldn't fulfil. */
export interface ActionFailedEvent {
  type: "action_failed";
  hostId: HostId;
  /** The session the action targeted, when applicable. */
  sessionId?: SessionId;
  /** Human-readable reason to show on the phone. */
  reason: string;
}

export type RemoteEvent =
  | PairedHostsEvent
  | SessionsEvent
  | TranscriptTailEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ConnectionStatusEvent
  | ReadCursorEvent
  | ProjectDirsEvent
  | SessionStartedEvent
  | ActionFailedEvent;

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

export function isHostPlatform(value: unknown): value is HostPlatform {
  return (
    typeof value === "string" &&
    HOST_PLATFORMS.includes(value as HostPlatform)
  );
}

export function createDesktopPairingPayload(
  input: DesktopPairingPayloadInput,
): DesktopPairingPayload {
  return {
    type: DESKTOP_PAIRING_PAYLOAD_TYPE,
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    ...input,
  };
}

export function isDesktopPairingPayload(
  value: unknown,
): value is DesktopPairingPayload {
  if (!isRecord(value)) return false;

  return (
    value.type === DESKTOP_PAIRING_PAYLOAD_TYPE &&
    value.protocolVersion === REMOTE_PROTOCOL_VERSION &&
    isNonEmptyString(value.hostId) &&
    isNonEmptyString(value.displayName) &&
    isHostPlatform(value.platform) &&
    isNonEmptyString(value.appVersion) &&
    isPairingCode(value.code) &&
    typeof value.expiresAtMs === "number" &&
    Number.isFinite(value.expiresAtMs) &&
    isNonEmptyString(value.lanHost) &&
    isLanPort(value.lanPort) &&
    (value.relayUrl === undefined || isNonEmptyString(value.relayUrl))
  );
}

function isLanPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 65535
  );
}

export function serializeDesktopPairingPayload(
  payload: DesktopPairingPayload,
): string {
  if (!isDesktopPairingPayload(payload)) {
    throw new Error("Invalid desktop pairing payload.");
  }
  return JSON.stringify(payload);
}

export function parseDesktopPairingPayload(
  value: string,
): DesktopPairingPayload | null {
  try {
    const parsed = JSON.parse(value.trim());
    return isDesktopPairingPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasDesktopPairingPayloadExpired(
  payload: DesktopPairingPayload,
  nowMs = Date.now(),
): boolean {
  return payload.expiresAtMs <= nowMs;
}

export function isRemoteAction(value: unknown): value is RemoteAction {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown };
  switch (v.type) {
    case "send_message":
    case "stop_session":
    case "approve":
    case "deny":
    case "focus_session":
    case "set_read_cursor":
    case "start_session":
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
    case "read_cursor":
    case "project_dirs":
    case "session_started":
    case "action_failed":
      return true;
    default:
      return false;
  }
}

export function isHeartbeat(value: unknown): value is Heartbeat {
  if (!isRecord(value)) return false;
  const seqOk = typeof value.seq === "number" && Number.isFinite(value.seq);
  return seqOk && (value.type === "ping" || value.type === "pong");
}

function isPairingRequest(value: unknown): value is PairingRequest {
  if (!isRecord(value)) return false;
  return (
    value.type === "pairing_request" &&
    isPairingCode(value.code) &&
    isNonEmptyString(value.deviceName) &&
    isNonEmptyString(value.requestedAt)
  );
}

function isPairingResponse(value: unknown): value is PairingResponse {
  if (!isRecord(value)) return false;
  if (value.type !== "pairing_response") return false;
  if (!isPairingCode(value.code)) return false;
  const status = value.status;
  return (
    status === "accepted" || status === "rejected" || status === "expired"
  );
}

function isAuthMessage(value: unknown): value is AuthMessage {
  if (!isRecord(value)) return false;
  return value.type === "auth" && isNonEmptyString(value.remoteToken);
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!isRecord(value)) return false;
  if (value.type !== "auth_response") return false;
  return value.status === "accepted" || value.status === "rejected";
}

export function isRemoteWireMessage(
  value: unknown,
): value is RemoteWireMessage {
  return (
    isPairingRequest(value) ||
    isPairingResponse(value) ||
    isAuthMessage(value) ||
    isAuthResponse(value) ||
    isRemoteEvent(value) ||
    isRemoteAction(value) ||
    isHeartbeat(value)
  );
}

export function isRemoteEnvelope(value: unknown): value is RemoteEnvelope {
  if (!isRecord(value)) return false;
  return (
    value.v === REMOTE_PROTOCOL_VERSION && isRemoteWireMessage(value.msg)
  );
}

export function wrapEnvelope(msg: RemoteWireMessage): RemoteEnvelope {
  return { v: REMOTE_PROTOCOL_VERSION, msg };
}

export function serializeEnvelope(msg: RemoteWireMessage): string {
  return JSON.stringify(wrapEnvelope(msg));
}

export function parseEnvelope(text: string): RemoteEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isRemoteEnvelope(parsed) ? parsed : null;
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
