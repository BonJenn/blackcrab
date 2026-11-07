import { useCallback, useEffect, useSyncExternalStore } from "react";
import { queueClient } from "./queueClient";

export function usePanelQueue(panelId: string, sessionId: string | undefined, sessionOn: boolean, enabled: boolean) {
  const subscribe = useCallback((callback: () => void) => queueClient.subscribe(panelId, callback), [panelId]);
  const snapshot = useCallback(() => queueClient.state(panelId), [panelId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!enabled) return;
    // Native events and saved queue state belong to the external host.
    void queueClient.connect().then(() => queueClient.refresh(panelId, sessionId, sessionOn)).catch(error => queueClient.report(panelId, error));
  }, [panelId, sessionId, sessionOn, enabled]);
  return state;
}
