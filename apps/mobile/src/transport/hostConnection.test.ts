import { expect, it, vi } from "vitest";
import { MobileHostConnection } from "./hostConnection";
import type { StoredPairedHost } from "../pairingStore";
import type { Transport } from "./types";
const host = (hostId: string) => ({ hostId }) as StoredPairedHost;
function transport(hostId: string) {
  return { status: () => ({ state: "connecting", hostId, sinceMs: 1 }), close: vi.fn(), sendAction: vi.fn() } as unknown as Transport;
}
function fixture() {
  const created: Array<{ transport: Transport; reject: (reason: string) => void }> = [];
  const factory = vi.fn((selected: StoredPairedHost, reject: (reason: string) => void) => { const next = transport(selected.hostId); created.push({ transport: next, reject }); return next; });
  const owner = new MobileHostConnection(factory);
  return { owner, created, factory };
}
it("replaces host and transport atomically, and ignores a retired host's fatal rejection", () => {
  const f = fixture(), snapshots: unknown[] = [];
  f.owner.subscribe(() => snapshots.push(f.owner.state()));
  expect(f.owner.connect(host("one"))).toBe(true); expect(f.owner.connect(host("two"))).toBe(true);
  f.created[0].reject("late rejection");
  expect(f.owner.state()).toMatchObject({ hostId: "two", transport: f.created[1].transport, error: null });
  expect(f.created[0].transport.close).toHaveBeenCalledOnce(); expect(f.created[1].transport.close).not.toHaveBeenCalled();
  expect(snapshots).toEqual([{ hostId: "one", transport: f.created[0].transport, error: null }, { hostId: "two", transport: f.created[1].transport, error: null }]);
});
it("retains the previous connection after failed creation, synchronous rejection or wrong identity", () => {
  const f = fixture(); f.owner.connect(host("one"));
  f.factory.mockReturnValueOnce(null as unknown as Transport);
  expect(f.owner.connect(host("missing"))).toBe(false);
  f.factory.mockImplementationOnce(() => { throw new Error("private details"); });
  expect(f.owner.connect(host("throws"))).toBe(false); expect(f.owner.state().error).not.toContain("private details");
  const rejected = transport("two"); f.factory.mockImplementationOnce((_host, reject) => { reject("denied"); return rejected; });
  expect(f.owner.connect(host("two"))).toBe(false); expect(rejected.close).toHaveBeenCalledOnce();
  const wrong = transport("other"); f.factory.mockReturnValueOnce(wrong);
  expect(f.owner.connect(host("two"))).toBe(false); expect(wrong.close).toHaveBeenCalledOnce();
  expect(f.owner.state().transport).toBe(f.created[0].transport); expect(f.created[0].transport.close).not.toHaveBeenCalled();
});
it("reconnects only explicitly, without resending agent actions", () => {
  const f = fixture(); f.owner.connect(host("one")); f.owner.connect(host("one"));
  expect(f.factory).toHaveBeenCalledOnce();
  expect(f.owner.connect(host("one"), true)).toBe(true); expect(f.factory).toHaveBeenCalledTimes(2);
  expect(f.created[0].transport.close).toHaveBeenCalledOnce();
  f.created[0].reject("stale same-host generation"); expect(f.owner.state().transport).toBe(f.created[1].transport);
  f.created[1].reject("current rejection"); expect(f.owner.state()).toMatchObject({ hostId: null, transport: null });
  expect(f.created[1].transport.close).toHaveBeenCalledOnce();
  expect(f.created.every(value => vi.mocked(value.transport.sendAction).mock.calls.length === 0)).toBe(true);
});
it("adopts a pairing connection and forgets only the host currently selected", () => {
  const f = fixture(); f.owner.connect(host("one")); const paired = transport("paired");
  f.owner.adopt("paired", paired); f.created[0].reject("late"); f.owner.forget("one");
  expect(f.owner.state().transport).toBe(paired); expect(paired.close).not.toHaveBeenCalled();
  const wrong = transport("foreign"); f.owner.adopt("paired", wrong); expect(wrong.close).toHaveBeenCalledOnce();
  expect(f.owner.state().transport).toBe(paired);
  f.owner.forget("paired"); expect(paired.close).toHaveBeenCalledOnce(); expect(f.owner.state().hostId).toBeNull();
});
it("retires callbacks before closing, including failures emitted during cleanup", () => {
  const f = fixture(); f.owner.connect(host("one"));
  vi.mocked(f.created[0].transport.close).mockImplementation(() => f.created[0].reject("close callback"));
  f.owner.connect(host("two")); expect(f.owner.state().hostId).toBe("two");
  f.owner.dispose(); f.owner.dispose(); f.created[1].reject("late unmount callback");
  expect(f.created[1].transport.close).toHaveBeenCalledOnce(); expect(f.owner.connect(host("three"))).toBe(false);
  const latePairing = transport("late"); f.owner.adopt("late", latePairing); expect(latePairing.close).toHaveBeenCalledOnce();
  expect(f.owner.state().transport).toBeNull();
});
