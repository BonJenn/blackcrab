import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { managedNativeDesktopClient } from "./managedNativeDesktopClient";
import { managedServiceClient } from "./managedServiceClient";
import { ManagedServiceControls } from "./ManagedServiceControls";
import { AppUpdates } from "./AppUpdates";
import { startWorkspace, type WorkspaceStartupClient } from "./workspaceStartup";
import "./App.css";

const nativeClient: WorkspaceStartupClient = {
  desktop: managedNativeDesktopClient, service: managedServiceClient,
  handoff: () => invoke("managed_launcher_handoff"),
};

/** Only startup/recovery lives in Root. The managed client is the desktop UI. */
export default function App({ client = nativeClient }: { client?: WorkspaceStartupClient }) {
  const [message, setMessage] = useState("Starting Blackcrab…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [controls, setControls] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const operations = useRef(new Set<string>());
  const serviceBusy = useCallback((value: boolean) => {
    if (value) operations.current.add("service"); else operations.current.delete("service");
    setSettingsBusy(operations.current.size > 0);
  }, []);
  const updateBusy = useCallback((value: boolean) => {
    if (value) operations.current.add("update"); else operations.current.delete("update");
    setSettingsBusy(operations.current.size > 0);
  }, []);
  const attempt = useRef<AbortController | null>(null);
  const settingsRequested = useRef(false);
  const begin = useCallback(() => {
    if (attempt.current || operations.current.size > 0) return;
    const controller = new AbortController(); attempt.current = controller;
    settingsRequested.current = false;
    setBusy(true); setError(null); setControls(false);
    void startWorkspace(client, controller.signal, setMessage).then(() => {
      if (!controller.signal.aborted) setMessage("Your workspace is open.");
    }, failure => {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Blackcrab could not open. Try again.");
        setControls(true);
      }
    }).finally(() => {
      if (attempt.current === controller) {
        attempt.current = null; setBusy(false);
        if (settingsRequested.current) { setControls(true); setMessage("Workspace settings"); }
      }
    });
  }, [client]);
  useEffect(() => {
    begin();
    let active = true;
    const stops: (() => void)[] = [];
    const subscriptions = [
      listen("blackcrab-open-workspace", begin),
      listen("blackcrab-open-settings", () => {
        settingsRequested.current = true;
        // Wait for any in-flight native mutation before offering service controls.
        attempt.current?.abort();
        setError(null);
        if (!attempt.current) { setBusy(false); setControls(true); setMessage("Workspace settings"); }
      }),
      listen("blackcrab-workspace-failed", () => {
        setBusy(false); setControls(true); setError("The workspace closed unexpectedly. Your projects are kept. Try opening it again.");
      }),
    ];
    for (const pending of subscriptions) void pending.then(stop => { if (active) stops.push(stop); else stop(); }, () => {});
    return () => { active = false; attempt.current?.abort(); attempt.current = null; for (const stop of stops) stop(); };
  }, [begin]);
  return <main className="launcher" aria-busy={busy}>
    <div className="launcher-card">
      <img src="/blackcrab.png" alt="" className="launcher-icon" />
      <h1>Blackcrab</h1>
      <p role="status">{message}</p>
      {busy && <span className="launcher-spinner" aria-hidden="true" />}
      {error && <p role="alert" className="launcher-error">{error}</p>}
      {!busy && <button className="launcher-primary" disabled={settingsBusy} onClick={begin}>{error ? "Try again" : "Return to workspace"}</button>}
      {controls && <div className="launcher-settings"><fieldset disabled={settingsBusy}><ManagedServiceControls client={client.service} onBusyChange={serviceBusy} /></fieldset><fieldset disabled={settingsBusy}><AppUpdates onBusyChange={updateBusy} /></fieldset></div>}
    </div>
  </main>;
}
