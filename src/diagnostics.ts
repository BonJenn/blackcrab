export function redactDiagnosticText(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9._-]+/g, "sk-ant-[redacted]")
    .replace(
      /(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=\S+/g,
      "$1=[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/authorization:\s*[^\n]+/gi, "authorization: [redacted]");
}

export function buildDiagnosticsReport({
  rows,
  authAttention,
  activeTitle,
  activeCwd,
  userAgent,
  activityText,
  latestStderr,
}: {
  rows: Array<[string, string]>;
  authAttention: string;
  activeTitle: string;
  activeCwd: string;
  userAgent: string;
  activityText: string;
  latestStderr: string[];
}): string {
  const lines = [
    "Blackcrab diagnostics",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `auth attention: ${authAttention}`,
    `active title: ${activeTitle}`,
    `active cwd: ${activeCwd}`,
    `user agent: ${userAgent}`,
    `activity: ${activityText || "(none)"}`,
    "",
    "recent stderr:",
    latestStderr.length ? latestStderr.join("\n") : "(none)",
  ];
  return redactDiagnosticText(lines.join("\n"));
}
