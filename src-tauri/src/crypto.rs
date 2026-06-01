//! End-to-end encryption for relay traffic.
//!
//! NaCl secretbox (XSalsa20-Poly1305), wire-compatible with the mobile
//! companion's `tweetnacl`. The shared 32-byte key is minted over the trusted
//! LAN pairing channel (see `pairing.rs`); the relay only ever sees the sealed
//! `{nonce, ciphertext}` frame, never the key or the plaintext.
//!
//! Frame layout matches libsodium's `crypto_secretbox_easy` / tweetnacl: the
//! 16-byte Poly1305 tag is **prepended** to the ciphertext. The RustCrypto
//! AEAD trait appends it instead, so we (de)assemble explicitly.
//!
//! `seal`/`open`/`SealedFrame` are exercised by tests here and consumed by the
//! desktop relay client in a follow-up; allow them to be otherwise-unused for
//! now so the lib stays warning-clean.
#![allow(dead_code)]

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use crypto_secretbox::aead::AeadInPlace;
use crypto_secretbox::{KeyInit, Nonce, Tag, XSalsa20Poly1305};

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;

/// A sealed message ready to route through the relay. Both fields are base64.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SealedFrame {
    pub nonce: String,
    /// 16-byte Poly1305 tag followed by ciphertext (libsodium/tweetnacl order).
    pub ciphertext: String,
}

fn cipher(key_b64: &str) -> Option<XSalsa20Poly1305> {
    let key = B64.decode(key_b64).ok()?;
    if key.len() != KEY_LEN {
        return None;
    }
    XSalsa20Poly1305::new_from_slice(&key).ok()
}

fn seal_with_nonce(key_b64: &str, nonce: &[u8], plaintext: &[u8]) -> Option<SealedFrame> {
    if nonce.len() != NONCE_LEN {
        return None;
    }
    let cipher = cipher(key_b64)?;
    let mut buf = plaintext.to_vec();
    let tag = cipher
        .encrypt_in_place_detached(Nonce::from_slice(nonce), b"", &mut buf)
        .ok()?;
    let mut out = Vec::with_capacity(TAG_LEN + buf.len());
    out.extend_from_slice(&tag); // tag first, then ciphertext
    out.extend_from_slice(&buf);
    Some(SealedFrame {
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(out),
    })
}

/// Seal `plaintext` under `key_b64` with a fresh random nonce. Returns `None`
/// only if the key is malformed or the system RNG fails.
pub fn seal(key_b64: &str, plaintext: &str) -> Option<SealedFrame> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).ok()?;
    seal_with_nonce(key_b64, &nonce, plaintext.as_bytes())
}

/// Open a sealed frame. Returns `None` for a wrong key, a tampered frame, or
/// non-UTF-8 plaintext.
pub fn open(key_b64: &str, frame: &SealedFrame) -> Option<String> {
    let cipher = cipher(key_b64)?;
    let nonce = B64.decode(&frame.nonce).ok()?;
    if nonce.len() != NONCE_LEN {
        return None;
    }
    let data = B64.decode(&frame.ciphertext).ok()?;
    if data.len() < TAG_LEN {
        return None;
    }
    let (tag, ct) = data.split_at(TAG_LEN);
    let mut buf = ct.to_vec();
    cipher
        .decrypt_in_place_detached(Nonce::from_slice(&nonce), b"", &mut buf, Tag::from_slice(tag))
        .ok()?;
    String::from_utf8(buf).ok()
}

/// Generate a fresh base64-encoded 32-byte E2E key. Used at pairing time.
pub fn generate_key_b64() -> Option<String> {
    let mut key = [0u8; KEY_LEN];
    getrandom::getrandom(&mut key).ok()?;
    Some(B64.encode(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Canonical vector produced by tweetnacl (mobile side); proves byte-for-byte
    // JS<->Rust interop. key = bytes 1..=32, nonce = bytes 1..=24.
    const PLAINTEXT: &str = "{\"v\":1,\"msg\":{\"type\":\"ping\",\"seq\":7}}";
    const CIPHERTEXT_B64: &str =
        "wkuWDhGUaGBvT0TpsvS4t1UNWwEt0I198+hu7WWQ7GNd9S4A3zze0ucEWmm+7piVVLEHB+s=";

    fn key_b64() -> String {
        B64.encode((1u8..=32).collect::<Vec<u8>>())
    }
    fn nonce_bytes() -> Vec<u8> {
        (1u8..=24).collect()
    }

    #[test]
    fn seal_matches_tweetnacl_vector() {
        let frame = seal_with_nonce(&key_b64(), &nonce_bytes(), PLAINTEXT.as_bytes()).unwrap();
        assert_eq!(frame.nonce, B64.encode(nonce_bytes()));
        assert_eq!(frame.ciphertext, CIPHERTEXT_B64);
    }

    #[test]
    fn opens_tweetnacl_vector() {
        let frame = SealedFrame {
            nonce: B64.encode(nonce_bytes()),
            ciphertext: CIPHERTEXT_B64.to_string(),
        };
        assert_eq!(open(&key_b64(), &frame).unwrap(), PLAINTEXT);
    }

    #[test]
    fn round_trips_with_random_nonce() {
        let key = key_b64();
        let frame = seal(&key, "hello relay").unwrap();
        assert_eq!(open(&key, &frame).unwrap(), "hello relay");
    }

    #[test]
    fn wrong_key_fails_to_open() {
        let frame = seal(&key_b64(), "secret").unwrap();
        let other = B64.encode((100u8..=131).collect::<Vec<u8>>());
        assert!(open(&other, &frame).is_none());
    }

    #[test]
    fn generated_key_is_32_bytes() {
        let key = generate_key_b64().unwrap();
        assert_eq!(B64.decode(key).unwrap().len(), 32);
    }
}
