import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import type { RemoteAttachment } from "@blackcrab/remote-protocol";

/**
 * Pickers for the chat composer. Each returns a RemoteAttachment (base64
 * contents) ready to send to the host, or null when the user cancels or
 * permission is denied. Throws with a human-readable message on size limits.
 */

// Base64 inflates ~33%, and the payload rides the encrypted transport in one
// message, so keep a sane ceiling per file.
const MAX_BYTES = 12 * 1024 * 1024;

function tooBig(base64: string): boolean {
  return base64.length * 0.75 > MAX_BYTES;
}

async function base64FromUri(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: "base64" });
}

function finalize(
  base64: string,
  name: string,
  mimeType?: string,
): RemoteAttachment {
  if (tooBig(base64)) {
    throw new Error(`"${name}" is too large to send (max 12 MB).`);
  }
  return { name, mimeType, dataBase64: base64 };
}

export async function pickPhoto(): Promise<RemoteAttachment | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Photo library access was denied. Enable it in Settings.");
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    base64: true,
    quality: 0.8,
  });
  if (res.canceled || res.assets.length === 0) return null;
  const a = res.assets[0];
  const data = a.base64 ?? (await base64FromUri(a.uri));
  return finalize(data, a.fileName ?? `photo-${a.assetId ?? "image"}.jpg`, a.mimeType ?? "image/jpeg");
}

export async function takePhoto(): Promise<RemoteAttachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Camera access was denied. Enable it in Settings.");
  }
  const res = await ImagePicker.launchCameraAsync({
    base64: true,
    quality: 0.7,
  });
  if (res.canceled || res.assets.length === 0) return null;
  const a = res.assets[0];
  const data = a.base64 ?? (await base64FromUri(a.uri));
  return finalize(data, a.fileName ?? `photo.jpg`, a.mimeType ?? "image/jpeg");
}

export async function pickFile(): Promise<RemoteAttachment | null> {
  const res = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || res.assets.length === 0) return null;
  const a = res.assets[0];
  const data = await base64FromUri(a.uri);
  return finalize(data, a.name ?? "file", a.mimeType ?? undefined);
}
