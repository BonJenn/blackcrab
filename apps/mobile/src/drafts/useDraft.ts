import { useCallback, useEffect, useSyncExternalStore } from "react";
import { MobileDraftClient } from "./client";
import { queueId } from "../queue/storage";
import { draftStorage } from "./storage";
export const mobileDrafts = new MobileDraftClient(draftStorage, queueId);
export function useDraft(hostId: string, sessionId: string, client = mobileDrafts) {
  const subscribe = useCallback((callback: () => void) => client.subscribe(hostId, sessionId, callback), [client, hostId, sessionId]);
  const snapshot = useCallback(() => client.state(hostId, sessionId), [client, hostId, sessionId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => { void client.open(hostId, sessionId); }, [client, hostId, sessionId]);
  return { ...state, client };
}
