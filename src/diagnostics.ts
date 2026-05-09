export type DiagnosticSession = {
  id: string;
  title: string;
  cwd: string;
  mtime_ms: number;
  archived: boolean;
  interrupted: boolean;
  last_result_is_error: boolean;
  last_result_subtype: string;
};

export type DiagnosticActivityState =
  | "idle"
  | "running"
  | "waiting"
  | "done"
  | "error"
  | "unread"
  | "interrupted";

export type DiagnosticActivityStore = Record<
  string,
  {
    state: DiagnosticActivityState;
    unread: boolean;
    updated_ms: number;
    text?: string;
  }
>;

export type DiagnosticClaudePreflight = {
  authenticated: boolean;
  version: string;
  path: string;
  auth_method: string;
  api_provider: string;
  token_source: string;
  token_error: string;
  auth_env_conflict: boolean;
  auth_needs_attention: boolean;
  auth_attention_reason: string;
};

export type DiagnosticReportInput = {
  rows: Array<[string, string]>;
  authAttention: string;
  activeTitle: string;
  activeCwd: string;
  userAgent: string;
  activityCounts: Record<string, number>;
  latestStderr: string[];
};

const SECRET_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
].join("|");

export function diagnosticActivityState(
  session: DiagnosticSession,
  activity: DiagnosticActivityStore,
): DiagnosticActivityState {
  const stored = activity[session.id];
  if (stored) return stored.state;
  if (session.interrupted) return "interrupted";
  if (session.last_result_is_error) return "error";
  return "idle";
}

export function buildDiagnosticsReport(input: DiagnosticReportInput): string {
  const activityText = Object.entries(input.activityCounts)
    .map(([state, count]) => `${state}: ${count}`)
    .join(", ");
  const lines = [
    "Blackcrab diagnostics",
    "",
    ...input.rows.map(([label, value]) => `${label}: ${value}`),
    `auth attention: ${input.authAttention}`,
    `active title: ${input.activeTitle || "(none)"}`,
    `active cwd: ${input.activeCwd || "(unset)"}`,
    `user agent: ${input.userAgent || "(unknown)"}`,
    `activity: ${activityText || "(none)"}`,
    "",
    "recent stderr:",
    input.latestStderr.length ? input.latestStderr.join("\n") : "(none)",
  ];
  return redactDiagnosticText(lines.join("\n"));
}

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/\bsk-ant-[A-Za-z0-9._:=+/-]+/g, "sk-ant-[redacted]")
    .replace(
      new RegExp(
        `\\b(${SECRET_ENV_NAMES})\\s*=\\s*("[^"\\r\\n]*"|'[^'\\r\\n]*'|\\S+)`,
        "g",
      ),
      "$1=[redacted]",
    )
    .replace(
      /(["'])(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|api[_-]?key|auth[_-]?token|access[_-]?token|oauth[_-]?token)\1\s*:\s*(["'])([^"'\r\n]*)\3/gi,
      (_match, quote: string, key: string, valueQuote: string) =>
        `${quote}${key}${quote}: ${valueQuote}[redacted]${valueQuote}`,
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(
      /\b(authorization|x-api-key|api-key|anthropic-api-key)\s*:\s*[^\r\n]+/gi,
      "$1: [redacted]",
    )
    .replace(
      /\b((?:api[_-]?key|auth[_-]?token|access[_-]?token|oauth[_-]?token)=)[^&\s\r\n]+/gi,
      "$1[redacted]",
    );
}
