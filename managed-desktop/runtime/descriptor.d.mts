export interface ManagedDescriptor { readonly version:1;readonly browser?:{readonly kind:"leased-uds-v2";readonly path:string;readonly key:string;readonly generation:number;readonly environmentId:string}; readonly owner:{readonly kind:'blackcrab-managed-host';readonly generation:number;readonly environmentId:string;readonly origin:string;readonly serverVersion:'0.1.7';readonly orchestrationProtocolVersion:2};readonly profile:{readonly root:string;readonly namespace:'blackcrab-managed-v1';readonly appId:'com.blackcrab.desktop.managed'};readonly control:{readonly kind:'unavailable'};readonly authorization:{readonly kind:'paired-credential';readonly credential:string;readonly expiresAt:number;readonly renewal:{readonly kind:'owner-credential-fd-v1';readonly fd:4}} }
export const NAMESPACE:Readonly<{appId:'com.blackcrab.desktop.managed';name:'Blackcrab';scheme:'blackcrab';profile:'blackcrab-managed-v1'}>;
export function readDescriptor(fd?:number):ManagedDescriptor;
export function parseDescriptor(bytes:string|Uint8Array):ManagedDescriptor;
export function inspectProfile(descriptor:ManagedDescriptor):string;

export function inspectBrowserCapability(descriptor:ManagedDescriptor):void;
