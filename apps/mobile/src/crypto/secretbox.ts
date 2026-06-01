/**
 * End-to-end encryption for relay traffic, using NaCl secretbox
 * (XSalsa20-Poly1305) via tweetnacl. Wire-compatible with the desktop's
 * `src-tauri/src/crypto.rs` — the 16-byte Poly1305 tag is prepended to the
 * ciphertext (libsodium "easy" / tweetnacl layout).
 *
 * The shared 32-byte key is minted by the desktop over the trusted LAN pairing
 * channel and persisted with the host (see `pairingStore.ts`). The relay only
 * ever sees the sealed `{nonce, ciphertext}` frame.
 *
 * tweetnacl needs `crypto.getRandomValues`; on device it's polyfilled by the
 * `react-native-get-random-values` import in `index.ts`, and Node provides it
 * natively under tests.
 */

import nacl from "tweetnacl";
import {
  parseEnvelope,
  serializeEnvelope,
  type RemoteEnvelope,
  type RemoteWireMessage,
} from "@blackcrab/remote-protocol";

export interface SealedFrame {
  /** base64 24-byte nonce */
  nonce: string;
  /** base64 secretbox output: 16-byte tag followed by ciphertext */
  ciphertext: string;
}

const KEY_LEN = 32;
const NONCE_LEN = 24;

/** Seal `plaintext` under a base64 key with a fresh nonce. Null on bad key. */
export function seal(keyB64: string, plaintext: string): SealedFrame | null {
  const key = fromBase64(keyB64);
  if (key.length !== KEY_LEN) return null;
  const nonce = nacl.randomBytes(NONCE_LEN);
  const box = nacl.secretbox(utf8Encode(plaintext), nonce, key);
  return { nonce: toBase64(nonce), ciphertext: toBase64(box) };
}

/** Open a sealed frame. Null for a wrong key or a tampered/malformed frame. */
export function open(keyB64: string, frame: SealedFrame): string | null {
  const key = fromBase64(keyB64);
  if (key.length !== KEY_LEN) return null;
  const nonce = fromBase64(frame.nonce);
  if (nonce.length !== NONCE_LEN) return null;
  const opened = nacl.secretbox.open(fromBase64(frame.ciphertext), nonce, key);
  return opened ? utf8Decode(opened) : null;
}

/** Seal a protocol wire message for relay transport. */
export function sealEnvelope(
  keyB64: string,
  msg: RemoteWireMessage,
): SealedFrame | null {
  return seal(keyB64, serializeEnvelope(msg));
}

/** Open a sealed frame back into a protocol envelope. */
export function openEnvelope(
  keyB64: string,
  frame: SealedFrame,
): RemoteEnvelope | null {
  const text = open(keyB64, frame);
  return text ? parseEnvelope(text) : null;
}

// --- base64 + utf8 helpers (no btoa/atob/Buffer dependency) ---------------

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64_CHARS.length; i += 1) B64_LOOKUP[B64_CHARS[i]!] = i;

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 63] : "=";
  }
  return out;
}

export function fromBase64(str: string): Uint8Array {
  const clean = str.replace(/=+$/, "");
  const len = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(len);
  let bits = 0;
  let value = 0;
  let p = 0;
  for (const ch of clean) {
    const v = B64_LOOKUP[ch];
    if (v === undefined) continue;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
