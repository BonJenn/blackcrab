import { expect, it, vi } from "vitest";
import { MobileDraftClient, type DraftStorage } from "./client";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(saved = new Map<string, string>()) {
  let next = 0;
  const storage: DraftStorage = { read: vi.fn(async key => saved.get(key) ?? null), write: vi.fn(async (key, value) => { saved.set(key, value); }) };
  const client = new MobileDraftClient(storage, () => `edit-${++next}`);
  return { client, storage, saved };
}
it("persists separate host/session drafts and restores without sending or changing identity", async () => {
  const f = fixture();
  for (const [host, session, text] of [["one", "same", "first"], ["two", "same", "second"], ["one", "other", "third"]]) {
    await f.client.open(host, session); f.client.edit(host, session, text); await f.client.retrySave(host, session);
  }
  const restored = fixture(f.saved);
  await restored.client.open("one", "same"); await restored.client.open("two", "same");
  expect(restored.client.state("one", "same").text).toBe("first");
  expect(restored.client.state("two", "same").text).toBe("second");
  expect(restored.client.state("one", "same").editId).toBe(f.client.state("one", "same").editId);
  expect(restored.storage.write).not.toHaveBeenCalled();
});
it("gates edits until delayed loading completes and preserves corrupt/foreign saved data until reviewed reset", async () => {
  const f = fixture(), loading = deferred<string | null>(); vi.mocked(f.storage.read).mockReturnValueOnce(loading.promise);
  const pending = f.client.open("one", "session"); expect(f.client.edit("one", "session", "too soon")).toBe(false);
  loading.resolve(null); await pending; expect(f.client.edit("one", "session", "ready")).toBe(true); await f.client.retrySave("one", "session");
  for (const raw of ["corrupt", JSON.stringify({ version: 1, hostId: "foreign", sessionId: "session", editId: "id", text: "protected" })]) {
    const current = fixture(new Map([[JSON.stringify(["one", "session"]), raw]])); await current.client.open("one", "session");
    expect(current.client.state("one", "session").blocked).toBe(true); expect(current.client.edit("one", "session", "overwrite")).toBe(false);
    expect(current.client.reset("one", "session", false)).toBe(false); expect(current.storage.write).not.toHaveBeenCalled();
    expect(current.saved.get(JSON.stringify(["one", "session"]))).toBe(raw);
    expect(current.client.reset("one", "session", true)).toBe(true); await current.client.retrySave("one", "session");
    expect(JSON.parse(current.saved.get(JSON.stringify(["one", "session"]))!).text).toBe("");
  }
});
it("serializes writes, coalesces newer text and ignores acceptance of an older revision even when text matches again", async () => {
  const f = fixture(), first = deferred<void>(); await f.client.open("one", "session");
  vi.mocked(f.storage.write).mockImplementationOnce(async (key, value) => { await first.promise; f.saved.set(key, value); });
  f.client.edit("one", "session", "original"); const revision = f.client.state("one", "session").revision;
  await Promise.resolve(); f.client.edit("one", "session", "newer"); f.client.edit("one", "session", "original");
  expect(f.client.clearAccepted("one", "session", "original", revision)).toBe(false);
  first.resolve(); await f.client.retrySave("one", "session");
  expect(JSON.parse(f.saved.get(JSON.stringify(["one", "session"]))!).text).toBe("original");
  expect(f.storage.write).toHaveBeenCalledTimes(2);
});
it("retains edits on write failure and retries only on explicit save or a later edit", async () => {
  const f = fixture(); await f.client.open("one", "session"); vi.mocked(f.storage.write).mockRejectedValueOnce(new Error("full"));
  f.client.edit("one", "session", "unsaved"); await f.client.retrySave("one", "session");
  expect(f.client.state("one", "session")).toMatchObject({ text: "unsaved", saving: false, savedRevision: 0 });
  expect(f.client.state("one", "session").error).toContain("only in memory");
  await f.client.retrySave("one", "session"); expect(f.client.state("one", "session").error).toBeNull();
  expect(JSON.parse(f.saved.get(JSON.stringify(["one", "session"]))!).text).toBe("unsaved");
});
it("settles only an explicit original draft identity after restart and durably preserves later edits", async () => {
  const f = fixture(); await f.client.open("one", "session"); f.client.edit("one", "session", "original"); await f.client.retrySave("one", "session");
  const transfer = { editId: f.client.state("one", "session").editId, text: "original" };
  const restored = fixture(f.saved);
  expect(await restored.client.confirmTransfer("one", "session", transfer)).toBe(true);
  expect(restored.client.state("one", "session").text).toBe("");
  restored.client.edit("one", "session", "original"); await restored.client.retrySave("one", "session");
  expect(await restored.client.confirmTransfer("one", "session", transfer)).toBe(true);
  expect(restored.client.state("one", "session").text).toBe("original");
});
it("does not settle a transfer until local draft writes succeed", async () => {
  const f = fixture(); await f.client.open("one", "session"); f.client.edit("one", "session", "original"); await f.client.retrySave("one", "session");
  const transfer = { editId: f.client.state("one", "session").editId, text: "original" };
  vi.mocked(f.storage.write).mockRejectedValueOnce(new Error("full"));
  expect(await f.client.confirmTransfer("one", "session", transfer)).toBe(false);
  expect(JSON.parse(f.saved.get(JSON.stringify(["one", "session"]))!).text).toBe("original");
  expect(await f.client.confirmTransfer("one", "session", transfer)).toBe(true);
  expect(JSON.parse(f.saved.get(JSON.stringify(["one", "session"]))!).text).toBe("");
});
it("can retry a failed read without overwriting its source", async () => {
  const f = fixture(); vi.mocked(f.storage.read).mockRejectedValueOnce(new Error("unavailable"));
  await f.client.open("one", "session"); expect(f.client.state("one", "session").blocked).toBe(true);
  await f.client.open("one", "session"); expect(f.client.state("one", "session").blocked).toBe(false); expect(f.storage.write).not.toHaveBeenCalled();
});
