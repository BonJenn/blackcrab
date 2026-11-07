import { expect, it, vi } from "vitest";
import { subscribeToHost } from "./activeHost";
import type { RemoteEvent, ApprovalRequest } from "@blackcrab/remote-protocol";
import type { Transport, TransportStatus } from "./types";
function fixture(selectedSession?: () => string | null) {
  let status: TransportStatus = { state: "connected", hostId: "one", sinceMs: 1 };
  let update!: (value: TransportStatus) => void, receive!: (value: RemoteEvent) => void;
  const offStatus = vi.fn(), offEvents = vi.fn(), onStatus = vi.fn(), onEvent = vi.fn();
  const transport = { send: vi.fn(), sendAction: vi.fn(() => false), close: vi.fn(), status: () => status, subscribe: callback => { update = callback; return offStatus; }, subscribeEvents: callback => { receive = callback; return offEvents; } } as Transport;
  const dispose = subscribeToHost(transport, "one", onStatus, onEvent, selectedSession);
  return { onStatus, onEvent, offStatus, offEvents, dispose, receive: (event: RemoteEvent) => receive(event), update: (next: TransportStatus) => { status = next; update(next); } };
}
const requested = (hostId: string): RemoteEvent => ({ type: "approval_requested", approval: { hostId, id: "approval" } as ApprovalRequest });
it("rejects foreign host records and mixed-session transcript snapshots", () => {
  const f = fixture();
  f.receive({ type: "sessions", hostId: "other", sessions: [] });
  f.receive({ type: "sessions", hostId: "one", sessions: [{ hostId: "other" }] } as RemoteEvent);
  f.receive({ type: "transcript_tail", hostId: "one", sessionId: "chosen", entries: [{ sessionId: "other" }] } as RemoteEvent);
  f.receive(requested("other"));
  f.receive({ type: "sessions", hostId: "one", sessions: null } as unknown as RemoteEvent);
  f.receive({ type: "transcript_tail", hostId: "one", sessionId: "chosen", entries: null } as unknown as RemoteEvent);
  f.receive({ type: "approval_requested", approval: null } as unknown as RemoteEvent);
  expect(f.onEvent).not.toHaveBeenCalled();
  f.receive({ type: "sessions", hostId: "one", sessions: [] }); expect(f.onEvent).toHaveBeenCalledOnce();
});
it("rejects disconnected or retired callbacks even if an unsubscribe cannot retract queued delivery", () => {
  const f = fixture(); f.update({ state: "reconnecting", hostId: "one", sinceMs: 2 });
  f.receive(requested("one")); expect(f.onEvent).not.toHaveBeenCalled();
  f.update({ state: "connected", hostId: "one", sinceMs: 3 }); f.receive(requested("one")); expect(f.onEvent).toHaveBeenCalledOnce();
  f.dispose(); f.receive({ type: "approval_resolved", approvalId: "approval", resolution: "approved" });
  f.update({ state: "connected", hostId: "one", sinceMs: 4 });
  expect(f.onEvent).toHaveBeenCalledOnce(); expect(f.onStatus).toHaveBeenCalledTimes(3);
  expect(f.offEvents).toHaveBeenCalledOnce(); expect(f.offStatus).toHaveBeenCalledOnce();
});
it("marks mismatched transport identity unavailable and does not resurrect a resolved approval", () => {
  const f = fixture();
  f.receive({ type: "approval_resolved", approvalId: "approval", resolution: "approved" });
  f.receive(requested("one")); expect(f.onEvent).toHaveBeenCalledOnce();
  f.update({ state: "connected", hostId: "other", sinceMs: 2 });
  expect(f.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: "error", hostId: "one" }));
  f.receive({ type: "sessions", hostId: "one", sessions: [] }); expect(f.onEvent).toHaveBeenCalledOnce();
});

it("routes transcript snapshots to the currently focused session without rebinding the connection", () => {
  let selected: string | null = "first";
  const f = fixture(() => selected);
  const tail = (sessionId: string): RemoteEvent => ({ type: "transcript_tail", hostId: "one", sessionId, entries: [] });
  f.receive(tail("first")); selected = "second";
  f.receive(tail("first")); f.receive(tail("second")); selected = null; f.receive(tail("second"));
  expect(f.onEvent.mock.calls.map(([event]) => event.sessionId)).toEqual(["first", "second"]);
});
