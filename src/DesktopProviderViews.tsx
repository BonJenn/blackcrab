import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { CodexActivity } from "./codexActivity";
import type { DesktopProvider } from "./desktopProvider";
const CodexHistory = lazy(() => import("./CodexHistory"));

/** Keep conversation owners mounted when switching provider surfaces. */
export function DesktopProviderViews({ provider, defaultCwd, onChange, onCodexActivity, onOpenDesktop, error, children }: { provider: DesktopProvider; defaultCwd: string; onChange: (provider: DesktopProvider) => void; onCodexActivity: (activity: CodexActivity) => void; onOpenDesktop?: () => void; error?: string | null; children: ReactNode }) {
  const [codexLoaded, setCodexLoaded] = useState(provider === "codex");
  useEffect(() => { if (provider === "codex") setCodexLoaded(true); }, [provider]);
  return <>
    <div className="claude-desktop-view" hidden={provider !== "claude"} inert={provider !== "claude"}>{children}</div>
    {(codexLoaded || provider === "codex") && <Suspense fallback={provider === "codex" ? <main role="status">Loading Codex workspace…</main> : null}>
      <CodexHistory presentation="workspace" open={provider === "codex"} defaultCwd={defaultCwd} onActivity={onCodexActivity} onOpenDesktop={onOpenDesktop} saveError={error} onClose={() => onChange("claude")} />
    </Suspense>}
  </>;
}
