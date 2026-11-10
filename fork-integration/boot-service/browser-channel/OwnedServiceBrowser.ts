// Native-selected service bootstrap policy; never a renderer or environment selector.
export interface OwnedServiceBrowser {readonly path:string;readonly key:string;readonly generation:number}
export function validOwnedServiceBrowser(value:unknown):value is OwnedServiceBrowser {
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const socket=value as Record<string,unknown>;
 return Object.keys(socket).sort().join(",")==="generation,key,path"
  &&typeof socket.path==="string"&&socket.path.length<=100
  &&/^\/(?:private\/)?tmp\/blackcrab-browser-[a-f0-9]{32}\/b\.sock$/.test(socket.path)
  &&typeof socket.key==="string"&&/^[a-f0-9]{64}$/.test(socket.key)
  &&typeof socket.generation==="number"&&Number.isSafeInteger(socket.generation)&&socket.generation>0;
}
