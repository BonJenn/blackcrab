import { MobileQueueClient } from "./client";
import { queueStorage, queueId } from "./storage";
import { mobileDrafts } from "../drafts/useDraft";

// Returning to workspaces unmounts the legacy screen. Keep unfinished disk writes
// and receipt cleanup under one owner for the whole app lifetime.
export const mobileQueue = new MobileQueueClient(queueStorage, queueId, 10000,
  (hostId, sessionId, transfer) => mobileDrafts.confirmTransfer(hostId, sessionId, transfer));
