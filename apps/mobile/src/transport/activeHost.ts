import type { RemoteEvent } from "@blackcrab/remote-protocol";
import type { Transport, TransportStatus } from "./types";

/** Bind events to one authenticated host and retire callbacks before cleanup. */
export function subscribeToHost(transport: Transport, hostId: string, onStatus: (status: TransportStatus) => void, onEvent: (event: RemoteEvent) => void, selectedSession?: () => string | null): () => void {
  let disposed = false;
  let connected = false;
  const resolved = new Set<string>();
  function status(value: TransportStatus) {
    if (disposed) return;
    if (value.hostId && value.hostId !== hostId) {
      connected = false;
      onStatus({ state: "error", hostId, sinceMs: value.sinceMs, detail: "The connection reported a different host. Reconnect to the selected host." });
      return;
    }
    connected = value.state === "connected";
    if (!connected) resolved.clear();
    onStatus(value);
  }
  status(transport.status());
  const offStatus = transport.subscribe(status);
  const offEvents = transport.subscribeEvents(event => {
    if (disposed || !connected) return;
    if ("hostId" in event && event.hostId !== hostId) return;
    if (event.type === "sessions" && (!Array.isArray(event.sessions) || event.sessions.some(session => !session || session.hostId !== hostId))) return;
    if (event.type === "transcript_tail" && (!Array.isArray(event.entries) || event.entries.some(entry => !entry || entry.sessionId !== event.sessionId) || (selectedSession && event.sessionId !== selectedSession()))) return;
    if (event.type === "approval_requested" && (!event.approval || event.approval.hostId !== hostId || resolved.has(event.approval.id))) return;
    if (event.type === "approval_resolved") {
      resolved.add(event.approvalId);
      if (resolved.size > 512) resolved.delete(resolved.values().next().value!);
    }
    onEvent(event);
  });
  return () => { disposed = true; connected = false; offStatus(); offEvents(); };
}
