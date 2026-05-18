//! Pairing service for the Blackcrab mobile remote companion.
//!
//! Persists pending pairing codes and accepted mobile devices to disk under
//! `~/.blackcrab/pairings.json`. There is intentionally no transport here —
//! the codes are generated on the desktop and shown to the user, and a
//! future relay or LAN bridge will actually deliver the code to a phone.
//!
//! Security note: remote tokens are stored in plaintext alongside device
//! metadata in this stub. Before the pairing flow is exposed to users, these
//! tokens should move to the macOS keychain (and platform equivalents) and
//! only metadata should remain in the JSON file. The JSON file is created
//! with mode 0o600 on Unix as a near-term mitigation.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const PAIRING_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LEN: usize = 8;
pub const PAIRING_DEFAULT_TTL_SECS: u64 = 5 * 60;
const REMOTE_TOKEN_BYTES: usize = 32;
const DEVICE_ID_BYTES: usize = 16;

/// Public-facing summary of a paired device. The remote token is deliberately
/// not part of this struct so it cannot accidentally be serialized into the
/// UI or returned from a list endpoint.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairedDevice {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "pairedAtMs")]
    pub paired_at_ms: u128,
    #[serde(rename = "lastSeenAtMs")]
    pub last_seen_at_ms: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct StoredDevice {
    device_id: String,
    display_name: String,
    remote_token: String,
    paired_at_ms: u128,
    last_seen_at_ms: u128,
}

impl StoredDevice {
    fn to_public(&self) -> PairedDevice {
        PairedDevice {
            device_id: self.device_id.clone(),
            display_name: self.display_name.clone(),
            paired_at_ms: self.paired_at_ms,
            last_seen_at_ms: self.last_seen_at_ms,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct PendingPairing {
    code: String,
    created_at_ms: u128,
    expires_at_ms: u128,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct PairingState {
    #[serde(default)]
    pending: Vec<PendingPairing>,
    #[serde(default)]
    devices: Vec<StoredDevice>,
}

#[derive(Debug, Serialize)]
pub struct PairingStartResponse {
    pub code: String,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: u128,
}

#[derive(Debug, Serialize)]
pub struct PairingAcceptResponse {
    #[serde(rename = "remoteToken")]
    pub remote_token: String,
    #[serde(rename = "pairedDevice")]
    pub paired_device: PairedDevice,
}

pub struct PairingService {
    path: PathBuf,
    state: Mutex<PairingState>,
}

impl PairingService {
    /// Load (or initialize) the pairing service from a JSON file path.
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let state = match std::fs::read_to_string(&path) {
            Ok(text) if text.trim().is_empty() => PairingState::default(),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("parse {}: {}", path.display(), e))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => PairingState::default(),
            Err(e) => return Err(format!("read {}: {}", path.display(), e)),
        };
        Ok(Self {
            path,
            state: Mutex::new(state),
        })
    }

    /// Create a pending pairing code, return it for display, and persist.
    pub fn start_pairing(
        &self,
        now_ms: u128,
        ttl_secs: u64,
    ) -> Result<PairingStartResponse, String> {
        let mut state = self.state.lock().map_err(|_| "lock poisoned".to_string())?;
        state.pending.retain(|p| p.expires_at_ms > now_ms);
        let code = generate_unique_code(&state)?;
        let expires_at_ms = now_ms + u128::from(ttl_secs) * 1000;
        state.pending.push(PendingPairing {
            code: code.clone(),
            created_at_ms: now_ms,
            expires_at_ms,
        });
        persist(&self.path, &state)?;
        Ok(PairingStartResponse {
            code,
            expires_at_ms,
        })
    }

    /// Consume a pending pairing code and mint a paired device. Returns the
    /// remote token exactly once; the caller is responsible for delivering it
    /// to the mobile client.
    pub fn accept_pairing(
        &self,
        code: &str,
        device_name: &str,
        now_ms: u128,
    ) -> Result<PairingAcceptResponse, String> {
        let device_name = device_name.trim();
        if device_name.is_empty() {
            return Err("device name required".into());
        }
        let mut state = self.state.lock().map_err(|_| "lock poisoned".to_string())?;
        let pos = state
            .pending
            .iter()
            .position(|p| p.code == code && p.expires_at_ms > now_ms)
            .ok_or_else(|| "unknown or expired pairing code".to_string())?;
        state.pending.remove(pos);
        let device_id = format!("dev_{}", hex(&random_bytes(DEVICE_ID_BYTES)?));
        let remote_token = hex(&random_bytes(REMOTE_TOKEN_BYTES)?);
        let stored = StoredDevice {
            device_id,
            display_name: device_name.to_string(),
            remote_token: remote_token.clone(),
            paired_at_ms: now_ms,
            last_seen_at_ms: now_ms,
        };
        let public = stored.to_public();
        state.devices.push(stored);
        persist(&self.path, &state)?;
        Ok(PairingAcceptResponse {
            remote_token,
            paired_device: public,
        })
    }

    pub fn cancel_pending(&self, code: &str) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| "lock poisoned".to_string())?;
        let before = state.pending.len();
        state.pending.retain(|p| p.code != code);
        let removed = state.pending.len() != before;
        if removed {
            persist(&self.path, &state)?;
        }
        Ok(removed)
    }

    pub fn list_devices(&self) -> Result<Vec<PairedDevice>, String> {
        let state = self.state.lock().map_err(|_| "lock poisoned".to_string())?;
        Ok(state.devices.iter().map(StoredDevice::to_public).collect())
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| "lock poisoned".to_string())?;
        let before = state.devices.len();
        state.devices.retain(|d| d.device_id != device_id);
        let removed = state.devices.len() != before;
        if removed {
            persist(&self.path, &state)?;
        }
        Ok(removed)
    }

    /// Look up a paired device by remote token. Returns the public summary on
    /// match (and updates `last_seen_at_ms`); returns `None` if no device with
    /// that token is paired.
    pub fn verify_token(
        &self,
        remote_token: &str,
        now_ms: u128,
    ) -> Result<Option<PairedDevice>, String> {
        if remote_token.is_empty() {
            return Ok(None);
        }
        let mut state = self.state.lock().map_err(|_| "lock poisoned".to_string())?;
        let device = state
            .devices
            .iter_mut()
            .find(|d| d.remote_token == remote_token);
        match device {
            None => Ok(None),
            Some(d) => {
                d.last_seen_at_ms = now_ms;
                let public = d.to_public();
                persist(&self.path, &state)?;
                Ok(Some(public))
            }
        }
    }
}

pub fn default_state_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".blackcrab").join("pairings.json"))
}

pub fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn persist(path: &Path, state: &PairingState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    write_file_owner_only(path, json.as_bytes())
        .map_err(|e| format!("write {}: {}", path.display(), e))
}

#[cfg(unix)]
fn write_file_owner_only(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(data)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_file_owner_only(path: &Path, data: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, data)
}

fn random_bytes(n: usize) -> Result<Vec<u8>, String> {
    let mut f =
        std::fs::File::open("/dev/urandom").map_err(|e| format!("open /dev/urandom: {e}"))?;
    let mut buf = vec![0u8; n];
    f.read_exact(&mut buf)
        .map_err(|e| format!("read /dev/urandom: {e}"))?;
    Ok(buf)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn generate_pairing_code() -> Result<String, String> {
    let raw = random_bytes(PAIRING_CODE_LEN)?;
    let len = PAIRING_CODE_ALPHABET.len();
    let chars: String = raw
        .iter()
        .map(|b| PAIRING_CODE_ALPHABET[(*b as usize) % len] as char)
        .collect();
    Ok(chars)
}

fn generate_unique_code(state: &PairingState) -> Result<String, String> {
    for _ in 0..32 {
        let code = generate_pairing_code()?;
        if !state.pending.iter().any(|p| p.code == code) {
            return Ok(code);
        }
    }
    Err("could not generate a unique pairing code".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_path() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("blackcrab-pairings-{}-{}.json", std::process::id(), n))
    }

    fn fresh_service() -> (PairingService, PathBuf) {
        let path = temp_path();
        let _ = std::fs::remove_file(&path);
        let svc = PairingService::load(path.clone()).expect("load");
        (svc, path)
    }

    #[test]
    fn pairing_code_uses_unambiguous_alphabet_and_length() {
        let code = generate_pairing_code().unwrap();
        assert_eq!(code.len(), PAIRING_CODE_LEN);
        for c in code.chars() {
            assert!(
                PAIRING_CODE_ALPHABET.contains(&(c as u8)),
                "char {c} not in alphabet"
            );
        }
    }

    #[test]
    fn start_then_accept_persists_device_and_drops_pending() {
        let (svc, path) = fresh_service();
        let start = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        let accept = svc.accept_pairing(&start.code, "Phone", 2_000).unwrap();
        assert_eq!(accept.paired_device.display_name, "Phone");
        assert!(accept.paired_device.device_id.starts_with("dev_"));
        assert_eq!(accept.remote_token.len(), REMOTE_TOKEN_BYTES * 2);

        let reopened = PairingService::load(path.clone()).unwrap();
        let devices = reopened.list_devices().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].display_name, "Phone");

        // Pending code should be consumed.
        let err = svc.accept_pairing(&start.code, "Phone", 3_000).unwrap_err();
        assert!(err.contains("unknown or expired"), "got: {err}");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn expired_codes_are_rejected_and_eventually_swept() {
        let (svc, path) = fresh_service();
        let start = svc.start_pairing(1_000, 1).unwrap();
        // Past expiry (1_000 + 1*1000 = 2_000)
        let err = svc
            .accept_pairing(&start.code, "Phone", 5_000)
            .unwrap_err();
        assert!(err.contains("unknown or expired"));
        // Starting a new pairing should also evict the expired pending.
        svc.start_pairing(10_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn accept_requires_non_empty_device_name() {
        let (svc, path) = fresh_service();
        let start = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        let err = svc.accept_pairing(&start.code, "   ", 2_000).unwrap_err();
        assert!(err.contains("device name"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn cancel_pending_removes_only_matching_code() {
        let (svc, path) = fresh_service();
        let a = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        let b = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        assert!(svc.cancel_pending(&a.code).unwrap());
        // accepting a is now an error
        assert!(svc.accept_pairing(&a.code, "Phone", 2_000).is_err());
        // b still works
        svc.accept_pairing(&b.code, "Phone", 2_000).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn revoke_device_removes_and_returns_false_when_already_gone() {
        let (svc, path) = fresh_service();
        let start = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        let accept = svc.accept_pairing(&start.code, "Phone", 2_000).unwrap();
        let device_id = accept.paired_device.device_id.clone();
        assert!(svc.revoke_device(&device_id).unwrap());
        assert!(!svc.revoke_device(&device_id).unwrap());
        assert!(svc.list_devices().unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn verify_token_returns_device_and_updates_last_seen() {
        let (svc, path) = fresh_service();
        let start = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        let accept = svc.accept_pairing(&start.code, "Phone", 2_000).unwrap();

        let found = svc
            .verify_token(&accept.remote_token, 5_000)
            .unwrap()
            .expect("token recognized");
        assert_eq!(found.device_id, accept.paired_device.device_id);
        assert_eq!(found.last_seen_at_ms, 5_000);

        assert!(svc.verify_token("bogus", 6_000).unwrap().is_none());
        assert!(svc.verify_token("", 6_000).unwrap().is_none());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn handles_missing_file_and_round_trips_state() {
        let path = temp_path();
        let _ = std::fs::remove_file(&path);
        let svc = PairingService::load(path.clone()).expect("first load");
        let start = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        svc.accept_pairing(&start.code, "Phone", 2_000).unwrap();
        drop(svc);
        let reopened = PairingService::load(path.clone()).unwrap();
        assert_eq!(reopened.list_devices().unwrap().len(), 1);
        let _ = std::fs::remove_file(&path);
    }
}
