import { getCurrentWindow } from "@tauri-apps/api/window";
import { codexActivity, type CodexActivity } from "./codexActivity";
import { desktopCodexWorkspace, releaseDesktopCodexWorkspace, type CodexWorkspace } from "./codexWorkspace";

export const CODEX_DESKTOP_PREFIX = "blackcrab.codexDesktop.v1.";
export const MAX_CODEX_PANES = 6;
type Layout = "single" | "grid";
type DesktopState = { panes: string[]; selected: string; layout: Layout; error: string | null; revision: number };
type StorageBackend = Pick<Storage, "getItem" | "setItem">;
const validId = (id: unknown): id is string => typeof id === "string" && (id === "primary" || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id));

/** Window-scoped owners survive view switches. No action here starts or sends a turn. */
export class CodexDesktop {
  private value: DesktopState = { panes: ["primary"], selected: "primary", layout: "single", error: null, revision: 0 };
  private listeners = new Set<() => void>();
  private owners = new Map<string, CodexWorkspace>();
  private subscriptions = new Map<string, () => void>();
  private inspected = new Set<string>();
  private unreadable = false;
  constructor(private storage: StorageBackend, readonly key: string, private create: (id: string) => CodexWorkspace, private newId: () => string = () => crypto.randomUUID(), private release = (_id: string, owner: CodexWorkspace) => owner.client.dispose()) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.version !== 1 || !Array.isArray(saved.panes) || saved.panes.length < 1 || saved.panes.length > MAX_CODEX_PANES || saved.panes[0] !== "primary" || !saved.panes.every(validId) || new Set(saved.panes).size !== saved.panes.length || !saved.panes.includes(saved.selected) || !["single", "grid"].includes(saved.layout)) throw new Error("Saved Codex panes could not be read");
        this.value = { ...this.value, panes: saved.panes, selected: saved.selected, layout: saved.layout };
      }
    } catch (error) { this.unreadable = true; this.value.error = `${String(error)}. Saved pane data is preserved until you explicitly reset the layout.`; }
    for (const id of this.value.panes) this.workspace(id);
  }
  state = () => this.value;
  layoutBlocked = () => this.unreadable;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private emit() { this.value = { ...this.value, revision: this.value.revision + 1 }; this.listeners.forEach(callback => callback()); }
  workspace(id: string): CodexWorkspace {
    if (!this.value.panes.includes(id)) throw new Error("Unknown Codex pane");
    const existing = this.owners.get(id);
    if (existing) return existing;
    const owner = this.create(id);
    this.owners.set(id, owner);
    const offClient = owner.client.subscribe(() => this.emit());
    const offWorkspace = owner.subscribe(() => this.emit());
    this.subscriptions.set(id, () => { offClient(); offWorkspace(); });
    void owner.ready.then(ok => { if (ok) this.inspected.add(id); this.emit(); }, () => this.emit());
    return owner;
  }
  activity(id: string) { return codexActivity(this.workspace(id).client.state()); }
  activitySummary(): CodexActivity {
    const all = this.value.panes.map(id => this.activity(id));
    return (["approval", "confirmation", "detached", "running"] as const).find(value => all.includes(value)) ?? "idle";
  }
  private save(next: DesktopState, reset = false): boolean {
    if (this.unreadable && !reset) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify({ version: 1, panes: next.panes, selected: next.selected, layout: next.layout }));
      this.unreadable = false; this.value = { ...next, error: null }; this.emit(); return true;
    } catch (error) { this.value = { ...this.value, error: `Could not save Codex panes: ${String(error)}. The previous layout is retained.` }; this.emit(); return false; }
  }
  select(id: string): boolean { return this.value.panes.includes(id) && this.save({ ...this.value, selected: id }); }
  layout(layout: Layout): boolean { return this.save({ ...this.value, layout }); }
  add(): string | null {
    if (this.unreadable || this.value.panes.length >= MAX_CODEX_PANES) return null;
    const id = this.newId();
    if (!validId(id) || this.owners.has(id)) return null;
    if (!this.save({ ...this.value, panes: [...this.value.panes, id], selected: id })) return null;
    this.workspace(id); this.emit(); return id;
  }
  removalProblem(id: string): string | null {
    if (id === "primary") return "The original conversation is retained.";
    if (this.unreadable) return "Review the saved layout before removing panes.";
    const owner = this.workspace(id), state = owner.client.state();
    if (!this.inspected.has(id) && !(state.phase === "stopped" && state.context?.processFinished)) return "Wait for the pane's session inspection to finish successfully.";
    if (!["idle", "stopped"].includes(state.phase) || state.operation || state.sending) return "Stop the session before removing this pane.";
    if (state.pending || state.recoveryBlocked) return "Resolve message recovery before removing this pane.";
    if (owner.state().resumeId && owner.state().resumeId !== state.context?.providerSessionId) return "Resume the selected session and review its queue before removing this pane.";
    if (state.context && !state.queue) return "Refresh queue state before removing this pane.";
    if (state.queue?.items.length) return "Review and remove queued messages before removing this pane.";
    if (owner.state().draft) return "Save or clear the unsent draft before removing this pane.";
    if (owner.error()) return "Resolve saved workspace errors before removing this pane.";
    return null;
  }
  remove(id: string): boolean {
    if (!this.value.panes.includes(id) || this.removalProblem(id)) return false;
    const panes = this.value.panes.filter(value => value !== id);
    // Saved workspace and receipt data are retained. Removing a pane is not deletion.
    if (!this.save({ ...this.value, panes, selected: this.value.selected === id ? panes[0] : this.value.selected })) return false;
    this.subscriptions.get(id)?.(); this.subscriptions.delete(id);
    const owner = this.owners.get(id)!;
    this.owners.delete(id); this.inspected.delete(id); this.release(id, owner);
    return true;
  }
  resetLayout(reviewed: boolean): boolean { return reviewed && this.save(this.value, true); }
}
let desktop: CodexDesktop | undefined;
export function desktopCodexPanes(defaultCwd: string): CodexDesktop {
  if (desktop) return desktop;
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Codex conversations require the desktop app");
  desktop = new CodexDesktop(localStorage, CODEX_DESKTOP_PREFIX + getCurrentWindow().label, id => desktopCodexWorkspace(defaultCwd, id), () => crypto.randomUUID(), releaseDesktopCodexWorkspace);
  return desktop;
}
