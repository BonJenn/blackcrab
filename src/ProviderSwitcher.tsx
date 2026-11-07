import type { DesktopProvider } from "./desktopProvider";
export function ProviderSwitcher({ provider, onChange, error }: { provider: DesktopProvider; onChange: (provider: DesktopProvider) => void; error?: string | null }) {
  return <div className="desktop-provider-switcher"><label>Provider<select value={provider} onChange={event => { const value = event.target.value; if (value === "claude" || value === "codex") onChange(value); }}><option value="claude">Claude Code</option><option value="codex">Codex preview</option></select></label>{error && <p role="alert">{error}</p>}</div>;
}
