import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Anonymous launch and update events. On by default; the choice is kept by the app. */
export function AnalyticsToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    invoke<boolean>("product_analytics_enabled").then(
      value => { if (active.current) setEnabled(value); },
      () => { if (active.current) setError("Could not read this setting."); },
    );
    return () => { active.current = false; };
  }, []);
  async function change(next: boolean) {
    if (pending) return;
    setPending(true); setError(null);
    try {
      const value = await invoke<boolean>("set_product_analytics_enabled", { enabled: next });
      if (active.current) setEnabled(value);
    } catch {
      if (active.current) setError("Could not save this setting.");
    } finally {
      if (active.current) setPending(false);
    }
  }
  return <section aria-label="Usage data" className="launcher-updates">
    <label>
      <input type="checkbox" checked={enabled === true} disabled={enabled === null || pending}
        onChange={event => { void change(event.currentTarget.checked); }} />
      {" "}Share anonymous usage data
    </label>
    <p>Sends the app version, your platform and a random install id when Blackcrab opens or updates. Never prompts, files or project names.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
