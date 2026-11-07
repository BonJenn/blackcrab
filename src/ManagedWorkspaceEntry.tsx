import { useEffect, useRef, useState } from "react";
import { managedHostClient, type ManagedHostClient, type ManagedHostStatus } from "./managedHostClient";
import "./ManagedWorkspaceEntry.css";

type Pending = "checking" | "choosing" | "starting" | "opening" | null;
const statusLabels: Record<ManagedHostStatus["state"], string> = {
  notConfigured: "Choose a workspace runtime to get started.",
  stopped: "Workspace service is stopped. Opening a workspace will start it.",
  running: "Workspace service is running.",
  unavailable: "Workspace service is unavailable.",
};
const pendingLabels: Record<Exclude<Pending, null>, string> = {
  checking: "Checking workspace service…",
  choosing: "Choosing workspace runtime…",
  starting: "Starting workspace service…",
  opening: "Opening workspace…",
};
function errorText(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Workspace service request failed.";
}

export function ManagedWorkspaceEntry({ client = managedHostClient }: { client?: ManagedHostClient }) {
  const [status, setStatus] = useState<ManagedHostStatus | null>(null);
  const [pending, setPending] = useState<Pending>("checking");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const epoch = useRef(0);
  const busy = useRef(true);

  useEffect(() => {
    const current = ++epoch.current;
    busy.current = true; setStatus(null); setPending("checking"); setError(null); setOpened(false);
    void client.status().then(
      result => { if (epoch.current === current) setStatus(result); },
      failure => { if (epoch.current === current) setError(errorText(failure)); },
    ).finally(() => {
      if (epoch.current === current) { busy.current = false; setPending(null); }
    });
    return () => { ++epoch.current; };
  }, [client]);

  async function run(action: "refresh" | "choose" | "open") {
    if (busy.current) return;
    busy.current = true;
    const current = ++epoch.current;
    const active = () => epoch.current === current;
    setError(null); setOpened(false);
    setPending(action === "refresh" ? "checking" : action === "choose" ? "choosing" : "opening");
    try {
      if (action === "choose") {
        const directory = await client.chooseArtifactDirectory();
        if (!active() || directory === null) return;
        setPending("starting");
        const result = await client.start(directory);
        if (active()) setStatus(result);
      } else {
        if (action === "open") {
          await client.openWorkspace();
          if (!active()) return;
          setOpened(true);
        }
        const result = await client.status();
        if (active()) setStatus(result);
      }
    } catch (failure) {
      if (active()) setError(errorText(failure));
    } finally {
      if (active()) { busy.current = false; setPending(null); }
    }
  }

  return <section className="managed-workspace-entry" aria-label="Managed workspaces" aria-busy={pending !== null}>
    <h3>Managed workspaces</h3>
    <p>Open a separate workspace window. Its service keeps running when the window closes.</p>
    <p role="status">{pending ? pendingLabels[pending] : status ? statusLabels[status.state] : "Workspace service status could not be checked."}</p>
    {opened && <p>Workspace window opened.</p>}
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    <div className="managed-workspace-actions">
      <button type="button" disabled={pending !== null} onClick={() => { void run("choose"); }}>{status?.artifactPath ? "Change workspace runtime" : "Choose workspace runtime"}</button>
      {status && status.state !== "notConfigured" && <button type="button" disabled={pending !== null} onClick={() => { void run("open"); }}>Open workspace</button>}
      <button type="button" disabled={pending !== null} onClick={() => { void run("refresh"); }}>Refresh status</button>
    </div>
  </section>;
}
