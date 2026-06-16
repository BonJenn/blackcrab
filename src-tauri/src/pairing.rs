//! Pairing service for the Blackcrab mobile remote companion.
//!
//! Persists pending pairing codes and accepted mobile devices to disk under
//! `~/.blackcrab/pairings.json`. There is intentionally no transport here —
//! the codes are generated on the desktop and shown to the user, and a
//! future relay or LAN bridge will actually deliver the code to a phone.
//!
//! Security note: per-device secrets (`remoteToken`, `e2eKey`, and the future
//! `relayDeviceToken`) are kept out of the on-disk JSON whenever a real secret
//! store is available. On macOS they live in the login Keychain (service
//! "Blackcrab Device Secret", account = device id); only non-secret metadata
//! (device id, display name, timestamps) remains in `~/.blackcrab/pairings.json`.
//! On other platforms — and in tests — secrets stay inline in the JSON so
//! behavior is unchanged where no Keychain exists. The JSON file is created
//! with mode 0o600 on Unix as a defense-in-depth measure.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const PAIRING_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LEN: usize = 8;
pub const PAIRING_DEFAULT_TTL_SECS: u64 = 5 * 60;
const REMOTE_TOKEN_BYTES: usize = 32;
const DEVICE_ID_BYTES: usize = 16;

#[cfg(target_os = "macos")]
const DEVICE_SECRET_SERVICE: &str = "Blackcrab Device Secret";

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
    // Per-device secrets. These are only Some on disk for legacy files written
    // before the secret store existed (or on platforms without a real secret
    // store). On `load()` any inline secrets are migrated into the secret store
    // and the JSON is rewritten without them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remote_token: Option<String>,
    // base64 32-byte E2E key shared with this device, minted over LAN at
    // pairing. Defaulted so pairing files written before relay support load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    e2e_key: Option<String>,
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

/// The bundle of secrets held for one paired device. Stored in the macOS
/// Keychain (as a JSON blob keyed by device id) or, on other platforms / in
/// tests, inline in the pairings JSON.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceSecret {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    remote_token: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    e2e_key: String,
    /// Future relay device-auth token. Minted at pairing and plumbed through to
    /// the device, but not yet enforced by the relay.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    relay_device_token: String,
}

/// Backend that holds per-device secrets out of the cleartext JSON.
///
/// - `Keychain` shells to `/usr/bin/security` on macOS (mirrors the Claude
///   token storage in `lib.rs`).
/// - `Memory` keeps secrets in process; used on non-macOS platforms and in all
///   unit tests so they never touch the real Keychain and stay hermetic.
pub enum SecretStore {
    #[cfg(target_os = "macos")]
    Keychain,
    // Constructed on non-macOS and in every unit test; on macOS the production
    // build only ever uses `Keychain`, so allow it to look unused there.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Memory(Mutex<HashMap<String, DeviceSecret>>),
}

impl SecretStore {
    /// In-memory store. Always available; used for tests and non-macOS.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub fn memory() -> Self {
        SecretStore::Memory(Mutex::new(HashMap::new()))
    }

    /// The default store for the current platform: Keychain on macOS, else
    /// an in-memory store (which causes secrets to remain inline in the JSON).
    fn platform_default() -> Self {
        #[cfg(target_os = "macos")]
        {
            SecretStore::Keychain
        }
        #[cfg(not(target_os = "macos"))]
        {
            SecretStore::memory()
        }
    }

    /// True when secrets can be persisted out-of-band (i.e. they need not be
    /// written into the JSON file). Only the Keychain backend qualifies; the
    /// in-memory store is process-local so its secrets must stay inline on disk.
    fn is_durable(&self) -> bool {
        match self {
            #[cfg(target_os = "macos")]
            SecretStore::Keychain => true,
            SecretStore::Memory(_) => false,
        }
    }

    fn get(&self, device_id: &str) -> Option<DeviceSecret> {
        match self {
            #[cfg(target_os = "macos")]
            SecretStore::Keychain => keychain_read_secret(device_id),
            SecretStore::Memory(map) => map.lock().ok()?.get(device_id).cloned(),
        }
    }

    fn put(&self, device_id: &str, secret: &DeviceSecret) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            SecretStore::Keychain => keychain_write_secret(device_id, secret),
            SecretStore::Memory(map) => {
                map.lock()
                    .map_err(|_| "secret store lock poisoned".to_string())?
                    .insert(device_id.to_string(), secret.clone());
                Ok(())
            }
        }
    }

    fn delete(&self, device_id: &str) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            SecretStore::Keychain => keychain_delete_secret(device_id),
            SecretStore::Memory(map) => {
                map.lock()
                    .map_err(|_| "secret store lock poisoned".to_string())?
                    .remove(device_id);
                Ok(())
            }
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
    /// base64 32-byte E2E key the device uses to encrypt relay traffic.
    #[serde(rename = "e2eKey")]
    pub e2e_key: String,
    /// Future relay device-auth token. Minted now and forwarded to the device
    /// so a later release can enforce per-device relay auth; not yet validated.
    #[serde(rename = "relayDeviceToken")]
    pub relay_device_token: String,
    #[serde(rename = "pairedDevice")]
    pub paired_device: PairedDevice,
}

pub struct PairingService {
    path: PathBuf,
    state: Mutex<PairingState>,
    secrets: SecretStore,
}

impl PairingService {
    /// Load (or initialize) the pairing service from a JSON file path, using
    /// the platform-default secret store (Keychain on macOS, in-memory else).
    pub fn load(path: PathBuf) -> Result<Self, String> {
        Self::load_with_store(path, SecretStore::platform_default())
    }

    /// Like [`load`](Self::load) but with an explicit secret backend. Tests pass
    /// [`SecretStore::memory`] so they never touch the real Keychain.
    pub fn load_with_store(path: PathBuf, secrets: SecretStore) -> Result<Self, String> {
        let mut state = match std::fs::read_to_string(&path) {
            Ok(text) if text.trim().is_empty() => PairingState::default(),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("parse {}: {}", path.display(), e))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => PairingState::default(),
            Err(e) => return Err(format!("read {}: {}", path.display(), e)),
        };

        // Migration: if a durable secret store is available and the loaded JSON
        // still carries inline secrets (legacy format), move them into the
        // store and rewrite the JSON without them.
        if secrets.is_durable() {
            let mut migrated = false;
            for device in &mut state.devices {
                let remote_token = device.remote_token.take();
                let e2e_key = device.e2e_key.take();
                if remote_token.is_some() || e2e_key.is_some() {
                    let mut secret = secrets.get(&device.device_id).unwrap_or_default();
                    if let Some(t) = remote_token {
                        if !t.is_empty() {
                            secret.remote_token = t;
                        }
                    }
                    if let Some(k) = e2e_key {
                        if !k.is_empty() {
                            secret.e2e_key = k;
                        }
                    }
                    secrets.put(&device.device_id, &secret)?;
                    migrated = true;
                }
            }
            if migrated {
                persist(&path, &state)?;
            }
        }

        Ok(Self {
            path,
            state: Mutex::new(state),
            secrets,
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
        let e2e_key = crate::crypto::generate_key_b64()
            .ok_or_else(|| "failed to generate e2e key".to_string())?;
        // Mint a per-device relay token now so a future release can require it
        // for relay auth. It is stored alongside the other secrets but not yet
        // enforced anywhere.
        let relay_device_token = hex(&random_bytes(REMOTE_TOKEN_BYTES)?);

        // Persist secrets out-of-band when the store is durable (Keychain);
        // otherwise leave them inline in the JSON for backward compatibility.
        let durable = self.secrets.is_durable();
        let secret = DeviceSecret {
            remote_token: remote_token.clone(),
            e2e_key: e2e_key.clone(),
            relay_device_token: relay_device_token.clone(),
        };
        if durable {
            self.secrets.put(&device_id, &secret)?;
        }
        let stored = StoredDevice {
            device_id,
            display_name: device_name.to_string(),
            remote_token: if durable { None } else { Some(remote_token.clone()) },
            e2e_key: if durable { None } else { Some(e2e_key.clone()) },
            paired_at_ms: now_ms,
            last_seen_at_ms: now_ms,
        };
        // Memory store also tracks the relay token so it survives within the
        // process even when secrets stay inline in the JSON.
        if !durable {
            self.secrets.put(&stored.device_id, &secret)?;
        }
        let public = stored.to_public();
        state.devices.push(stored);
        persist(&self.path, &state)?;
        Ok(PairingAcceptResponse {
            remote_token,
            e2e_key,
            relay_device_token,
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

    /// The base64 E2E key shared with a paired device, used to decrypt its
    /// relay traffic. `None` if the device is unknown or was paired before
    /// relay support (no key on record).
    pub fn e2e_key_for_device(&self, device_id: &str) -> Option<String> {
        {
            let state = self.state.lock().ok()?;
            // Device must be known.
            state.devices.iter().find(|d| d.device_id == device_id)?;
        }
        self.secret_for(device_id)
            .map(|s| s.e2e_key)
            .filter(|k| !k.is_empty())
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| "lock poisoned".to_string())?;
        let before = state.devices.len();
        state.devices.retain(|d| d.device_id != device_id);
        let removed = state.devices.len() != before;
        if removed {
            // Best-effort secret cleanup; a stale secret with no device entry
            // is unreachable, so don't fail the revoke if deletion errors.
            let _ = self.secrets.delete(device_id);
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
        // Find the device whose stored secret matches the presented token.
        // Resolve secrets without re-locking (`secret_in_state` reads the
        // already-held guard) to avoid a self-deadlock.
        let matched = state.devices.iter().position(|d| {
            self.secret_for_locked(&state, d)
                .map(|s| s.remote_token == remote_token)
                .unwrap_or(false)
        });
        match matched {
            None => Ok(None),
            Some(idx) => {
                state.devices[idx].last_seen_at_ms = now_ms;
                let public = state.devices[idx].to_public();
                persist(&self.path, &state)?;
                Ok(Some(public))
            }
        }
    }

    /// Resolve the secret bundle for a device: prefer the durable store, then
    /// fall back to any secrets still inline in the JSON (legacy / Memory).
    fn secret_for(&self, device_id: &str) -> Option<DeviceSecret> {
        if let Some(secret) = self.secrets.get(device_id) {
            return Some(secret);
        }
        let state = self.state.lock().ok()?;
        let device = state.devices.iter().find(|d| d.device_id == device_id)?;
        secret_from_inline(device)
    }

    /// Like [`secret_for`](Self::secret_for) but reads from an already-held
    /// state guard (the caller owns the lock), avoiding re-entrancy.
    fn secret_for_locked(&self, _state: &PairingState, device: &StoredDevice) -> Option<DeviceSecret> {
        if let Some(secret) = self.secrets.get(&device.device_id) {
            return Some(secret);
        }
        secret_from_inline(device)
    }
}

/// Build a secret bundle from inline JSON fields (legacy / Memory backend).
/// Returns `None` if no inline secret material is present.
fn secret_from_inline(device: &StoredDevice) -> Option<DeviceSecret> {
    let remote_token = device.remote_token.clone().unwrap_or_default();
    let e2e_key = device.e2e_key.clone().unwrap_or_default();
    if remote_token.is_empty() && e2e_key.is_empty() {
        return None;
    }
    Some(DeviceSecret {
        remote_token,
        e2e_key,
        relay_device_token: String::new(),
    })
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

// ---------------------------------------------------------------------------
// macOS Keychain backend for per-device secrets. Mirrors the Claude OAuth token
// storage in `lib.rs`: shell to `/usr/bin/security`, service =
// "Blackcrab Device Secret", account = device id. The secret value is a small
// JSON blob ({remoteToken, e2eKey, relayDeviceToken}).
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn keychain_read_secret(device_id: &str) -> Option<DeviceSecret> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            DEVICE_SECRET_SERVICE,
            "-a",
            device_id,
            "-w",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8(output.stdout).ok()?;
    serde_json::from_str(raw.trim()).ok()
}

#[cfg(target_os = "macos")]
fn keychain_write_secret(device_id: &str, secret: &DeviceSecret) -> Result<(), String> {
    let blob = serde_json::to_string(secret).map_err(|e| e.to_string())?;
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            DEVICE_SECRET_SERVICE,
            "-a",
            device_id,
            "-w",
            &blob,
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn keychain_delete_secret(device_id: &str) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-s",
            DEVICE_SECRET_SERVICE,
            "-a",
            device_id,
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("could not be found") || stderr.contains("not found") {
            return Ok(());
        }
        return Err(stderr.trim().to_string());
    }
    Ok(())
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

    // All tests use the in-memory secret store so they never touch the real
    // Keychain and stay hermetic on every platform (macOS included).
    fn fresh_service() -> (PairingService, PathBuf) {
        let path = temp_path();
        let _ = std::fs::remove_file(&path);
        let svc =
            PairingService::load_with_store(path.clone(), SecretStore::memory()).expect("load");
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
        // A relay device token is minted (groundwork; not yet enforced).
        assert_eq!(accept.relay_device_token.len(), REMOTE_TOKEN_BYTES * 2);
        assert_ne!(accept.relay_device_token, accept.remote_token);

        let reopened =
            PairingService::load_with_store(path.clone(), SecretStore::memory()).unwrap();
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
        let svc = PairingService::load_with_store(path.clone(), SecretStore::memory())
            .expect("first load");
        let start = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        svc.accept_pairing(&start.code, "Phone", 2_000).unwrap();
        drop(svc);
        let reopened =
            PairingService::load_with_store(path.clone(), SecretStore::memory()).unwrap();
        assert_eq!(reopened.list_devices().unwrap().len(), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn secrets_round_trip_through_inline_json_with_memory_store() {
        // With the Memory (non-durable) store, secrets stay inline in the JSON,
        // so a reopened service can still verify the remote token and serve the
        // e2e key — matching the pre-existing non-macOS behavior.
        let (svc, path) = fresh_service();
        let start = svc.start_pairing(1_000, PAIRING_DEFAULT_TTL_SECS).unwrap();
        let accept = svc.accept_pairing(&start.code, "Phone", 2_000).unwrap();
        drop(svc);

        let reopened =
            PairingService::load_with_store(path.clone(), SecretStore::memory()).unwrap();
        let found = reopened
            .verify_token(&accept.remote_token, 9_000)
            .unwrap()
            .expect("token recognized after reopen");
        assert_eq!(found.device_id, accept.paired_device.device_id);
        assert_eq!(
            reopened.e2e_key_for_device(&accept.paired_device.device_id),
            Some(accept.e2e_key.clone())
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn legacy_inline_secrets_are_verifiable() {
        // A pairings.json written by an older build keeps secrets inline. The
        // service must still verify the token and serve the e2e key from them.
        let path = temp_path();
        let legacy = serde_json::json!({
            "pending": [],
            "devices": [{
                "device_id": "dev_legacy",
                "display_name": "Old Phone",
                "remote_token": "deadbeef",
                "e2e_key": "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpoaWo=",
                "paired_at_ms": 1u128,
                "last_seen_at_ms": 1u128
            }]
        });
        std::fs::write(&path, serde_json::to_string(&legacy).unwrap()).unwrap();

        let svc =
            PairingService::load_with_store(path.clone(), SecretStore::memory()).unwrap();
        let found = svc
            .verify_token("deadbeef", 5_000)
            .unwrap()
            .expect("legacy token recognized");
        assert_eq!(found.device_id, "dev_legacy");
        assert_eq!(
            svc.e2e_key_for_device("dev_legacy"),
            Some("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpoaWo=".to_string())
        );
        let _ = std::fs::remove_file(&path);
    }
}
