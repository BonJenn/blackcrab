import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { HostSelectionStorage } from "./hostSelection";

export const HOST_SELECTION_KEY = "blackcrab.mobile.hostSelection.v1";
/** Selection contains a host ID only; pairing credentials stay in the pairing store. */
export const hostSelectionStorage: HostSelectionStorage = {
  async read() {
    if (Platform.OS === "web") return localStorage.getItem(HOST_SELECTION_KEY);
    if (!await SecureStore.isAvailableAsync()) throw new Error("Host selection storage unavailable");
    return SecureStore.getItemAsync(HOST_SELECTION_KEY);
  },
  async write(value) {
    if (Platform.OS === "web") { localStorage.setItem(HOST_SELECTION_KEY, value); return; }
    if (!await SecureStore.isAvailableAsync()) throw new Error("Host selection storage unavailable");
    await SecureStore.setItemAsync(HOST_SELECTION_KEY, value);
  },
};
