import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import nacl from "tweetnacl";
import type { QueueStorage } from "./client";

/** Random IDs use the existing Hermes CSPRNG polyfill from index.ts. */
export function queueId(): string {
  return Array.from(nacl.randomBytes(16), byte=>byte.toString(16).padStart(2,"0")).join("");
}
function name(key: string): string {
  // Hash UTF-16 code units so every JS identity has a deterministic safe path.
  const bytes=new Uint8Array(key.length*2);
  for(let i=0;i<key.length;i++) { const value=key.charCodeAt(i); bytes[i*2]=value&255; bytes[i*2+1]=value>>>8; }
  return Array.from(nacl.hash(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
function path(key: string): string {
  if (!FileSystem.documentDirectory) throw new Error("Durable queue storage unavailable");
  return `${FileSystem.documentDirectory}queue-recovery-v1/${name(key)}.json`;
}
const browserKey=(key: string)=>`blackcrab.mobile.queueRecovery.v1.${name(key)}`;
export const queueStorage: QueueStorage={
  async read(key) {
    if (Platform.OS==="web") return localStorage.getItem(browserKey(key));
    const file=path(key);
    if (!(await FileSystem.getInfoAsync(file)).exists) return null;
    return FileSystem.readAsStringAsync(file);
  },
  async write(key,value) {
    if (Platform.OS==="web") { localStorage.setItem(browserKey(key),value); return; }
    const file=path(key);
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}queue-recovery-v1`,{intermediates:true});
    const temporary=`${file}.${queueId()}.tmp`;
    try {
      await FileSystem.writeAsStringAsync(temporary,value);
      await FileSystem.moveAsync({from:temporary,to:file});
    } catch(error) {
      await FileSystem.deleteAsync(temporary,{idempotent:true}).catch(()=>{});
      throw error;
    }
  },
  async remove(key) {
    if (Platform.OS==="web") { localStorage.removeItem(browserKey(key)); return; }
    await FileSystem.deleteAsync(path(key),{idempotent:true});
  },
};
