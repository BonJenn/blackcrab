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
// Legacy UUID pane addresses stay intact: changing them could orphan a live
// runtime or a saved unconfirmed send. New panes use a disjoint address scheme.
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const PANE_ID = new RegExp(`^(?:v2:)?${UUID}$`);
const LEGACY_EXTRA_SUFFIX = new RegExp(`\\.${UUID}$`);
export function isCodexPaneId(value: unknown): value is string { return typeof value === "string" && (value === "primary" || PANE_ID.test(value)); }
export function newCodexPaneId(): string { return `v2:${crypto.randomUUID()}`; }
export const CODEX_WORKSPACE_V2_PREFIX = "blackcrab.codexWorkspace.v2.";
const workspaces = new Map<string, Map<string, CodexWorkspace>>();
export function desktopCodexWorkspace(defaultCwd: string, pane = "primary", windowLabel?: string): CodexWorkspace {
  if (!isCodexPaneId(pane)) throw new Error("Invalid Codex pane identity");
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Codex conversations require the desktop app");
  const label = windowLabel ?? getCurrentWindow().label;
  // A primary label ending in .UUID would alias another window's retained
  // legacy extra pane. Do not inspect, replace or rewrite that ambiguous owner.
  if (pane === "primary" && LEGACY_EXTRA_SUFFIX.test(label)) throw new Error("This window label conflicts with a legacy Codex pane address. Use a different window label; saved workspace and recovery data were preserved.");
  const existing = workspaces.get(label)?.get(pane);
  if (existing) return existing;
  const suffix = pane === "primary" ? label : `${label}.${pane}`;
  const address = JSON.stringify([label, pane]);
  const versioned = pane.startsWith("v2:");
  const client = new CodexLiveClient(versioned ? `codex:pane:v2:${address}` : `codex-${suffix}`, nativeCodexLiveBackend, localStorage);
  const workspace = new CodexWorkspace(client, localStorage, versioned ? CODEX_WORKSPACE_V2_PREFIX + address : CODEX_WORKSPACE_PREFIX + suffix, defaultCwd);
  let byPane = workspaces.get(label);
  if (!byPane) { byPane = new Map(); workspaces.set(label, byPane); }
  byPane.set(pane, workspace);
  return workspace;
}
export function releaseDesktopCodexWorkspace(pane: string, workspace: CodexWorkspace) {
  if (pane === "primary") return;
  for (const byPane of workspaces.values()) {
    if (byPane.get(pane) !== workspace) continue;
    byPane.delete(pane); workspace.client.dispose(); return;
  }
}
