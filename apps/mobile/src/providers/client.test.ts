import { afterEach, expect, it, vi } from "vitest";
import type { ProvidersRequestAction, ProvidersResultEvent, RemoteEvent, RemoteProviderInfo } from "@blackcrab/remote-protocol";
import type { Transport, TransportEventListener, TransportListener, TransportStatus } from "../transport/types";
import { MobileProvidersClient } from "./client";
export const codex: RemoteProviderInfo = { id: "codex", displayName: "Codex", installed: true, desktopReady: false, remoteReady: false, capabilities: { resume: true, streaming: true, modelSelection: true, permissionModes: ["default", "readOnly"], worktrees: false, steering: false } };
function fixture() {
  let status: TransportStatus = { state: "connected", hostId: "host", sinceMs: 0 };
  const events = new Set<TransportEventListener>(), statuses = new Set<TransportListener>();
  const actions: ProvidersRequestAction[] = [];
  const transport: Transport = { status: () => status, subscribe: cb => { statuses.add(cb); return () => { statuses.delete(cb); }; }, subscribeEvents: cb => { events.add(cb); return () => { events.delete(cb); }; }, send: vi.fn(), sendAction: vi.fn(action => { actions.push(action as ProvidersRequestAction); return true; }), close: vi.fn() };
  let id = 0;
  const client = new MobileProvidersClient(() => `read-${++id}`, 100);
  const emit = (event: RemoteEvent) => events.forEach(cb => cb(event));
  const reply = (patch: Partial<ProvidersResultEvent> = {}, request = actions.at(-1)!) => emit({ type: "providers_result", hostId: "host", requestId: request.requestId, ok: true, error: null, providers: [codex], ...patch });
  return { client, transport, actions, events, statuses, reply, emit, setStatus: (patch: Partial<TransportStatus>, notify = true) => { status = { ...status, ...patch }; if (notify) statuses.forEach(cb => cb(status)); } };
}
afterEach(() => vi.useRealTimers());
it("requests read-only discovery once on authenticated connect and accepts only its host/request", () => {
  const f = fixture(); f.client.bind(f.transport, "host");
  expect(f.actions).toEqual([{ type: "providers_request", hostId: "host", requestId: "read-1" }]);
  for (const patch of [{ hostId: "other" }, { requestId: "unknown" }]) { f.reply(patch); expect(f.client.state().loading).toBe(true); }
  f.reply(); expect(f.client.state().providers).toEqual([codex]); expect(f.client.state().loading).toBe(false);
  expect(f.actions).toHaveLength(1); f.client.dispose(); expect(f.events.size).toBe(0); expect(f.statuses.size).toBe(0);
});
it("clears retired data and ignores old host callbacks after switching", () => {
  const f = fixture(); f.client.bind(f.transport, "host"); const old = [...f.events][0], requestId = f.actions[0].requestId;
  f.reply(); f.client.bind(null, "other"); old({ type: "providers_result", hostId: "host", requestId, ok: true, error: null, providers: [codex] });
  expect(f.client.state()).toMatchObject({ hostId: "other", providers: null, connected: false }); f.client.dispose();
});
it("retires requests across same-host reconnect without replaying any mutations", () => {
  const f = fixture(); f.client.bind(f.transport, "host"); const old = f.actions[0];
  f.setStatus({ state: "reconnecting" }); f.setStatus({ state: "connected" });
  f.reply({}, old); expect(f.client.state().loading).toBe(true); f.reply(); expect(f.client.state().providers).toEqual([codex]);
  expect(f.actions.map(action => action.type)).toEqual(["providers_request", "providers_request"]); f.client.dispose();
});
it("checks transport identity and live status at request and response time", () => {
  const f = fixture(); f.setStatus({ hostId: "foreign" }); f.client.bind(f.transport, "host"); expect(f.actions).toHaveLength(0);
  f.setStatus({ hostId: "host" }); expect(f.actions).toHaveLength(1);
  f.setStatus({ state: "disconnected" }, false); f.reply(); expect(f.client.state()).toMatchObject({ providers: null, connected: false, loading: false });
  f.client.refresh(); expect(f.actions).toHaveLength(1); f.client.dispose();
});
it("timeouts on older hosts and permits explicit refresh without claiming support", () => {
  vi.useFakeTimers(); const f = fixture(); f.client.bind(f.transport, "host");
  vi.advanceTimersByTime(100); expect(f.client.state()).toMatchObject({ providers: null, loading: false }); expect(f.client.state().error).toContain("unavailable");
  f.client.refresh(); f.reply(); expect(f.client.state().error).toBeNull(); f.client.dispose();
});
it("shows explicit host rejection or failed handoff and ignores malformed results", () => {
  const f = fixture(); f.client.bind(f.transport, "host"); f.reply({ ok: true, providers: null }); expect(f.client.state().loading).toBe(true);
  f.reply({ ok: false, providers: null, error: "request rejected" }); expect(f.client.state().error).toBe("request rejected");
  vi.mocked(f.transport.sendAction).mockReturnValueOnce(false); f.client.refresh(); expect(f.client.state().error).toContain("could not be requested");
  vi.mocked(f.transport.sendAction).mockImplementationOnce(() => { throw new Error("private detail"); }); f.client.refresh(); expect(f.client.state().error).not.toContain("private detail"); f.client.dispose();
});
