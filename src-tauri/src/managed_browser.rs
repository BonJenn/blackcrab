//! Private, per-host native-browser capability. Never exposed to a renderer.
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_GENERATION: u64 = 9_007_199_254_740_991;
const PREFIX: &str = "blackcrab-browser-";
const MARKER: &str = ".blackcrab-browser-owner.json";

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Capability {
    pub(super) path: PathBuf,
    pub(super) key: String,
    pub(super) generation: u64,
}
impl std::fmt::Debug for Capability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BrowserCapability")
            .field("path", &self.path)
            .field("generation", &self.generation)
            .field("key", &"[redacted]")
            .finish()
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    schema: u32,
    owner: PathBuf,
}
fn refused() -> String {
    "Private native browser capability was refused".into()
}
fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[cfg(unix)]
fn private_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let stat = fs::symlink_metadata(path).map_err(|_| refused())?;
    if !stat.is_dir()
        || stat.uid() != unsafe { libc::geteuid() }
        || stat.mode() & 0o777 != 0o700
        || fs::canonicalize(path).map_err(|_| refused())? != path
    {
        return Err(refused());
    }
    Ok(())
}
#[cfg(unix)]
fn base() -> Result<PathBuf, String> {
    // Keep Unix socket paths short, independently of application-data paths.
    fs::canonicalize(if cfg!(target_os = "macos") {
        "/private/tmp"
    } else {
        "/tmp"
    })
    .map_err(|_| refused())
}

#[cfg(unix)]
impl Capability {
    pub(super) fn allocate(owner: &Path) -> Result<Self, String> {
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        let owner = fs::canonicalize(owner).map_err(|_| refused())?;
        private_directory(&owner)?;
        let mut bytes = [0u8; 56];
        getrandom::getrandom(&mut bytes).map_err(|_| refused())?;
        let hex = |input: &[u8]| input.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let directory = base()?.join(format!("{PREFIX}{}", hex(&bytes[..16])));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .map_err(|_| refused())?;
        let result = (|| {
            let marker = serde_json::to_vec(&Marker { schema: 1, owner }).map_err(|_| refused())?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(directory.join(MARKER))
                .map_err(|_| refused())?;
            file.write_all(&marker).map_err(|_| refused())?;
            Ok(Self {
                path: directory.join("b.sock"),
                key: hex(&bytes[16..48]),
                generation: u64::from_be_bytes(bytes[48..56].try_into().unwrap()) % MAX_GENERATION
                    + 1,
            })
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(directory);
        }
        result
    }

    fn validate_location(&self, owner: &Path) -> Result<PathBuf, String> {
        if !lower_hex(&self.key, 64)
            || !(1..=MAX_GENERATION).contains(&self.generation)
            || !self.path.is_absolute()
            || self.path.as_os_str().as_encoded_bytes().len() > 100
            || self.path.file_name().and_then(|s| s.to_str()) != Some("b.sock")
        {
            return Err(refused());
        }
        let directory = self.path.parent().ok_or_else(refused)?;
        if directory.parent() != Some(base()?.as_path())
            || !directory
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|s| s.strip_prefix(PREFIX))
                .is_some_and(|s| lower_hex(s, 32))
        {
            return Err(refused());
        }
        let owner = fs::canonicalize(owner).map_err(|_| refused())?;
        private_directory(&owner)?;
        Ok(owner)
    }

    /// A reboot may remove the whole temporary directory while the native
    /// configuration remains valid. Restore only that absence, never repair or
    /// replace an existing untrusted directory/marker/socket. The secret and
    /// generation remain in the original private configuration, unchanged.
    pub(super) fn ensure_runtime_directory(&self, owner: &Path) -> Result<(), String> {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let owner = self.validate_location(owner)?;
        let directory = self.path.parent().ok_or_else(refused)?;
        match fs::symlink_metadata(directory) {
            Ok(_) => return self.validate(&owner),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(refused()),
        }
        let stage = tempfile::Builder::new()
            .prefix("blackcrab-browser-recovery-")
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir_in(base()?)
            .map_err(|_| refused())?;
        private_directory(stage.path())?;
        let marker = serde_json::to_vec(&Marker {
            schema: 1,
            owner: owner.clone(),
        })
        .map_err(|_| refused())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(stage.path().join(MARKER))
            .map_err(|_| refused())?;
        file.write_all(&marker)
            .and_then(|_| file.sync_all())
            .map_err(|_| refused())?;
        drop(file);
        // A complete private directory is published atomically without replacing
        // even an empty competitor. Concurrent valid restorers may win the race;
        // in all cases the destination must pass the original strict checks.
        let _ = crate::managed_payload::publish_no_replace(stage.path(), directory);
        self.validate(&owner)
    }

    pub(super) fn validate(&self, owner: &Path) -> Result<(), String> {
        use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt};
        let owner = self.validate_location(owner)?;
        let directory = self.path.parent().ok_or_else(refused)?;
        private_directory(directory)?;
        let marker_path = directory.join(MARKER);
        let stat = fs::symlink_metadata(&marker_path).map_err(|_| refused())?;
        if !stat.is_file()
            || stat.nlink() != 1
            || stat.uid() != unsafe { libc::geteuid() }
            || stat.mode() & 0o777 != 0o600
            || stat.len() > 4096
        {
            return Err(refused());
        }
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(marker_path)
            .map_err(|_| refused())?;
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| refused())?;
        if bytes.len() > 4096 {
            return Err(refused());
        }
        let marker: Marker = serde_json::from_slice(&bytes).map_err(|_| refused())?;
        if marker.schema != 1 || marker.owner != owner {
            return Err(refused());
        }
        match fs::symlink_metadata(&self.path) {
            Ok(stat)
                if stat.file_type().is_socket()
                    && stat.uid() == unsafe { libc::geteuid() }
                    && stat.mode() & 0o777 == 0o600 =>
            {
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err(refused()),
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    struct Fixture {
        owner: PathBuf,
        capability: Capability,
    }
    impl Fixture {
        fn new() -> Self {
            let mut nonce = [0u8; 16];
            getrandom::getrandom(&mut nonce).unwrap();
            let name = nonce.iter().map(|b| format!("{b:02x}")).collect::<String>();
            let owner = base()
                .unwrap()
                .join(format!("blackcrab-browser-test-{name}"));
            fs::DirBuilder::new().mode(0o700).create(&owner).unwrap();
            let capability = Capability::allocate(&owner).unwrap();
            Self { owner, capability }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(self.capability.path.parent().unwrap());
            let _ = fs::remove_dir_all(&self.owner);
        }
    }
    #[test]
    fn managed_browser_recovery_preserves_existing_socket_and_identity() {
        use std::os::unix::fs::MetadataExt;
        let f = Fixture::new();
        let directory = f.capability.path.parent().unwrap();
        fs::remove_dir_all(directory).unwrap();
        f.capability.ensure_runtime_directory(&f.owner).unwrap();
        f.capability.validate(&f.owner).unwrap();
        let socket = std::os::unix::net::UnixListener::bind(&f.capability.path).unwrap();
        fs::set_permissions(&f.capability.path, fs::Permissions::from_mode(0o600)).unwrap();
        let inode = fs::metadata(&f.capability.path).unwrap().ino();
        let marker = fs::read(directory.join(MARKER)).unwrap();
        f.capability.ensure_runtime_directory(&f.owner).unwrap();
        assert_eq!(fs::metadata(&f.capability.path).unwrap().ino(), inode);
        assert!(fs::read(directory.join(MARKER)).unwrap() == marker);
        drop(socket);
    }
    #[test]
    fn managed_browser_recovery_never_replaces_untrusted_existing_entries() {
        for variant in 0..5 {
            let f = Fixture::new();
            let directory = f.capability.path.parent().unwrap();
            match variant {
                0 => {
                    fs::remove_file(directory.join(MARKER)).unwrap();
                }
                1 => {
                    fs::set_permissions(directory, fs::Permissions::from_mode(0o755)).unwrap();
                }
                2 => {
                    fs::write(directory.join(MARKER), b"invalid marker").unwrap();
                }
                3 => {
                    fs::write(&f.capability.path, b"not a socket").unwrap();
                }
                _ => {
                    fs::remove_dir_all(directory).unwrap();
                    std::os::unix::fs::symlink(&f.owner, directory).unwrap();
                }
            }
            assert!(f.capability.ensure_runtime_directory(&f.owner).is_err());
            // No deletion/replacement can turn the same unsafe state into valid.
            assert!(f.capability.validate(&f.owner).is_err());
            if variant == 0 {
                assert!(!directory.join(MARKER).exists());
            }
            if variant == 4 {
                assert!(fs::symlink_metadata(directory)
                    .unwrap()
                    .file_type()
                    .is_symlink());
            }
        }
    }
    #[test]
    fn managed_browser_concurrent_recovery_publishes_one_complete_directory() {
        let f = Fixture::new();
        fs::remove_dir_all(f.capability.path.parent().unwrap()).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let barrier = barrier.clone();
                let cap = f.capability.clone();
                let owner = f.owner.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    cap.ensure_runtime_directory(&owner)
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap().unwrap();
        }
        f.capability.validate(&f.owner).unwrap();
    }
    #[test]
    fn managed_browser_recovery_validates_location_before_creating_anything() {
        let f = Fixture::new();
        fs::remove_dir_all(f.capability.path.parent().unwrap()).unwrap();
        let mut cap = f.capability.clone();
        cap.generation = 0;
        assert!(cap.ensure_runtime_directory(&f.owner).is_err());
        assert!(!f.capability.path.parent().unwrap().exists());
        fs::set_permissions(&f.owner, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(f.capability.ensure_runtime_directory(&f.owner).is_err());
        assert!(!f.capability.path.parent().unwrap().exists());
    }
    #[test]
    fn managed_browser_capability_is_private_fresh_and_redacted() {
        let f = Fixture::new();
        f.capability.validate(&f.owner).unwrap();
        let other = Capability::allocate(&f.owner).unwrap();
        assert_ne!(other.key, f.capability.key);
        assert_ne!(other.path, f.capability.path);
        assert_ne!(other.generation, f.capability.generation);
        assert!(!format!("{:?}", f.capability).contains(&f.capability.key));
        fs::remove_dir_all(other.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn managed_browser_requires_actual_private_socket_or_absence() {
        let f = Fixture::new();
        let socket = std::os::unix::net::UnixListener::bind(&f.capability.path).unwrap();
        fs::set_permissions(&f.capability.path, fs::Permissions::from_mode(0o600)).unwrap();
        f.capability.validate(&f.owner).unwrap();
        fs::set_permissions(&f.capability.path, fs::Permissions::from_mode(0o640)).unwrap();
        assert!(f.capability.validate(&f.owner).is_err());
        drop(socket);
        fs::remove_file(&f.capability.path).unwrap();
        std::os::unix::fs::symlink(f.owner.join("untouched"), &f.capability.path).unwrap();
        assert!(f.capability.validate(&f.owner).is_err());
        assert!(!f.owner.join("untouched").exists());
    }
    #[test]
    fn managed_browser_rejects_wrong_owner_key_generation_and_directory() {
        let f = Fixture::new();
        let other = Fixture::new();
        assert!(f.capability.validate(&other.owner).is_err());
        for generation in [0, MAX_GENERATION + 1] {
            let mut cap = f.capability.clone();
            cap.generation = generation;
            assert!(cap.validate(&f.owner).is_err());
        }
        let mut cap = f.capability.clone();
        cap.key = "A".repeat(64);
        assert!(cap.validate(&f.owner).is_err());
        cap = f.capability.clone();
        cap.path = cap.path.with_file_name("other.sock");
        assert!(cap.validate(&f.owner).is_err());
        fs::set_permissions(
            f.capability.path.parent().unwrap(),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(f.capability.validate(&f.owner).is_err());
    }
}
