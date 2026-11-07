import { createManagedEnvironmentsClient } from "./client";
import { createManagedRuntimeAdapter } from "./runtime";
import { nativeManagedSecureStorage } from "./storage";

/** Separate owner and durable namespace from legacy host pairings and queues. */
export function createNativeManagedEnvironmentsClient() {
  return createManagedEnvironmentsClient({
    makeAdapter: createManagedRuntimeAdapter,
    selectionStorage: nativeManagedSecureStorage,
  });
}
