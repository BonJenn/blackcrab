import { getCurrentWindow } from "@tauri-apps/api/window";
import { CodexLiveClient, nativeCodexLiveBackend } from "./codexLive";

export type WorkspaceSettings = { cwd: string; model: string; resumeId: string; permissionMode: "default" | "readOnly"; draft: string; draftTarget: string };
type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;
export const CODEX_WORKSPACE_PREFIX = "blackcrab.codexWorkspace.v1.";
const EMPTY: WorkspaceSettings = { cwd: "", model: "", resumeId: "", permissionMode: "readOnly", draft: "", draftTarget: "" };
export class CodexWorkspace {
  private value = { ...EMPTY };
  private listeners = new Set<() => void>();
  private problem: string | null = null;
  private unreadable = false;
  readonly ready: Promise<boolean>;
  constructor(readonly client: CodexLiveClient, private storage: WorkspaceStorage, readonly key: string, defaultCwd = "") {
    this.value.cwd = defaultCwd;
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (data?.version !== 1 || ![data.cwd, data.model, data.resumeId, data.draft, data.draftTarget].every(value => typeof value === "string")) throw new Error("Saved Codex workspace could not be read");
        this.value = { ...this.value, cwd: data.cwd as string, model: data.model as string, resumeId: data.resumeId as string, draft: data.draft as string, draftTarget: data.draftTarget as string };
      }
    } catch (error) { this.unreadable = true; this.problem = `${String(error)}. Existing saved data will be preserved until you explicitly reset it.`; }
    this.ready = client.inspect();
  }
  state = () => this.value;
  error = () => this.problem;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private emit() { this.listeners.forEach(callback => callback()); }
  update(patch: Partial<WorkspaceSettings>): void {
    this.value = { ...this.value, ...patch };
    // Preserve an unreadable record until explicit reset; keep new input in memory.
    if (!this.unreadable) this.save();
    this.emit();
  }
  private save() {
    try {
      // Permission mode deliberately resets to read-only on app reload.
      const { permissionMode: _permissionMode, ...saved } = this.value;
      this.storage.setItem(this.key, JSON.stringify({ version: 1, ...saved }));
      this.problem = null;
    } catch (error) { this.problem = `Draft/preferences are only in memory: ${String(error)}`; }
  }
  resetSaved(confirmed: boolean): boolean {
    if (!confirmed) return false;
    this.unreadable = false; this.problem = null; this.save(); this.emit(); return this.problem === null;
  }
  chooseTarget(cwd: string, resumeId: string, model = ""): boolean {
    if (this.value.draft && this.value.draftTarget !== resumeId) return false;
    this.update({ cwd, resumeId, model, draftTarget: resumeId }); return true;
  }
  clearAccepted(text: string, target: string) {
    if (this.value.draft === text && this.value.draftTarget === target) this.update({ draft: "" });
  }
}
let workspace: CodexWorkspace | undefined;
export function desktopCodexWorkspace(defaultCwd: string): CodexWorkspace {
  if (workspace) return workspace;
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Codex conversations require the desktop app");
  const label = getCurrentWindow().label;
  const client = new CodexLiveClient(`codex-${label}`, nativeCodexLiveBackend, localStorage);
  workspace = new CodexWorkspace(client, localStorage, CODEX_WORKSPACE_PREFIX + label, defaultCwd);
  return workspace;
}
