const slot = Symbol.for('blackcrab.mobile.managed-root-ownership.v1');
export function createManagedOwnershipGuard() {
  let legacyConstructed = false, fullRootClaimed = false;
  return Object.freeze({
    legacyReaderConstructed() {
      if (fullRootClaimed) throw new Error('The full native workspace already owns managed connections.');
      legacyConstructed = true;
    },
    claimFullRoot() {
      if (legacyConstructed) throw new Error('Restart Blackcrab Remote to activate the full workspace.');
      fullRootClaimed = true;
    },
  });
}
globalThis[slot] ??= createManagedOwnershipGuard();
export const managedOwnership = globalThis[slot];
