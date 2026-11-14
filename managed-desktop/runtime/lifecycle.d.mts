import type { ManagedDescriptor } from './descriptor.mjs';
export function openLifecycle(descriptor: ManagedDescriptor, activate: () => Promise<boolean>): { close(): void };
