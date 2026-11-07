import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import nacl from "tweetnacl";
import { queueId } from "../queue/storage";
import type { DraftStorage } from "./client";
function name(key: string): string {
  const bytes = new Uint8Array(key.length * 2);
  for (let i = 0; i < key.length; i++) { const value = key.charCodeAt(i); bytes[i * 2] = value & 255; bytes[i * 2 + 1] = value >>> 8; }
  return Array.from(nacl.hash(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function file(key: string) {
  if (!FileSystem.documentDirectory) throw new Error("Durable draft storage unavailable");
  return `${FileSystem.documentDirectory}drafts-v1/${name(key)}.json`;
}
export const draftStorage: DraftStorage = {
  async read(key) {
    if (Platform.OS === "web") return localStorage.getItem(`blackcrab.mobile.draft.v1.${name(key)}`);
    const path = file(key);
    return (await FileSystem.getInfoAsync(path)).exists ? FileSystem.readAsStringAsync(path) : null;
  },
  async write(key, value) {
    if (Platform.OS === "web") { localStorage.setItem(`blackcrab.mobile.draft.v1.${name(key)}`, value); return; }
    const path = file(key), temporary = `${path}.${queueId()}.tmp`;
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}drafts-v1`, { intermediates: true });
    try { await FileSystem.writeAsStringAsync(temporary, value); await FileSystem.moveAsync({ from: temporary, to: path }); }
    catch (error) { await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {}); throw error; }
  },
};
