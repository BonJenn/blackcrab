import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { MobileQueueClient } from "./client";
export function useQueue(client: MobileQueueClient, hostId: string, sessionId: string) {
  const subscribe=useCallback((callback:()=>void)=>client.subscribe(hostId,sessionId,callback),[client,hostId,sessionId]);
  const snapshot=useCallback(()=>client.state(hostId,sessionId),[client,hostId,sessionId]);
  const state=useSyncExternalStore(subscribe,snapshot);
  useEffect(()=>{ void client.open(hostId,sessionId); },[client,hostId,sessionId]);
  return state;
}
