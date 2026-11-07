import { expect, it, vi } from "vitest";
import { CodexWorkspace } from "./codexWorkspace";
import { CodexLiveClient } from "./codexLive";
function fixture(raw: string | null = null) {
  let saved = raw;
  const storage = { getItem: vi.fn(() => saved), setItem: vi.fn((_key: string, value: string) => { saved = value; }) };
  const client = { inspect: vi.fn(async () => true) } as unknown as CodexLiveClient;
  return { storage, client, workspace: new CodexWorkspace(client, storage, "key", "/default"), saved: () => saved };
}
it("persists drafts and target identity while resetting permissions to read-only on reload", () => {
  const f = fixture();
  f.workspace.update({ cwd: "/project", resumeId: "native", draftTarget: "native", draft: "unsent", permissionMode: "default" });
  const restored = fixture(f.saved());
  expect(restored.workspace.state()).toMatchObject({ cwd: "/project", resumeId: "native", draft: "unsent", draftTarget: "native", permissionMode: "readOnly" });
});
it("does not transfer a draft to another thread or erase a newer draft after acceptance", () => {
  const f = fixture(); f.workspace.update({ resumeId: "original", draftTarget: "original", draft: "draft" });
  expect(f.workspace.chooseTarget("/other", "other")).toBe(false);
  f.workspace.clearAccepted("different", "original"); expect(f.workspace.state().draft).toBe("draft");
  f.workspace.clearAccepted("draft", "other"); expect(f.workspace.state().draft).toBe("draft");
  f.workspace.clearAccepted("draft", "original"); expect(f.workspace.state().draft).toBe("");
  expect(f.workspace.chooseTarget("/other", "other")).toBe(true);
});
it("keeps unreadable saved data until explicit reset and preserves input on storage failure", () => {
  const f = fixture("corrupt");
  f.workspace.update({ draft: "in-memory" }); expect(f.saved()).toBe("corrupt");
  expect(f.workspace.resetSaved(false)).toBe(false);
  expect(f.workspace.resetSaved(true)).toBe(true);
  expect(JSON.parse(f.saved()!).draft).toBe("in-memory");
  f.storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  f.workspace.update({ draft: "still here" });
  expect(f.workspace.state().draft).toBe("still here"); expect(f.workspace.error()).toContain("only in memory");
});
