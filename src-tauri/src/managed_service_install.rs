//! Native-only profile4 runtime publication; no commands or service activation.
#![cfg(any(target_os = "macos", target_os = "linux"))]
//! EmbeddedPayload must originate in trusted native selection (compiled pins).
//! Generic artifact consistency plus a caller-supplied JSON hash is NOT authority.
use crate::{
    managed_artifact,
    managed_payload::{self, EmbeddedPayload},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::{
    fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    io::AsRawFd,
};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
const MANIFEST: &str = "blackcrab-managed-host.json";
const OWNER_MARKER: &str = ".blackcrab-managed-host";
const PROFILE: &str = "blackcrab-local-service-layout-v1";
const REGISTRY: &str = include_str!("../../fork-integration/boot-service/registry.json");
#[derive(Debug, PartialEq, Eq)]
pub(super) enum InstallError {
    Owner,
    Selection,
    Profile,
    Exists,
    Io,
    Verification,
    Version,
    NotValidated,
}
type Result<T> = std::result::Result<T, InstallError>;
/// Opaque native capability: no serialized constructor, caller paths, commands or PIDs.
pub(super) struct SelectedServiceRuntime {
    owner: PathBuf,
    source: PathBuf,
    manifest: String,
    version: String,
}
pub(super) struct PublishedServiceRuntime {
    pub(super) version_directory: PathBuf,
    pub(super) entry: PathBuf,
    pub(super) manifest_sha256: String,
}
pub(super) struct ServiceInstallTransaction {
    selection: SelectedServiceRuntime,
    stage: Option<PathBuf>,
    _lease: File,
    validated: bool,
}
impl SelectedServiceRuntime {
    pub(super) fn from_embedded(owner: PathBuf, payload: &EmbeddedPayload) -> Result<Self> {
        check_owner(&owner)?;
        let expected = payload
            .expected_host_manifest_sha256()
            .ok_or(InstallError::Selection)?
            .to_owned();
        let source = payload
            .ensure_verified()
            .map_err(|_| InstallError::Selection)?;
        let artifact = managed_artifact::verify(&source).map_err(|_| InstallError::Selection)?;
        require_selected_manifest(&expected, &artifact.manifest_digest)?;
        check_profile(&source)?;
        Ok(Self {
            owner,
            source,
            manifest: artifact.manifest_digest,
            version: artifact.version,
        })
    }
    /// Feature capability derives only from this native-selected manifest.
    pub(super) fn supports_native_browser(&self) -> Result<bool> {
        let bytes=read_regular(&self.source.join(MANIFEST),64*1024*1024)?;
        if format!("{:x}",Sha256::digest(&bytes))!=self.manifest{return Err(InstallError::Verification);}
        let manifest:Value=serde_json::from_slice(&bytes).map_err(|_|InstallError::Profile)?;
        let registry:Value=serde_json::from_str(include_str!("../../fork-integration/boot-service/browser-channel/registry.json")).map_err(|_|InstallError::Profile)?;
        let actual=manifest["sourcePatches"].as_array().ok_or(InstallError::Profile)?;
        let patches=registry["patches"].as_array().ok_or(InstallError::Profile)?;
        let added=registry["addedSources"].as_array().ok_or(InstallError::Profile)?;
        if patches.len()!=3||added.len()!=1{return Err(InstallError::Profile);}
        Ok(patches.iter().chain(added.iter()).all(|record|actual.iter().any(|value|value["id"]==record["id"]&&value["sha256"]==record["sha256"])))
    }
    pub(super) fn version_directory(&self) -> PathBuf {
        self.owner.join("host/runtime/versions").join(&self.version)
    }
    pub(super) fn prepare(self) -> Result<ServiceInstallTransaction> {
        check_owner(&self.owner)?;
        let lease = managed_payload::owned_lock(&self.owner.join(".service-install.lock"), true)
            .map_err(|_| InstallError::Owner)?;
        if fs::symlink_metadata(self.version_directory()).is_ok() {
            return Err(InstallError::Exists);
        }
        let mut parent = self.owner.clone();
        for name in ["host", "runtime", "versions"] {
            parent.push(name);
            private_child(&parent)?;
        }
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).map_err(|_| InstallError::Io)?;
        let stage = parent.join(format!(
            ".native-install-{}",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&stage)
            .map_err(|_| InstallError::Io)?;
        managed_payload::private_dir(&stage).map_err(|_| InstallError::Owner)?;
        let transaction = ServiceInstallTransaction {
            selection: self,
            stage: Some(stage),
            _lease: lease,
            validated: false,
        };
        copy_payload(&transaction.selection.source, &transaction.payload())?;
        transaction.verify()?;
        Ok(transaction)
    }
}
impl ServiceInstallTransaction {
    fn directory(&self) -> &Path {
        self.stage.as_ref().expect("transaction staging is live")
    }
    pub(super) fn entry(&self) -> PathBuf {
        self.payload().join("t3")
    }
    fn payload(&self) -> PathBuf {
        self.directory().join("payload")
    }
    fn verify(&self) -> Result<()> {
        check_owner(&self.selection.owner)?;
        let artifact =
            managed_artifact::verify(&self.payload()).map_err(|_| InstallError::Verification)?;
        if artifact.manifest_digest != self.selection.manifest
            || artifact.version != self.selection.version
        {
            return Err(InstallError::Verification);
        }
        check_profile(&self.payload())
    }
    pub(super) fn validate_version(&mut self) -> Result<()> {
        if self.validated {
            return Err(InstallError::Version);
        }
        self.verify()?;
        let home = self.directory().join(".validation-home");
        private_child(&home)?;
        let result = run_original_version_validation(&self.entry(), &home, &self.selection.version);
        remove_owned_stage(&home);
        result?;
        self.verify()?;
        self.validated = true;
        Ok(())
    }
    pub(super) fn commit(self) -> Result<PublishedServiceRuntime> {
        self.commit_with_sync(|parent| {
            File::open(parent)
                .and_then(|f| f.sync_all())
                .map_err(|_| InstallError::Io)
        })
    }
    fn commit_with_sync(
        mut self,
        sync_parent: impl FnOnce(&Path) -> Result<()>,
    ) -> Result<PublishedServiceRuntime> {
        if !self.validated {
            return Err(InstallError::NotValidated);
        }
        self.verify()?;
        let target = self.selection.version_directory();
        if fs::symlink_metadata(&target).is_ok() {
            return Err(InstallError::Exists);
        }
        // Metadata is OUTSIDE payload. Publish only the complete durable wrapper.
        let layout = json!({"schema":1,"profile":PROFILE,"protocol":4,"version":self.selection.version,"manifestSha256":self.selection.manifest});
        write_private(
            &self.directory().join(".blackcrab-service-layout.json"),
            &serde_json::to_vec(&layout).map_err(|_| InstallError::Io)?,
        )?;
        write_private(
            &self.directory().join(".install-complete"),
            format!("{}\n", self.selection.version).as_bytes(),
        )?;
        managed_payload::sync_directories(self.directory()).map_err(|_| InstallError::Io)?;
        managed_payload::publish_no_replace(self.directory(), &target)
            .map_err(|_| InstallError::Exists)?;
        self.stage = None; // A failed post-publication fsync must never delete or retry the published tree.
        sync_parent(target.parent().ok_or(InstallError::Io)?)?;
        Ok(PublishedServiceRuntime {
            entry: target.join("payload/t3"),
            version_directory: target,
            manifest_sha256: self.selection.manifest.clone(),
        })
    }
}
impl Drop for ServiceInstallTransaction {
    fn drop(&mut self) {
        if let Some(stage) = &self.stage {
            remove_owned_stage(stage);
        }
    }
}
fn require_selected_manifest(expected: &str, actual: &str) -> Result<()> {
    if expected == actual {
        Ok(())
    } else {
        Err(InstallError::Selection)
    }
}
fn check_profile(root: &Path) -> Result<()> {
    let bytes = read_regular(&root.join(MANIFEST), 64 * 1024 * 1024)?;
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|_| InstallError::Profile)?;
    let registry: Value = serde_json::from_str(REGISTRY).map_err(|_| InstallError::Profile)?;
    let expected = registry["patches"]
        .as_array()
        .ok_or(InstallError::Profile)?;
    if expected.len() != 5 {
        return Err(InstallError::Profile);
    }
    let actual = manifest["sourcePatches"]
        .as_array()
        .ok_or(InstallError::Profile)?;
    if expected.iter().any(|record| {
        !actual
            .iter()
            .any(|value| value["id"] == record["id"] && value["sha256"] == record["sha256"])
    }) {
        return Err(InstallError::Profile);
    }
    Ok(())
}
#[cfg(unix)]
fn check_owner(root: &Path) -> Result<()> {
    if !root.is_absolute()
        || root.to_string_lossy().chars().any(char::is_control)
        || root.canonicalize().map_err(|_| InstallError::Owner)? != root
    {
        return Err(InstallError::Owner);
    }
    managed_payload::private_dir(root).map_err(|_| InstallError::Owner)?;
    let marker = root.join(OWNER_MARKER);
    let meta = fs::symlink_metadata(&marker).map_err(|_| InstallError::Owner)?;
    if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o777 != 0o600 {
        return Err(InstallError::Owner);
    }
    if read_regular(&marker, 64)? != b"blackcrab-managed-host-v1\n" {
        return Err(InstallError::Owner);
    }
    Ok(())
}
#[cfg(unix)]
fn private_child(path: &Path) -> Result<()> {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(InstallError::Io),
    }
    managed_payload::private_dir(path).map_err(|_| InstallError::Owner)
}
#[cfg(unix)]
fn read_regular(path: &Path, maximum: u64) -> Result<Vec<u8>> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| InstallError::Io)?;
    let meta = file.metadata().map_err(|_| InstallError::Io)?;
    if !meta.is_file() || meta.nlink() != 1 || meta.len() > maximum {
        return Err(InstallError::Verification);
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| InstallError::Io)?;
    if bytes.len() as u64 != meta.len() {
        return Err(InstallError::Verification);
    }
    Ok(bytes)
}
#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| InstallError::Io)?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| InstallError::Io)
}
#[cfg(unix)]
fn copy_payload(source: &Path, target: &Path) -> Result<()> {
    private_child(target)?;
    let mut count = 0usize;
    let mut bytes = 0u64;
    fn visit(
        source: &Path,
        target: &Path,
        depth: usize,
        count: &mut usize,
        bytes: &mut u64,
    ) -> Result<()> {
        if depth > 128 {
            return Err(InstallError::Verification);
        }
        for item in fs::read_dir(source).map_err(|_| InstallError::Io)? {
            let item = item.map_err(|_| InstallError::Io)?;
            let name = item.file_name();
            let text = name.to_str().ok_or(InstallError::Verification)?;
            if text.chars().any(char::is_control) {
                return Err(InstallError::Verification);
            }
            let input = item.path();
            let output = target.join(name);
            let meta = fs::symlink_metadata(&input).map_err(|_| InstallError::Io)?;
            *count += 1;
            if *count > 200_000 || meta.file_type().is_symlink() || meta.mode() & 0o7000 != 0 {
                return Err(InstallError::Verification);
            }
            if meta.is_dir() {
                private_child(&output)?;
                visit(&input, &output, depth + 1, count, bytes)?;
            } else if meta.is_file() && meta.nlink() == 1 {
                *bytes = bytes
                    .checked_add(meta.len())
                    .ok_or(InstallError::Verification)?;
                if *bytes > 8 * 1024 * 1024 * 1024 {
                    return Err(InstallError::Verification);
                }
                let source = OpenOptions::new()
                    .read(true)
                    .custom_flags(libc::O_NOFOLLOW)
                    .open(&input)
                    .map_err(|_| InstallError::Io)?;
                let mut out = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .custom_flags(libc::O_NOFOLLOW)
                    .open(&output)
                    .map_err(|_| InstallError::Io)?;
                let n = std::io::copy(&mut source.take(meta.len() + 1), &mut out)
                    .map_err(|_| InstallError::Io)?;
                if n != meta.len() {
                    return Err(InstallError::Verification);
                }
                out.set_permissions(fs::Permissions::from_mode(meta.mode() & 0o777))
                    .and_then(|_| out.sync_all())
                    .map_err(|_| InstallError::Io)?;
            } else {
                return Err(InstallError::Verification);
            }
        }
        let mode = fs::symlink_metadata(source).map_err(|_| InstallError::Io)?;
        if !mode.is_dir() || mode.file_type().is_symlink() || mode.mode() & 0o7000 != 0 {
            return Err(InstallError::Verification);
        }
        fs::set_permissions(target, fs::Permissions::from_mode(mode.mode() & 0o777))
            .map_err(|_| InstallError::Io)?;
        Ok(())
    }
    visit(source, target, 0, &mut count, &mut bytes)
}
fn js_space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn original_version_matches(stdout: &str, expected: &str) -> bool {
    let trimmed = stdout.trim_end_matches(js_space);
    for (index, c) in trimmed.char_indices() {
        if c != 'v'
            || index > 0 && trimmed.as_bytes()[index - 1].is_ascii_alphanumeric()
            || index > 0 && trimmed.as_bytes()[index - 1] == b'_'
        {
            continue;
        }
        let tail = &trimmed[index + 1..];
        if !tail.is_empty() && !tail.chars().any(js_space) {
            return tail == expected;
        }
    }
    false
}
#[cfg(unix)]
fn run_original_version_validation(entry: &Path, home: &Path, expected: &str) -> Result<()> {
    let mut child = Command::new(entry)
        .arg("--version")
        .current_dir(home)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", home)
        .env("TMPDIR", home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| InstallError::Version)?;
    let mut stdout = child.stdout.take().ok_or(InstallError::Version)?;
    let mut stderr = child.stderr.take().ok_or(InstallError::Version)?;
    for fd in [stdout.as_raw_fd(), stderr.as_raw_fd()] {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallError::Version);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut out = Vec::new();
    let mut err = Vec::new();
    fn drain(input: &mut impl Read, output: &mut Vec<u8>) -> Result<()> {
        let mut b = [0u8; 4096];
        loop {
            match input.read(&mut b) {
                Ok(0) => return Ok(()),
                Ok(n) => {
                    if output.len() + n > 65536 {
                        return Err(InstallError::Version);
                    }
                    output.extend_from_slice(&b[..n]);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
                Err(_) => return Err(InstallError::Version),
            }
        }
    }
    loop {
        if drain(&mut stdout, &mut out)
            .and_then(|_| drain(&mut stderr, &mut err))
            .is_err()
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallError::Version);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                drain(&mut stdout, &mut out)?;
                return if status.success()
                    && original_version_matches(
                        std::str::from_utf8(&out).map_err(|_| InstallError::Version)?,
                        expected,
                    ) {
                    Ok(())
                } else {
                    Err(InstallError::Version)
                };
            }
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(InstallError::Version);
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallError::Version);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[cfg(unix)]
fn remove_owned_stage(path: &Path) {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_dir() && !meta.file_type().is_symlink() {
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
            if let Ok(items) = fs::read_dir(path) {
                for item in items.flatten() {
                    remove_owned_stage(&item.path());
                }
            }
            let _ = fs::remove_dir(path);
        } else {
            let _ = fs::remove_file(path);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            remove_owned_stage(&self.root);
        }
    }
    impl Fixture {
        fn new() -> Self {
            let mut nonce = [0u8; 8];
            getrandom::getrandom(&mut nonce).unwrap();
            let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "blackcrab-service-publish-{}",
                u64::from_le_bytes(nonce)
            ));
            fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            Self { root }
        }
        fn embedded(
            &self,
            selected: &SelectedServiceRuntime,
            expected: &str,
            role: crate::managed_payload::PayloadRole,
        ) -> EmbeddedPayload {
            use flate2::{write::GzEncoder, Compression};
            let archive = self.root.join("fixture-payload.tar.gz");
            let mut builder = tar::Builder::new(GzEncoder::new(
                File::create(&archive).unwrap(),
                Compression::fast(),
            ));
            for item in fs::read_dir(&selected.source).unwrap() {
                let item = item.unwrap();
                if item.file_type().unwrap().is_dir() {
                    builder
                        .append_dir_all(item.file_name(), item.path())
                        .unwrap();
                } else {
                    builder
                        .append_path_with_name(item.path(), item.file_name())
                        .unwrap();
                }
            }
            builder.into_inner().unwrap().finish().unwrap();
            let digest = format!("{:x}", Sha256::digest(fs::read(&archive).unwrap()));
            EmbeddedPayload::new(
                role,
                archive,
                digest,
                expected.into(),
                self.root.join("opaque-cache"),
            )
            .unwrap()
        }
        fn selection(&self, script: &str, profile: bool) -> SelectedServiceRuntime {
            let owner = self.root.join("owner");
            private_child(&owner).unwrap();
            write_private(&owner.join(OWNER_MARKER), b"blackcrab-managed-host-v1\n").unwrap();
            let source = self.root.join("source");
            private_child(&source).unwrap();
            let mut records = Vec::new();
            for name in [
                "LICENSE.upstream",
                "THIRD-PARTY-NOTICES",
                "client/index.html",
                "resource-monitor/t3-resource-monitor",
                "t3",
            ] {
                let target = source.join(name);
                fs::create_dir_all(target.parent().unwrap()).unwrap();
                let bytes = if name == "t3" {
                    script.as_bytes()
                } else {
                    b"fixture"
                };
                fs::write(&target, bytes).unwrap();
                let executable = name == "t3" || name.starts_with("resource-monitor/");
                if executable {
                    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
                }
                records.push(json!({"path":name,"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(bytes)),"executable":executable}));
            }
            let registry: Value = serde_json::from_str(REGISTRY).unwrap();
            let patches: Vec<_> = if profile {
                registry["patches"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|r| json!({"id":r["id"],"sha256":r["sha256"]}))
                    .collect()
            } else {
                Vec::new()
            };
            let platform = if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            };
            let arch = if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "x64"
            };
            let manifest = json!({"schema":1,"kind":"blackcrab-managed-host","upstream":{"repository":"BonJenn/t3code","commit":"7f02de2eb8e253e0ec23f005b3cfff8e2c963be8","archiveSha256":"eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6"},"sourcePatches":patches,"runtime":{"platform":platform,"arch":arch,"version":"0.1.7"},"entry":"t3","client":"client/index.html","files":records});
            let bytes = serde_json::to_vec(&manifest).unwrap();
            fs::write(source.join(MANIFEST), &bytes).unwrap();
            SelectedServiceRuntime {
                owner,
                source,
                manifest: format!("{:x}", Sha256::digest(bytes)),
                version: "0.1.7".into(),
            }
        }
    }
    const VALID: &str = "#!/bin/sh\nprintf 't3code v0.1.7\\n'\n";
    #[test]
    fn browser_feature_requires_every_pin_from_the_selected_manifest() {
        let fixture=Fixture::new();let mut selection=fixture.selection(VALID,true);
        assert!(!selection.supports_native_browser().unwrap());
        let mut manifest:Value=serde_json::from_slice(&fs::read(selection.source.join(MANIFEST)).unwrap()).unwrap();
        let registry:Value=serde_json::from_str(include_str!("../../fork-integration/boot-service/browser-channel/registry.json")).unwrap();
        for record in registry["patches"].as_array().unwrap().iter().chain(registry["addedSources"].as_array().unwrap().iter()) {
            manifest["sourcePatches"].as_array_mut().unwrap().push(json!({"id":record["id"],"sha256":record["sha256"]}));
        }
        let bytes=serde_json::to_vec(&manifest).unwrap();fs::write(selection.source.join(MANIFEST),&bytes).unwrap();
        assert!(selection.supports_native_browser().is_err());
        selection.manifest=format!("{:x}",Sha256::digest(&bytes));assert!(selection.supports_native_browser().unwrap());
        manifest["sourcePatches"].as_array_mut().unwrap().pop();let bytes=serde_json::to_vec(&manifest).unwrap();
        fs::write(selection.source.join(MANIFEST),&bytes).unwrap();selection.manifest=format!("{:x}",Sha256::digest(bytes));
        assert!(!selection.supports_native_browser().unwrap());
    }
    #[test]
    fn synthetic_profile4_transaction_is_private_verified_and_durable() {
        let f = Fixture::new();
        let selection = f.selection(VALID, true);
        let expected = selection.manifest.clone();
        let final_dir = selection.version_directory();
        let mut transaction = selection.prepare().unwrap();
        assert!(!final_dir.exists());
        assert!(!transaction.payload().join(".install-complete").exists());
        transaction.validate_version().unwrap();
        let published = transaction.commit().unwrap();
        assert_eq!(published.version_directory, final_dir);
        assert_eq!(published.manifest_sha256, expected);
        assert!(published.entry.is_file());
        let marker: Value = serde_json::from_slice(
            &fs::read(final_dir.join(".blackcrab-service-layout.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(marker["protocol"], 4);
        assert_eq!(marker["manifestSha256"], expected);
        assert_eq!(
            fs::metadata(final_dir.join(".install-complete"))
                .unwrap()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            managed_artifact::verify(&final_dir.join("payload"))
                .unwrap()
                .manifest_digest,
            expected
        );
    }
    #[test]
    fn profile3_or_c21_metadata_is_not_service_authority() {
        let f = Fixture::new();
        let selection = f.selection(VALID, false);
        assert_eq!(selection.prepare().err(), Some(InstallError::Profile));
        assert!(!f.root.join("owner/host/runtime/versions/0.1.7").exists());
    }
    #[test]
    fn validation_failure_and_dropped_transaction_remove_only_own_stage() {
        let f = Fixture::new();
        let selection = f.selection("#!/bin/sh\necho t3code v9.9.9\n", true);
        let target = selection.version_directory();
        let mut transaction = selection.prepare().unwrap();
        let stage = transaction.directory().to_owned();
        assert_eq!(transaction.validate_version(), Err(InstallError::Version));
        drop(transaction);
        assert!(!stage.exists());
        assert!(!target.exists());
        assert!(f.root.join("source/t3").exists());
    }
    #[test]
    fn prepublication_tamper_and_existing_version_fail_closed() {
        let f = Fixture::new();
        let selection = f.selection(VALID, true);
        let target = selection.version_directory();
        let mut transaction = selection.prepare().unwrap();
        transaction.validate_version().unwrap();
        fs::write(transaction.payload().join("client/index.html"), b"tamper").unwrap();
        assert_eq!(transaction.commit().err(), Some(InstallError::Verification));
        assert!(!target.exists());
        fs::create_dir(&target).unwrap();
        fs::write(target.join("unrelated"), b"preserve").unwrap();
        let source = f.root.join("source");
        let artifact = managed_artifact::verify(&source).unwrap();
        let selected = SelectedServiceRuntime {
            owner: f.root.join("owner"),
            source,
            manifest: artifact.manifest_digest,
            version: artifact.version,
        };
        assert_eq!(selected.prepare().err(), Some(InstallError::Exists));
        assert_eq!(fs::read(target.join("unrelated")).unwrap(), b"preserve");
    }
    #[test]
    fn publication_requires_validation_and_never_adds_payload_sentinels() {
        let f = Fixture::new();
        let selection = f.selection(VALID, true);
        let target = selection.version_directory();
        assert_eq!(
            selection.prepare().unwrap().commit().err(),
            Some(InstallError::NotValidated)
        );
        assert!(!target.exists());
    }
    #[test]
    fn original_version_output_boundary_semantics() {
        for text in ["t3code v0.1.7\n", "prefix:v0.1.7\u{feff}", "v0.1.7"] {
            assert!(original_version_matches(text, "0.1.7"));
        }
        for text in [
            "v0.1.70",
            "av0.1.7",
            "v0.1.7 extra",
            "no version",
            "v0.1.7\nother",
        ] {
            assert!(!original_version_matches(text, "0.1.7"));
        }
    }
    #[test]
    fn marker_tampering_and_source_aliases_are_refused() {
        let f = Fixture::new();
        let selected = f.selection(VALID, true);
        fs::remove_file(selected.owner.join(OWNER_MARKER)).unwrap();
        std::os::unix::fs::symlink(
            selected.source.join(MANIFEST),
            selected.owner.join(OWNER_MARKER),
        )
        .unwrap();
        assert_eq!(selected.prepare().err(), Some(InstallError::Owner));
    }
    #[test]
    fn payload_directory_modes_are_preserved_inside_private_wrapper() {
        let f = Fixture::new();
        let selected = f.selection(VALID, true);
        fs::set_permissions(&selected.source, fs::Permissions::from_mode(0o751)).unwrap();
        fs::set_permissions(
            selected.source.join("client"),
            fs::Permissions::from_mode(0o750),
        )
        .unwrap();
        let transaction = selected.prepare().unwrap();
        assert_eq!(
            fs::metadata(transaction.directory()).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(transaction.payload()).unwrap().mode() & 0o777,
            0o751
        );
        assert_eq!(
            fs::metadata(transaction.payload().join("client"))
                .unwrap()
                .mode()
                & 0o777,
            0o750
        );
    }
    #[test]
    fn uncertain_postpublish_sync_never_removes_or_overwrites_published_runtime() {
        let f = Fixture::new();
        let selected = f.selection(VALID, true);
        let target = selected.version_directory();
        let source = selected.source.clone();
        let owner = selected.owner.clone();
        let manifest = selected.manifest.clone();
        let mut tx = selected.prepare().unwrap();
        tx.validate_version().unwrap();
        assert_eq!(
            tx.commit_with_sync(|_| Err(InstallError::Io)).err(),
            Some(InstallError::Io)
        );
        assert!(target.join("payload/t3").is_file());
        assert!(target.join(".install-complete").is_file());
        let retry = SelectedServiceRuntime {
            owner,
            source,
            manifest,
            version: "0.1.7".into(),
        };
        assert_eq!(retry.prepare().err(), Some(InstallError::Exists));
    }
    #[test]
    fn no_overwrite_preserves_a_racing_version_directory() {
        let f = Fixture::new();
        let selected = f.selection(VALID, true);
        let target = selected.version_directory();
        let mut tx = selected.prepare().unwrap();
        tx.validate_version().unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(target.join("foreign"), b"preserve").unwrap();
        assert_eq!(tx.commit().err(), Some(InstallError::Exists));
        assert_eq!(fs::read(target.join("foreign")).unwrap(), b"preserve");
    }
    #[test]
    fn independently_recomputed_manifest_cannot_replace_native_selection_anchor() {
        assert_eq!(
            require_selected_manifest(&"a".repeat(64), &"b".repeat(64)),
            Err(InstallError::Selection)
        );
        assert!(require_selected_manifest(&"a".repeat(64), &"a".repeat(64)).is_ok());
        let f = Fixture::new();
        let dummy = EmbeddedPayload::new(
            crate::managed_payload::PayloadRole::Desktop,
            f.root.join("not-an-archive"),
            "a".repeat(64),
            "b".repeat(64),
            f.root.join("cache"),
        )
        .unwrap();
        assert_eq!(dummy.expected_host_manifest_sha256(), None);
    }
    #[test]
    fn opaque_native_factory_requires_host_role_compiled_digest_and_all_five_records() {
        {
            let f = Fixture::new();
            let source = f.selection(VALID, true);
            let payload = f.embedded(
                &source,
                &source.manifest,
                crate::managed_payload::PayloadRole::Host,
            );
            let selected =
                SelectedServiceRuntime::from_embedded(source.owner.clone(), &payload).unwrap();
            assert_eq!(selected.manifest, source.manifest);
            assert_eq!(selected.version, "0.1.7");
            assert!(!selected.version_directory().exists());
        }
        {
            let f = Fixture::new();
            let source = f.selection(VALID, true);
            let payload = f.embedded(
                &source,
                &source.manifest,
                crate::managed_payload::PayloadRole::Desktop,
            );
            assert_eq!(
                SelectedServiceRuntime::from_embedded(source.owner.clone(), &payload).err(),
                Some(InstallError::Selection)
            );
            assert!(!source.owner.join("host").exists());
        }
        {
            let f = Fixture::new();
            let source = f.selection(VALID, true);
            let payload = f.embedded(
                &source,
                &"a".repeat(64),
                crate::managed_payload::PayloadRole::Host,
            );
            assert_eq!(
                SelectedServiceRuntime::from_embedded(source.owner.clone(), &payload).err(),
                Some(InstallError::Selection)
            );
            assert!(!source.owner.join("host").exists());
        }
        {
            let f = Fixture::new();
            let source = f.selection(VALID, false);
            let payload = f.embedded(
                &source,
                &source.manifest,
                crate::managed_payload::PayloadRole::Host,
            );
            assert_eq!(
                SelectedServiceRuntime::from_embedded(source.owner.clone(), &payload).err(),
                Some(InstallError::Profile)
            );
            assert!(!source.owner.join("host").exists());
        }
    }
}
