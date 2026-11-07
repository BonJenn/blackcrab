export interface DraftStorage { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void>; }
export type MobileDraftState = { text: string; loaded: boolean; saving: boolean; blocked: boolean; error: string | null; revision: number; savedRevision: number; editId: string };
type Draft = { hostId: string; sessionId: string; state: MobileDraftState; listeners: Set<() => void>; opening: Promise<void> | null; writing: Promise<void> | null };
const MAX_TEXT = 1048576;
export class MobileDraftClient {
  private drafts = new Map<string, Draft>();
  constructor(private storage: DraftStorage, private id: () => string) {}
  private key(hostId: string, sessionId: string) { return JSON.stringify([hostId, sessionId]); }
  private draft(hostId: string, sessionId: string) {
    const key = this.key(hostId, sessionId);
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = { hostId, sessionId, state: { text: "", loaded: false, saving: false, blocked: false, error: null, revision: 0, savedRevision: 0, editId: "" }, listeners: new Set(), opening: null, writing: null };
      this.drafts.set(key, draft);
    }
    return draft;
  }
  state(hostId: string, sessionId: string) { return this.draft(hostId, sessionId).state; }
  subscribe(hostId: string, sessionId: string, callback: () => void) { const draft = this.draft(hostId, sessionId); draft.listeners.add(callback); return () => { draft.listeners.delete(callback); }; }
  private update(draft: Draft, patch: Partial<MobileDraftState>) { draft.state = { ...draft.state, ...patch }; draft.listeners.forEach(callback => callback()); }
  open(hostId: string, sessionId: string): Promise<void> {
    const draft = this.draft(hostId, sessionId);
    if (draft.opening) return draft.opening;
    if (draft.state.loaded && !draft.state.blocked) return Promise.resolve();
    draft.opening = Promise.resolve().then(async () => {
      try {
        const raw = await this.storage.read(this.key(hostId, sessionId));
        let text = "", editId = this.id();
        if (raw !== null) {
          const saved = JSON.parse(raw);
          if (saved?.version !== 1 || saved.hostId !== hostId || saved.sessionId !== sessionId || typeof saved.text !== "string" || saved.text.length > MAX_TEXT || typeof saved.editId !== "string" || !saved.editId) throw new Error("Invalid saved draft");
          text = saved.text; editId = saved.editId;
        }
        this.update(draft, { text, loaded: true, blocked: false, error: null, revision: 0, savedRevision: 0, editId });
      } catch {
        this.update(draft, { loaded: true, blocked: true, error: "The saved draft could not be loaded. It is preserved. Retry loading, or review it before replacing it with an empty draft." });
      } finally { draft.opening = null; }
    });
    return draft.opening;
  }
  edit(hostId: string, sessionId: string, text: string): boolean {
    const draft = this.draft(hostId, sessionId);
    if (!draft.state.loaded || draft.state.blocked || text.length > MAX_TEXT) return false;
    this.update(draft, { text, revision: draft.state.revision + 1, editId: this.id() });
    void this.save(draft); return true;
  }
  clearAccepted(hostId: string, sessionId: string, text: string, revision: number): boolean {
    const draft = this.draft(hostId, sessionId);
    if (draft.state.revision !== revision || draft.state.text !== text || draft.state.blocked) return false;
    return this.edit(hostId, sessionId, "");
  }
  /** The queue outbox must not be erased until its original draft is durably
   * cleared, or any newer edit has been safely persisted. No network action. */
  async confirmTransfer(hostId: string, sessionId: string, transfer: { editId: string; text: string }): Promise<boolean> {
    await this.open(hostId, sessionId);
    const draft = this.draft(hostId, sessionId);
    if (draft.state.blocked) return false;
    if (draft.state.editId === transfer.editId && draft.state.text === transfer.text) this.edit(hostId, sessionId, "");
    await this.save(draft);
    return !draft.state.blocked && draft.state.savedRevision === draft.state.revision;
  }
  retrySave(hostId: string, sessionId: string) { return this.save(this.draft(hostId, sessionId)); }
  reset(hostId: string, sessionId: string, reviewed: boolean): boolean {
    const draft = this.draft(hostId, sessionId);
    if (!reviewed || !draft.state.loaded || !draft.state.blocked || draft.opening) return false;
    this.update(draft, { text: "", blocked: false, revision: draft.state.revision + 1, editId: this.id() });
    void this.save(draft); return true;
  }
  private save(draft: Draft): Promise<void> {
    if (draft.writing) return draft.writing;
    if (!draft.state.loaded || draft.state.blocked) return Promise.resolve();
    draft.writing = Promise.resolve().then(async () => {
      try {
        while (draft.state.savedRevision !== draft.state.revision) {
          const { text, revision, editId } = draft.state;
          await this.storage.write(this.key(draft.hostId, draft.sessionId), JSON.stringify({ version: 1, hostId: draft.hostId, sessionId: draft.sessionId, text, editId }));
          this.update(draft, { savedRevision: revision, error: null });
        }
      } catch { this.update(draft, { error: "Draft changes are only in memory and may be lost or an older draft may reappear after restart. Retry saving before sending." }); }
      finally { draft.writing = null; this.update(draft, { saving: false }); }
    });
    this.update(draft, { saving: true });
    return draft.writing;
  }
}
