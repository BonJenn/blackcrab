import { describe, expect, it } from "vitest";

import {
  fromBase64,
  open,
  openEnvelope,
  seal,
  sealEnvelope,
  toBase64,
} from "./secretbox";

// Canonical vector shared with the desktop's `crypto.rs` test — proves
// byte-for-byte JS<->Rust interop. key = bytes 1..=32, nonce = bytes 1..=24.
const KEY_B64 = toBase64(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1)));
const NONCE_B64 = toBase64(Uint8Array.from(Array.from({ length: 24 }, (_, i) => i + 1)));
const PLAINTEXT = '{"v":1,"msg":{"type":"ping","seq":7}}';
const CIPHERTEXT_B64 =
  "wkuWDhGUaGBvT0TpsvS4t1UNWwEt0I198+hu7WWQ7GNd9S4A3zze0ucEWmm+7piVVLEHB+s=";

describe("secretbox", () => {
  it("base64 round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("opens the canonical tweetnacl vector", () => {
    const text = open(KEY_B64, { nonce: NONCE_B64, ciphertext: CIPHERTEXT_B64 });
    expect(text).toBe(PLAINTEXT);
  });

  it("seal -> open round-trips", () => {
    const frame = seal(KEY_B64, "hello relay");
    expect(frame).not.toBeNull();
    expect(open(KEY_B64, frame!)).toBe("hello relay");
  });

  it("returns null for a wrong key", () => {
    const frame = seal(KEY_B64, "secret")!;
    const otherKey = toBase64(
      Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 100)),
    );
    expect(open(otherKey, frame)).toBeNull();
  });

  it("returns null for a malformed key length", () => {
    expect(seal(toBase64(Uint8Array.from([1, 2, 3])), "x")).toBeNull();
  });

  it("seals and opens a protocol envelope", () => {
    const frame = sealEnvelope(KEY_B64, { type: "ping", seq: 9 });
    expect(frame).not.toBeNull();
    const envelope = openEnvelope(KEY_B64, frame!);
    expect(envelope?.msg).toEqual({ type: "ping", seq: 9 });
  });
});
