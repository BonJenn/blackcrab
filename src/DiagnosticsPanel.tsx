import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { notify, notifyErr } from "./toast";
import {
  buildDiagnosticsReport,
  diagnosticActivityState,
  redactDiagnosticText,
  type DiagnosticActivityStore,
  type DiagnosticClaudePreflight,
  type DiagnosticSession,
} from "./diagnostics";

type DiagnosticsPanelProps = {
  cwd: string;
  activeSessionId?: string;
  activeSession?: DiagnosticSession;
  sessionOn: boolean;
  busy: boolean;
  stuckBusy: boolean;
  gridMode: boolean;
  sessions: DiagnosticSession[];
  attentionCount: number;
  activity: DiagnosticActivityStore;
  pendingPermission: { toolName: string } | null;
  pendingDenials: Array<{ tool_name: string; tool_input?: unknown }> | null;
  stderrLines: string[];
  claudePreflight: DiagnosticClaudePreflight | null;
  onClose: () => void;
};

export function DiagnosticsPanel({
  cwd,
  activeSessionId,
  activeSession,
  sessionOn,
  busy,
  stuckBusy,
  gridMode,
  sessions,
  attentionCount,
  activity,
  pendingPermission,
  pendingDenials,
  stderrLines,
  claudePreflight,
  onClose,
}: DiagnosticsPanelProps) {
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  const activityCounts = useMemo(
    () =>
      sessions.reduce<Record<string, number>>((acc, session) => {
        const state = diagnosticActivityState(session, activity);
        acc[state] = (acc[state] ?? 0) + 1;
        return acc;
      }, {}),
    [activity, sessions],
  );
  const archivedCount = useMemo(
    () => sessions.filter((s) => s.archived).length,
    [sessions],
  );
  const latestStderr = useMemo(() => stderrLines.slice(-8), [stderrLines]);
  const rows = useMemo<Array<[string, string]>>(
    () => [
      ["app", appVersion || "(unknown)"],
      ["platform", navigator.platform || "(unknown)"],
      ["cwd", cwd || "(unset)"],
      ["active", activeSessionId ? activeSessionId.slice(0, 8) : "(none)"],
      ["connected", sessionOn ? "yes" : "no"],
      ["busy", busy ? (stuckBusy ? "stuck" : "yes") : "no"],
      ["mode", gridMode ? "grid" : "single"],
      ["sessions", String(sessions.length)],
      ["attention", String(attentionCount)],
      ["archived", String(archivedCount)],
      ["permission", pendingPermission ? pendingPermission.toolName : "none"],
      ["denials", pendingDenials ? String(pendingDenials.length) : "0"],
      ["stderr", String(stderrLines.length)],
      ["claude", claudePreflight?.version || "(unknown)"],
      ["claude path", claudePreflight?.path || "(unknown)"],
      ["auth", claudePreflight?.authenticated ? "ready" : "needs setup"],
      ["auth method", claudePreflight?.auth_method || "(none)"],
      ["token source", claudePreflight?.token_source || "none"],
      ["token error", claudePreflight?.token_error || "none"],
      ["env conflict", claudePreflight?.auth_env_conflict ? "yes" : "no"],
    ],
    [
      activeSessionId,
      appVersion,
      archivedCount,
      attentionCount,
      busy,
      claudePreflight,
      cwd,
      gridMode,
      pendingDenials,
      pendingPermission,
      sessionOn,
      sessions.length,
      stderrLines.length,
      stuckBusy,
    ],
  );
  const report = useMemo(
    () =>
      buildDiagnosticsReport({
        rows,
        authAttention: claudePreflight?.auth_needs_attention
          ? claudePreflight.auth_attention_reason || "yes"
          : "no",
        activeTitle: activeSession?.title || "(none)",
        activeCwd: activeSession?.cwd || cwd || "(unset)",
        userAgent: navigator.userAgent || "(unknown)",
        activityCounts,
        latestStderr,
      }),
    [activeSession, activityCounts, claudePreflight, cwd, latestStderr, rows],
  );

  const copyReport = () => {
    if (!navigator.clipboard) {
      notify("Clipboard is not available", "error");
      return;
    }
    navigator.clipboard
      .writeText(report)
      .then(() => notify("Diagnostics copied", "success"))
      .catch(notifyErr("copy diagnostics failed"));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="diagnostics-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="diagnostics-panel">
        <header className="diagnostics-head">
          <div>
            <div className="diagnostics-title">Diagnostics</div>
            <div className="diagnostics-subtitle">
              {activeSession?.title || "No active conversation"}
            </div>
          </div>
          <div className="diagnostics-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={copyReport}
              title="copy redacted diagnostics"
            >
              Copy report
            </button>
            <button
              type="button"
              className="search-btn search-close"
              onClick={onClose}
              title="close"
              aria-label="close diagnostics"
            >
              &times;
            </button>
          </div>
        </header>
        <div className="diagnostics-grid">
          {rows.map(([label, value]) => (
            <div key={label} className="diagnostics-row">
              <span>{label}</span>
              <strong title={value}>{value}</strong>
            </div>
          ))}
        </div>
        <section className="diagnostics-section">
          <div className="diagnostics-section-title">Activity</div>
          <div className="diagnostics-chips">
            {Object.entries(activityCounts).map(([state, count]) => (
              <span key={state} className={`diagnostics-chip state-${state}`}>
                {state}: {count}
              </span>
            ))}
          </div>
        </section>
        <section className="diagnostics-section">
          <div className="diagnostics-section-title">Recent stderr</div>
          {latestStderr.length === 0 ? (
            <div className="diagnostics-empty">no stderr captured</div>
          ) : (
            <pre className="diagnostics-stderr">
              {redactDiagnosticText(latestStderr.join("\n"))}
            </pre>
          )}
        </section>
        <section className="diagnostics-section">
          <div className="diagnostics-section-title">Copyable report</div>
          <pre className="diagnostics-stderr diagnostics-report">{report}</pre>
        </section>
      </div>
    </div>
  );
}
