import { expect, it, vi } from "vitest";
import { CodexDesktop, MAX_CODEX_PANES, MAX_SAVED_CODEX_PANES } from "./codexDesktop";
import { CodexWorkspace } from "./codexWorkspace";
import type { CodexLiveClient, CodexLiveState } from "./codexLive";

function fixture(raw?: string, existing?: Map<string, string>) {
  const saved = existing ?? new Map<string, string>(raw ? [["desktop", raw]] : []);
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { saved.set(key, value); }) };
  const owners = new Map<string, ReturnType<typeof owner>>();
  let counter = 0;
  const id = () => `00000000-0000-0000-0000-${String(++counter).padStart(12, "0")}`;
  function owner(name: string) {
    let current = { phase: "idle", approvals: [], busy: false, operation: null, pending: null, sending: false, queue: null, recoveryBlocked: false } as unknown as CodexLiveState;
    const listeners = new Set<() => void>();
    const client = { state: () => current, subscribe: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; }, inspect: vi.fn(async () => true), dispose: vi.fn() } as unknown as CodexLiveClient;
    const workspace = new CodexWorkspace(client, storage, `workspace-${name}`, "/fixture");
    return { workspace, client, update: (patch: Partial<CodexLiveState>) => { current = { ...current, ...patch }; listeners.forEach(callback => callback()); } };
  }
  const desktop = new CodexDesktop(storage, "desktop", name => { const value = owner(name); owners.set(name, value); return value.workspace; }, id);
  return { desktop, storage, saved, owners };
}
it("restores pane identities, selected view and separate drafts without starting or replacing owners", async () => {
  const f = fixture(); await f.desktop.workspace("primary").ready;
  const id = f.desktop.add()!; await f.desktop.workspace(id).ready;
  f.desktop.workspace("primary").update({ draft: "first", draftTarget: "thread-one" });
  f.desktop.workspace(id).update({ draft: "second", draftTarget: "thread-two" });
  expect(f.desktop.layout("grid")).toBe(true);
  const owner = f.desktop.workspace(id);
  f.desktop.select("primary"); f.desktop.select(id);
  expect(f.desktop.workspace(id)).toBe(owner);
  expect(f.desktop.workspace("primary").state().draft).toBe("first");
  expect(owner.state().draft).toBe("second");
  const restored = fixture(f.saved.get("desktop"));
  expect(restored.desktop.state()).toMatchObject({ panes: ["primary", id], selected: id, layout: "grid" });
  expect(f.owners.size).toBe(2);
  const reloaded = new CodexDesktop(f.storage, "desktop", name => new CodexWorkspace(f.owners.get(name)!.client, f.storage, `workspace-${name}`, "/default"));
  expect(reloaded.workspace("primary").state().draft).toBe("first");
  expect(reloaded.workspace(id).state().draft).toBe("second");
});
it("never replaces a pane at capacity", () => {
  const f = fixture();
  for (let i = 1; i < MAX_CODEX_PANES; i++) expect(f.desktop.add()).not.toBeNull();
  const before = f.desktop.state().panes;
  expect(f.desktop.add()).toBeNull(); expect(f.desktop.state().panes).toEqual(before);
  expect(f.owners.size).toBe(MAX_CODEX_PANES);
});
it("blocks removing owners with live work, recovery, held queues, drafts or unreadable preferences", async () => {
  const f = fixture(), id = f.desktop.add()!;
  expect(f.desktop.remove(id)).toBe(false); // Inspection is still in flight.
  await f.desktop.workspace(id).ready;
  const owner = f.owners.get(id)!;
  for (const phase of ["live", "starting", "detached", "stopping"] as const) {
    owner.update({ phase }); expect(f.desktop.remove(id)).toBe(false);
  }
  owner.update({ phase: "stopped", recoveryBlocked: true }); expect(f.desktop.remove(id)).toBe(false);
  owner.update({ recoveryBlocked: false, queue: { threadId: "thread", revision: 1, paused: true, items: [{ commandId: "later", turnId: "later-turn", text: "held", createdAtMs: 1, updatedAtMs: 1 }] } as CodexLiveState["queue"] });
  expect(f.desktop.remove(id)).toBe(false);
  owner.update({ queue: null }); owner.workspace.update({ draft: "unsent" }); expect(f.desktop.remove(id)).toBe(false);
  owner.workspace.update({ draft: "" });
  expect(f.desktop.remove("primary")).toBe(false);
  const retained = f.saved.get(`workspace-${id}`);
  expect(f.desktop.remove(id)).toBe(true);
  expect(f.desktop.state().selected).toBe("primary");
  expect(f.saved.get(`workspace-${id}`)).toBe(retained);
  expect(owner.client.dispose).toHaveBeenCalledOnce();
});
it("aggregates hidden-pane attention and publishes new snapshots on owner changes", async () => {
  const f = fixture(), id = f.desktop.add()!; await f.desktop.workspace(id).ready;
  f.desktop.select("primary"); const before = f.desktop.state();
  f.owners.get(id)!.update({ approvals: [{ id: "approval" }] as CodexLiveState["approvals"] });
  expect(f.desktop.activitySummary()).toBe("approval");
  expect(f.desktop.state()).not.toBe(before);
  f.owners.get(id)!.update({ approvals: [], phase: "detached" }); expect(f.desktop.activitySummary()).toBe("detached");
});
it("requires queue evidence for restored sessions and retains failed-removal owners", async () => {
  const f = fixture(), id = f.desktop.add()!; await f.desktop.workspace(id).ready;
  const owner = f.owners.get(id)!;
  owner.workspace.update({ resumeId: "saved-native" });
  expect(f.desktop.removalProblem(id)).toContain("Resume the selected session");
  owner.update({ phase: "stopped", context: { provider: "codex", providerSessionId: "saved-native", threadId: "journal", runId: "run", processFinished: true } });
  expect(f.desktop.removalProblem(id)).toContain("Refresh queue");
  owner.update({ queue: { threadId: "journal", revision: 1, paused: true, items: [] } });
  f.storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  expect(f.desktop.remove(id)).toBe(false);
  expect(owner.client.dispose).not.toHaveBeenCalled();
  expect(f.desktop.workspace(id)).toBe(owner.workspace);
});
it("preserves corrupt layouts until reviewed reset and rejects unsaved additions", () => {
  for (const raw of ["broken", JSON.stringify({ version: 1, panes: ["primary", "primary"], selected: "primary", layout: "grid" }), JSON.stringify({ version: 1, panes: ["primary", "../foreign"], selected: "primary", layout: "grid" })]) {
    const f = fixture(raw); expect(f.desktop.state().error).toContain("preserved");
    expect(f.desktop.add()).toBeNull(); expect(f.desktop.select("primary")).toBe(false);
    expect(f.saved.get("desktop")).toBe(raw);
    expect(f.desktop.resetLayout(false)).toBe(false); expect(f.desktop.resetLayout(true)).toBe(true);
    expect(f.desktop.add()).not.toBeNull();
  }
  const f = fixture(); f.storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  expect(f.desktop.add()).toBeNull(); expect(f.desktop.state().panes).toEqual(["primary"]);
  expect(f.owners.size).toBe(2); expect([...f.owners.values()][1].client.dispose).toHaveBeenCalledOnce(); expect(f.desktop.state().error).toContain("previous layout is retained");
});
it("retains unreadable pane preferences and unresolved pending sends", async () => {
  const f = fixture(), id = "00000000-0000-0000-0000-000000000001";
  f.saved.set(`workspace-${id}`, "corrupt preferences");
  expect(f.desktop.add()).toBe(id); await f.desktop.workspace(id).ready;
  expect(f.desktop.remove(id)).toBe(false);
  expect(f.saved.get(`workspace-${id}`)).toBe("corrupt preferences");
  f.desktop.workspace(id).resetSaved(true);
  f.owners.get(id)!.update({ pending: { commandId: "unconfirmed" } as CodexLiveState["pending"] });
  expect(f.desktop.remove(id)).toBe(false);
  expect(f.desktop.removalProblem(id)).toContain("recovery");
});

it("does not rewrite layout storage when selection has not changed", () => {
  const f = fixture(), id = f.desktop.add()!;
  f.storage.setItem.mockClear(); const unchanged = f.desktop.state();
  expect(f.desktop.select(id)).toBe(true); expect(f.desktop.select(id)).toBe(true);
  expect(f.storage.setItem).not.toHaveBeenCalled(); expect(f.desktop.state()).toBe(unchanged);
  expect(f.desktop.select("primary")).toBe(true); expect(f.desktop.select("primary")).toBe(true);
  expect(f.storage.setItem).toHaveBeenCalledOnce();
  expect(f.desktop.select("missing")).toBe(false); expect(f.storage.setItem).toHaveBeenCalledOnce();
});

it("retains removed addresses across reload and reopens the original saved workspace without replay", async () => {
  const f = fixture(), id = f.desktop.add()!;
  await f.desktop.workspace(id).ready;
  f.desktop.workspace(id).update({ cwd: "/retained", model: "saved-model" });
  const savedWorkspace = f.saved.get(`workspace-${id}`);
  f.saved.set(`outbox-${id}`, "unconfirmed identity remains untouched");
  expect(f.desktop.remove(id)).toBe(true);
  expect(f.desktop.state().retained).toEqual([id]);
  expect(JSON.parse(f.saved.get("desktop")!)).toMatchObject({ version: 3, retained: [id] });
  const restored = fixture(undefined, f.saved);
  expect(restored.owners.size).toBe(1); // Retained owners are not inspected on startup.
  expect(restored.desktop.reopen(id)).toBe(true);
  expect(restored.desktop.state()).toMatchObject({ panes: ["primary", id], selected: id, retained: [] });
  expect(restored.desktop.workspace(id).state()).toMatchObject({ cwd: "/retained", model: "saved-model" });
  expect(restored.owners.get(id)!.client.inspect).toHaveBeenCalledOnce();
  expect(restored.saved.get(`workspace-${id}`)).toBe(savedWorkspace);
  expect(restored.saved.get(`outbox-${id}`)).toBe("unconfirmed identity remains untouched");
  expect(restored.desktop.reopen(id)).toBe(false);
  expect(restored.desktop.reopen("../foreign")).toBe(false);
});
it("bounds known addresses without evicting recovery and allows reuse at the limit", async () => {
  const f = fixture();
  for (let i = 1; i < MAX_SAVED_CODEX_PANES; i++) {
    const id = f.desktop.add()!; expect(id).not.toBeNull();
    await f.desktop.workspace(id).ready; expect(f.desktop.remove(id)).toBe(true);
  }
  const retained = [...f.desktop.state().retained];
  expect(f.desktop.add()).toBeNull(); expect(f.desktop.state().retained).toEqual(retained);
  for (const id of retained.slice(0, MAX_CODEX_PANES - 1)) expect(f.desktop.reopen(id)).toBe(true);
  expect(f.desktop.reopen(retained[MAX_CODEX_PANES - 1])).toBe(false);
  const id = retained[0]; await f.desktop.workspace(id).ready;
  expect(f.desktop.remove(id)).toBe(true);
  expect(f.desktop.reopen(retained[MAX_CODEX_PANES - 1])).toBe(true);
});
it("preserves malformed retained lists until explicit reviewed reset", () => {
  const id = "v2:00000000-0000-0000-0000-000000000001";
  for (const retained of [null, ["primary"], [id, id], ["foreign"], [id]]) {
    const panes = retained?.[0] === id && retained.length === 1 ? ["primary", id] : ["primary"];
    const raw = JSON.stringify({ version: 2, panes, retained, selected: "primary", layout: "single" });
    const f = fixture(raw);
    expect(f.desktop.layoutBlocked()).toBe(true);
    expect(f.desktop.reopen(id)).toBe(false); expect(f.saved.get("desktop")).toBe(raw);
    expect(f.desktop.resetLayout(false)).toBe(false); expect(f.saved.get("desktop")).toBe(raw);
    expect(f.desktop.resetLayout(true)).toBe(true);
  }
});
it("preserves a retained address when construction or saving fails", async () => {
  const f = fixture(), id = f.desktop.add()!; await f.desktop.workspace(id).ready;
  expect(f.desktop.remove(id)).toBe(true);
  const saved = f.saved.get("desktop");
  const failed = new CodexDesktop(f.storage, "desktop", name => {
    if (name === id) throw new Error("inspection setup failed");
    return f.desktop.workspace("primary");
  });
  expect(failed.reopen(id)).toBe(false); expect(f.saved.get("desktop")).toBe(saved);
  expect(failed.state().retained).toEqual([id]);
  f.storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  expect(f.desktop.reopen(id)).toBe(false); expect(f.saved.get("desktop")).toBe(saved);
  expect(f.desktop.state().retained).toEqual([id]);
  expect(f.owners.get(id)!.client.dispose).toHaveBeenCalledOnce();
  expect(f.desktop.reopen(id)).toBe(true);
});
it("does not let a retired inspection mark a reopened pane ready", async () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const id = "v2:00000000-0000-0000-0000-000000000001";
  const resolves: Array<(ok: boolean) => void> = [];
  let extraCount = 0;
  const desktop = new CodexDesktop(storage, "desktop", name => {
    const old = name === id && extraCount++ === 0;
    const client = {
      state: () => ({ phase: old ? "stopped" : "idle", context: old ? { processFinished: true } : null, queue: old ? { items: [] } : null }),
      subscribe: () => () => {}, dispose: vi.fn(),
      inspect: () => name === "primary" ? Promise.resolve(true) : new Promise<boolean>(resolve => resolves.push(resolve)),
    } as unknown as CodexLiveClient;
    return new CodexWorkspace(client, storage, `workspace-${name}`);
  }, () => id);
  desktop.add(); expect(desktop.remove(id)).toBe(true); expect(desktop.reopen(id)).toBe(true);
  resolves[0](true); await Promise.resolve(); await Promise.resolve();
  expect(desktop.removalProblem(id)).toContain("inspection");
  resolves[1](true); await desktop.workspace(id).ready;
  expect(desktop.removalProblem(id)).toBeNull();
});

it("restores bounded pane sizes without replacing owners, drafts or retained identities", async () => {
  const f = fixture(), id = f.desktop.add()!; await f.desktop.workspace(id).ready;
  const owner = f.desktop.workspace(id); owner.update({ draft: "keep this draft" });
  expect(f.desktop.resize({ column: 65, rows: [0.7, 1.3, 1] })).toBe(true);
  expect(f.desktop.workspace(id)).toBe(owner); expect(owner.state().draft).toBe("keep this draft");
  f.desktop.layout("grid"); f.desktop.layout("single"); f.desktop.layout("grid");
  const restored = fixture(undefined, f.saved);
  expect(restored.desktop.state()).toMatchObject({ panes: ["primary", id], selected: id, layout: "grid", sizes: { column: 65, rows: [0.7, 1.3, 1] } });
  expect(restored.desktop.workspace(id).state().draft).toBe("keep this draft");
  expect(f.desktop.equalize()).toBe(true); expect(f.desktop.state().sizes).toEqual({ column: 50, rows: [1, 1, 1] });
});
it("loads old equal grids without rewriting and preserves invalid saved sizes until reviewed reset", () => {
  for (const version of [1, 2]) {
    const raw = JSON.stringify({ version, panes: ["primary"], retained: [], selected: "primary", layout: "grid" });
    const f = fixture(raw); expect(f.desktop.state().sizes).toEqual({ column: 50, rows: [1, 1, 1] });
    expect(f.saved.get("desktop")).toBe(raw); expect(f.storage.setItem).not.toHaveBeenCalled();
  }
  for (const sizes of [null, { column: 10, rows: [1, 1, 1] }, { column: 50, rows: [1, 1] }, { column: 50, rows: [0.1, 1.9, 1] }, { column: 50, rows: [1, 1, 2] }]) {
    const raw = JSON.stringify({ version: 3, panes: ["primary"], retained: [], selected: "primary", layout: "grid", sizes });
    const f = fixture(raw); expect(f.desktop.layoutBlocked()).toBe(true);
    expect(f.desktop.equalize()).toBe(false); expect(f.saved.get("desktop")).toBe(raw);
    expect(f.desktop.resetLayout(true)).toBe(true); expect(f.desktop.state().sizes).toEqual({ column: 50, rows: [1, 1, 1] });
  }
});
it("rejects invalid resizing and rolls back failed size persistence", () => {
  const f = fixture();
  expect(f.desktop.resize({ column: NaN, rows: [1, 1, 1] })).toBe(false);
  expect(f.desktop.resize({ column: 50, rows: [Infinity, 1, 1] })).toBe(false);
  f.storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  expect(f.desktop.resize({ column: 60, rows: [1, 1, 1] })).toBe(false);
  expect(f.desktop.state().sizes.column).toBe(50); expect(f.desktop.state().error).toContain("previous layout is retained");
});
