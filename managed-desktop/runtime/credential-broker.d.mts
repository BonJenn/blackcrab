import type {ManagedDescriptor} from './descriptor.mjs';
export function createCredentialBroker(descriptor:ManagedDescriptor,onFailure?:()=>void):Readonly<{renew:()=>Promise<string>;close:()=>void}>;
