export type DesktopProvider = "claude" | "codex";
export const DESKTOP_PROVIDER_KEY = "blackcrab.desktopProvider.v1";
export function readDesktopProvider(storage: Pick<Storage, "getItem">): DesktopProvider {
  try { return storage.getItem(DESKTOP_PROVIDER_KEY) === "codex" ? "codex" : "claude"; }
  catch { return "claude"; }
}
export function saveDesktopProvider(storage: Pick<Storage, "setItem">, provider: DesktopProvider): boolean {
  try { storage.setItem(DESKTOP_PROVIDER_KEY, provider); return true; }
  catch { return false; }
}
