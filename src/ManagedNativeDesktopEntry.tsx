import { useEffect, useRef, useState } from "react";
import { managedNativeDesktopClient, type ManagedNativeDesktopClient, type ManagedNativeDesktopStatus } from "./managedNativeDesktopClient";
import "./ManagedWorkspaceEntry.css";
const labels: Record<ManagedNativeDesktopStatus["state"], string> = {
  notBundled: "Full desktop is unavailable in this installation.",
  ready: "Full desktop is ready to open.", running: "Full desktop is running.",
  unsupported: "Full desktop is unavailable on this platform.", unavailable: "Full desktop is unavailable.",
};
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Desktop request failed.";
}
export function ManagedNativeDesktopEntry({ client = managedNativeDesktopClient }: { client?: ManagedNativeDesktopClient }) {
  const [status, setStatus] = useState<ManagedNativeDesktopStatus | null>(null);
  const [pending, setPending] = useState<"checking" | "opening" | null>("checking");
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0), busy = useRef(true);
  useEffect(() => {
    const current = ++epoch.current;
    busy.current = true; setStatus(null); setError(null); setPending("checking");
    void client.status().then(result => { if (epoch.current === current) setStatus(result); },
      failure => { if (epoch.current === current) setError(errorText(failure)); })
      .finally(() => { if (epoch.current === current) { busy.current = false; setPending(null); } });
    return () => { ++epoch.current; };
  }, [client]);
  async function run(open: boolean) {
    if (busy.current) return;
    busy.current = true; const current = ++epoch.current; setPending(open ? "opening" : "checking"); setError(null);
    try { const result = await (open ? client.open() : client.status()); if (epoch.current === current) setStatus(result); }
    catch (failure) { if (epoch.current === current) setError(errorText(failure)); }
    finally { if (epoch.current === current) { busy.current = false; setPending(null); } }
  }
  return <section className="managed-workspace-entry" aria-label="Full desktop" aria-busy={pending !== null}>
    <h3>Full desktop</h3>
    <p>Open the full desktop experience in a separate window.</p>
    <p role="status">{pending === "checking" ? "Checking full desktop…" : pending === "opening" ? "Opening full desktop…" : status ? labels[status.state] : "Full desktop status could not be checked."}</p>
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    <div className="managed-workspace-actions">
      <button type="button" disabled={pending !== null || !status || !["ready", "running"].includes(status.state)} onClick={() => { void run(true); }}>Open full desktop</button>
      <button type="button" disabled={pending !== null} onClick={() => { void run(false); }}>Refresh desktop status</button>
    </div>
  </section>;
}
