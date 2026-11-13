import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type UpdateState = {
  status: string; currentVersion: string; availableVersion: string | null;
  downloadPercent: number | null; downloadedBytes: number; totalBytes: number | null;
  installing: boolean; message: string | null;
};
type Reply = { accepted: boolean; state: UpdateState };
const request = (action: string, expectedVersion: string | null = null) =>
  invoke<Reply>("managed_update", { request: { action, expectedVersion } });

export function AppUpdates({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(true), submitting = useRef(false);
  const busy = pending || state?.installing === true || ["checking", "downloading"].includes(state?.status ?? "");
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    active.current = true;
    let stop: (() => void) | undefined;
    const refresh = async () => {
      try { const result = await request("status"); if (active.current) { setState(result.state); setError(null); } }
      catch { if (active.current) setError("Could not contact the updater. Reopen Blackcrab and try again."); }
    };
    void listen<UpdateState>("blackcrab-update-state", event => { if (active.current) setState(event.payload); })
      .then(unlisten => { if (active.current) stop = unlisten; else unlisten(); }, () => {});
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1000);
    return () => { active.current = false; clearInterval(timer); stop?.(); };
  }, []);
  async function run(action: string) {
    if (submitting.current || busy) return;
    submitting.current = true; setPending(true); setError(null);
    try {
      const result = await request(action, action === "install" ? state?.availableVersion : null);
      if (active.current) { setState(result.state); if (!result.accepted) setError("An update is already in progress or is not ready yet."); }
    } catch { if (active.current) setError("The update could not be completed. Try again shortly."); }
    finally { submitting.current = false; if (active.current) setPending(false); }
  }
  const downloading = state?.status === "downloading";
  const progress = downloading ? state.downloadPercent : null;
  const message = state?.installing ? "Installing Blackcrab… The app will restart when it is ready." :
    state?.message ?? (state?.status === "available" ? `Blackcrab ${state.availableVersion} is available.` :
    state?.status === "up-to-date" ? "Blackcrab is up to date." : state?.status === "checking" ? "Checking for updates…" : null);
  return <section aria-label="App updates" className="launcher-updates">
    <p>Blackcrab{state ? ` ${state.currentVersion}` : ""}</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {(downloading || state?.installing) && <div className="launcher-update-progress" role="status">
      <label htmlFor="blackcrab-update-progress">{state?.installing ? "Installing update…" : `Downloading update${progress === null ? "…" : `… ${Math.floor(progress)}%`}`}</label>
      <progress id="blackcrab-update-progress" max={100} value={progress ?? undefined} />
    </div>}
    <button disabled={busy} onClick={() => { void run("check"); }}>Check for updates</button>
    {state?.status === "available" && <button disabled={busy} onClick={() => { void run("download"); }}>Download update</button>}
    {state?.status === "downloaded" && <button disabled={busy} onClick={() => { void run("install"); }}>Install update and restart</button>}
  </section>;
}
