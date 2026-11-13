import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function AppUpdates({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true), pending = useRef(false), currentUpdate = useRef<Update | null>(null);
  useEffect(() => {
    active.current = true;
    void getVersion().then(v => { if (active.current) setVersion(v); }, () => {});
    return () => { active.current = false; if (!pending.current) void currentUpdate.current?.close().catch(() => {}); };
  }, []);
  async function run(install: boolean) {
    if (pending.current) return;
    pending.current = true; onBusyChange?.(true);
    setBusy(true); setMessage(install ? "Installing update…" : "Checking for updates…");
    try {
      if (install && update) { await update.downloadAndInstall(); if (active.current) await relaunch(); }
      else {
        const next = await check();
        const previous = currentUpdate.current; currentUpdate.current = next;
        await previous?.close().catch(() => {});
        if (active.current) { setUpdate(next); setMessage(next ? `Blackcrab ${next.version} is available.` : "Blackcrab is up to date."); }
      }
    } catch { if (active.current) setMessage("The update could not be completed. Try again shortly."); }
    finally {
      pending.current = false; onBusyChange?.(false);
      if (active.current) setBusy(false); else void currentUpdate.current?.close().catch(() => {});
    }
  }
  return <section aria-label="App updates" className="launcher-updates">
    <p>Blackcrab{version ? ` ${version}` : ""}</p>
    {message && <p role="status">{message}</p>}
    <button disabled={busy} onClick={() => { void run(false); }}>Check for updates</button>
    {update && <button disabled={busy} onClick={() => { void run(true); }}>Install update and restart</button>}
  </section>;
}
