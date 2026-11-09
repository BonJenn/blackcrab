export interface ManagedOwnershipGuard { legacyReaderConstructed(): void; claimFullRoot(): void }
export function createManagedOwnershipGuard(): ManagedOwnershipGuard;
export const managedOwnership: ManagedOwnershipGuard;
