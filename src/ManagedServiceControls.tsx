import { useEffect, useRef, useState } from "react";
import { managedServiceClient, type ManagedServiceClient, type ServiceAction, type ServiceState, type ServiceStatus } from "./managedServiceClient";
import "./ManagedWorkspaceEntry.css";
const labels: Record<ServiceState, string> = {
  notAvailable: "Background service is unavailable in this installation.",
  notConfigured: "Enable a background service to keep agents available when workspace windows close.",
  direct: "This workspace currently uses direct startup.",
  notInstalled: "The background service is prepared and can be installed.",
  stopped: "The background service is stopped.", starting: "The background service is starting. Refresh its status to check readiness.",
  running: "The background service is running.", unavailable: "Background service status is unavailable.",
};
type Operation = ServiceAction | "initialize" | "refresh";
const pendingLabels: Record<Operation, string> = {
  initialize: "Enabling background service…", install: "Installing background service…", start: "Starting background service…",
  stop: "Stopping background service…", restart: "Restarting background service…", uninstall: "Uninstalling background service…", refresh: "Checking background service…",
};
const message = (error: unknown) => error instanceof Error ? error.message : typeof error === "string" ? error : "Background-service request failed.";
export function ManagedServiceControls({ client = managedServiceClient }: { client?: ManagedServiceClient }) {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [pending, setPending] = useState<Operation | null>("refresh");
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0), busy = useRef(true);
  useEffect(() => {
    const current = ++epoch.current;
    busy.current = true; setStatus(null); setPending("refresh"); setError(null);
    void client.status().then(result => { if (epoch.current === current) setStatus(result); },
      failure => { if (epoch.current === current) setError(message(failure)); })
      .finally(() => { if (epoch.current === current) { busy.current = false; setPending(null); } });
    return () => { ++epoch.current; };
  }, [client]);
  async function run(operation: Operation) {
    if (busy.current) return;
    busy.current = true; const current = ++epoch.current; const active = () => epoch.current === current;
    setError(null); setPending(operation);
    try {
      const result = await (operation === "refresh" ? client.status() : operation === "initialize" ? client.initialize() : client.perform(operation));
      if (active()) setStatus(result);
    } catch (failure) {
      if (active()) {
        setError(message(failure));
        // Setup can leave a prepared owner after installation fails. Read its
        // real state instead of offering another initialization over existing data.
        try { const result = await client.status(); if (active()) setStatus(result); } catch { /* Preserve the actionable operation error. */ }
      }
    } finally { if (active()) { busy.current = false; setPending(null); } }
  }
  if (status?.state === "notAvailable") return null;
  const disabled = pending !== null;
  return <section className="managed-workspace-entry" aria-label="Background service" aria-busy={disabled}>
    <h3>Background service</h3>
    <p role="status">{pending ? pendingLabels[pending] : status ? labels[status.state] : "Background service status could not be checked."}</p>
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    <div className="managed-workspace-actions">
      {status?.canInitialize && <button type="button" disabled={disabled} onClick={() => { void run("initialize"); }}>Enable background service</button>}
      {status?.state === "notInstalled" && <button type="button" disabled={disabled} onClick={() => { void run("install"); }}>Install background service</button>}
      {status?.installed && !status.loaded && <button type="button" disabled={disabled} onClick={() => { void run("start"); }}>Start background service</button>}
      {status?.loaded && <><button type="button" disabled={disabled} onClick={() => { void run("stop"); }}>Stop background service</button><button type="button" disabled={disabled} onClick={() => { void run("restart"); }}>Restart background service</button></>}
      {status?.installed && <button type="button" disabled={disabled} onClick={() => { void run("uninstall"); }}>Uninstall background service</button>}
      <button type="button" disabled={disabled} onClick={() => { void run("refresh"); }}>Refresh service status</button>
    </div>
    {status?.installed && <p>Uninstalling the service keeps workspace history and settings.</p>}
  </section>;
}
