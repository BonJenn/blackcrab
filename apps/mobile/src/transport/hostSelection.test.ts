import { expect, it, vi } from "vitest";
import type { StoredPairedHost } from "../pairingStore";
import { MobileHostConnection } from "./hostConnection";
import { MobileHostSelection, parseHostSelection } from "./hostSelection";
import type { Transport } from "./types";
const host = (hostId: string) => ({ hostId, remoteToken: "token", lanHost: "host", lanPort: 123 }) as StoredPairedHost;
const saved = (hostId: string | null) => JSON.stringify({ version: 1, hostId });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(raw: string | null = null) {
  const actions = vi.fn();
  const factory = vi.fn((selected: StoredPairedHost, _reject: (reason: string) => void) => ({ status: () => ({ hostId: selected.hostId }), close: vi.fn(), sendAction: actions }) as unknown as Transport);
  const storage = { read: vi.fn(async () => raw), write: vi.fn(async (_value: string) => {}) };
  const owner = new MobileHostConnection(factory), selection = new MobileHostSelection(owner, storage);
  return { selection, owner, storage, factory, actions };
}
it("restores the explicit host over pairing order, without replaying actions", async () => {
  const f = fixture(saved("old")); await f.selection.restore([host("new"), host("old")]);
  expect(f.selection.state().hostId).toBe("old"); expect(f.actions).not.toHaveBeenCalled(); expect(f.storage.write).not.toHaveBeenCalled();
});
it("uses the legacy default only when there is no saved selection", async () => {
  const f = fixture(); await f.selection.restore([host("new"), host("old")]); expect(f.selection.state().hostId).toBe("new");
  for (const raw of [saved(null), saved("missing"), saved("unpaired"), "broken", '{"version":2,"hostId":"new"}']) {
    const f = fixture(raw); await f.selection.restore([host("new"), { hostId: "unpaired" } as StoredPairedHost]);
    expect(f.factory).not.toHaveBeenCalled(); expect(f.storage.write).not.toHaveBeenCalled();
    if (raw !== saved(null)) expect(f.selection.state().selectionError).toBeTruthy();
  }
  expect(() => parseHostSelection('{"version":1}')).toThrow();
});
it("surfaces an unreadable preference and permits explicit replacement", async () => {
  const f = fixture(); f.storage.read.mockRejectedValueOnce(new Error("private storage detail")); await f.selection.restore([host("one")]);
  expect(f.factory).not.toHaveBeenCalled(); expect(f.selection.state().selectionError).not.toContain("private storage detail");
  expect(f.selection.state().selectionRetryable).toBe(false);
  f.selection.connect(host("two")); await tick(); expect(f.storage.write).toHaveBeenLastCalledWith(saved("two")); expect(f.selection.state().selectionError).toBeNull();
});
it("does not overwrite user intent when startup storage or host loading finishes late", async () => {
  const f = fixture(), read = deferred<string | null>(); f.storage.read.mockReturnValueOnce(read.promise);
  const restoring = f.selection.restore([host("old")]); f.selection.connect(host("new")); read.resolve(saved("old")); await restoring; await tick();
  expect(f.selection.state().hostId).toBe("new"); expect(f.factory).toHaveBeenCalledOnce(); expect(f.storage.write).toHaveBeenLastCalledWith(saved("new"));
  const lateHosts = fixture(saved("old")); lateHosts.selection.disconnect(); await lateHosts.selection.restore([host("old")]);
  expect(lateHosts.factory).not.toHaveBeenCalled();
});
it("serializes selection writes and preserves disconnect on restart", async () => {
  const f = fixture(), first = deferred<void>(); f.storage.write.mockReturnValueOnce(first.promise);
  f.selection.connect(host("one")); await tick(); f.selection.connect(host("two")); f.selection.disconnect(); await tick();
  expect(f.storage.write).toHaveBeenCalledOnce(); first.resolve(); await tick();
  expect(f.storage.write.mock.calls.map(([value]) => value)).toEqual([saved("one"), saved("two"), saved(null)]);
  expect(f.selection.state()).toMatchObject({ hostId: null, savingSelection: false, selectionError: null });
  const restart = fixture(f.storage.write.mock.lastCall![0]); await restart.selection.restore([host("one"), host("two")]); expect(restart.factory).not.toHaveBeenCalled();
});
it("retains live connection on save failure and supports explicit retry", async () => {
  const f = fixture(); f.storage.write.mockRejectedValueOnce(new Error("disk")); f.selection.connect(host("one")); await tick();
  expect(f.selection.state()).toMatchObject({ hostId: "one", savingSelection: false, selectionRetryable: true });
  expect(f.selection.state().selectionError).toContain("previous startup choice");
  f.selection.retrySave(); await tick(); expect(f.storage.write).toHaveBeenLastCalledWith(saved("one")); expect(f.selection.state().selectionError).toBeNull();
});
it("failed connection attempts do not change or hide an in-flight saved selection", async () => {
  const f = fixture(), write = deferred<void>(); f.storage.write.mockReturnValueOnce(write.promise);
  f.selection.connect(host("one")); await tick(); f.factory.mockImplementationOnce(() => { throw new Error("connection"); });
  expect(f.selection.connect(host("two"))).toBe(false); write.reject(new Error("disk")); await tick();
  expect(f.selection.state()).toMatchObject({ hostId: "one", savingSelection: false, selectionRetryable: true }); expect(f.storage.write).toHaveBeenCalledOnce();
});
it("clears a forgotten selection even after rejection, but cleanup and revocation retain startup intent", async () => {
  const f = fixture(saved("one")); await f.selection.restore([host("one")]); f.factory.mock.calls[0][1]("revoked"); await tick();
  expect(f.selection.state().hostId).toBeNull(); expect(f.storage.write).not.toHaveBeenCalled();
  f.selection.forget("unrelated"); expect(f.storage.write).not.toHaveBeenCalled(); f.selection.forget("one"); await tick(); expect(f.storage.write).toHaveBeenLastCalledWith(saved(null));
  const close = fixture(); close.selection.connect(host("one")); close.selection.dispose(); await tick();
  expect(close.storage.write.mock.calls.map(([value]) => value)).toEqual([saved("one")]);
});
it("persists adopted pairing identity only when accepted and retires late startup on disposal", async () => {
  const f = fixture(), paired = { status: () => ({ hostId: "paired" }), close: vi.fn() } as unknown as Transport;
  f.selection.adopt("paired", paired); await tick(); expect(f.storage.write).toHaveBeenLastCalledWith(saved("paired"));
  const wrong = { status: () => ({ hostId: "other" }), close: vi.fn() } as unknown as Transport;
  f.selection.adopt("paired", wrong); await tick(); expect(f.storage.write).toHaveBeenCalledOnce();
  const closed = fixture(), read = deferred<string | null>(); closed.storage.read.mockReturnValueOnce(read.promise);
  const restoring = closed.selection.restore([host("one")]); closed.selection.dispose(); read.resolve(saved("one")); await restoring; expect(closed.factory).not.toHaveBeenCalled();
});
it("forgetting a host retires an unresolved restore, and forgetting a rejected legacy default saves disconnect", async () => {
  const f = fixture(), read = deferred<string | null>(); f.storage.read.mockReturnValueOnce(read.promise);
  const restoring = f.selection.restore([host("forgotten")]); f.selection.forget("forgotten"); read.resolve(saved("forgotten")); await restoring;
  expect(f.factory).not.toHaveBeenCalled();
  const legacy = fixture(); await legacy.selection.restore([host("one"), host("two")]); legacy.factory.mock.calls[0][1]("revoked"); legacy.selection.forget("one"); await tick();
  expect(legacy.storage.write).toHaveBeenLastCalledWith(saved(null));
});
it("a failed old preference write cannot poison a later saved choice", async () => {
  const f = fixture(), first = deferred<void>(); f.storage.write.mockReturnValueOnce(first.promise);
  f.selection.connect(host("one")); await tick(); f.selection.connect(host("two")); first.reject(new Error("disk")); await tick();
  expect(f.selection.state()).toMatchObject({ hostId: "two", savingSelection: false, selectionRetryable: false, selectionError: null });
  expect(f.storage.write.mock.calls.map(([value]) => value)).toEqual([saved("one"), saved("two")]);
});
