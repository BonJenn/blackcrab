//! Opaque embedded payload adoption. No renderer-supplied paths or process authority.
//! Native startup supplies an existing trusted parent for a dedicated cache root.
//! Existing unmarked roots/caches are never adopted, replaced, or removed.
//! Unix private-directory ownership and flock are required; other targets fail closed.
use flate2::read::MultiGzDecoder;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
};
const COMPRESSED: u64 = 4 * 1024 * 1024 * 1024;
const EXPANDED: u64 = 12 * 1024 * 1024 * 1024;
const ENTRIES: usize = 250_000;
const META: u64 = 65_536;
const MARKER: &str = ".blackcrab-managed-payload-cache-v1";
fn invalid() -> String {
    "Bundled payload is unavailable or failed verification.".into()
}
#[derive(Clone, Copy, Debug)]
pub enum PayloadRole {
    Host,
    Desktop,
}
impl PayloadRole {
    fn name(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Desktop => "desktop",
        }
    }
    fn manifest(self) -> &'static str {
        match self {
            Self::Host => "blackcrab-managed-host.json",
            Self::Desktop => "blackcrab-managed-desktop.json",
        }
    }
}
#[derive(Clone)]
pub struct EmbeddedPayload {
    role: PayloadRole,
    archive: PathBuf,
    archive_sha256: String,
    manifest_sha256: String,
    cache_root: PathBuf,
}
fn digest_ok(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|x| x.is_ascii_digit() || (b'a'..=b'f').contains(&x))
}
impl EmbeddedPayload {
    pub fn new(
        role: PayloadRole,
        archive: PathBuf,
        archive_sha256: String,
        manifest_sha256: String,
        cache_root: PathBuf,
    ) -> Result<Self, String> {
        if !cfg!(unix)
            || !digest_ok(&archive_sha256)
            || !digest_ok(&manifest_sha256)
            || !archive.is_absolute()
            || !cache_root.is_absolute()
        {
            return Err(invalid());
        }
        #[cfg(unix)]
        {
            initialize_cache_root(&cache_root)?;
        }
        Ok(Self {
            role,
            archive,
            archive_sha256,
            manifest_sha256,
            cache_root,
        })
    }
    /// Native selection anchor only; generic artifact digests cannot replace it.
    pub(super) fn expected_host_manifest_sha256(&self) -> Option<&str> {
        match self.role {
            PayloadRole::Host => Some(&self.manifest_sha256),
            PayloadRole::Desktop => None,
        }
    }
    pub fn target_directory(&self) -> PathBuf {
        self.cache_root.join(format!(
            "{}-{}-{}",
            self.role.name(),
            self.manifest_sha256,
            self.archive_sha256
        ))
    }
    pub fn ensure_verified(&self) -> Result<PathBuf, String> {
        self.ensure_with(|root| {
            let manifest = root.join(self.role.manifest());
            let mut file = regular(&manifest)?;
            if file.metadata().map_err(|_| invalid())?.len() > 64 * 1024 * 1024 {
                return Err(invalid());
            }
            if hash(&mut file, 64 * 1024 * 1024)? != self.manifest_sha256 {
                return Err(invalid());
            }
            match self.role {
                PayloadRole::Host => {
                    let v = crate::managed_artifact::verify(root).map_err(|_| invalid())?;
                    if v.manifest_digest != self.manifest_sha256 {
                        return Err(invalid());
                    }
                }
                PayloadRole::Desktop => {
                    crate::managed_desktop::verify_package(root, &self.manifest_sha256)
                        .map_err(|_| invalid())?;
                }
            }
            Ok(())
        })
    }
    #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
    pub(crate) fn check_reviewed_native_keychain_qa(
        &self,
        permit: &crate::managed_native_entry::acceptance::keychain_qa::ReviewedQaPermit,
    ) -> Result<(), String> {
        let pins = permit.pins();
        if !matches!(self.role, PayloadRole::Desktop)
            || self.manifest_sha256 != pins.manifest_sha256
            || self.archive_sha256 != pins.archive_sha256
        {
            return Err(invalid());
        }
        Ok(())
    }
    #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
    pub(crate) fn ensure_reviewed_native_keychain_qa(
        &self,
        permit: &crate::managed_native_entry::acceptance::keychain_qa::ReviewedQaPermit,
    ) -> Result<PathBuf, String> {
        self.check_reviewed_native_keychain_qa(permit)?;
        self.ensure_with(|root| {
            crate::managed_desktop::verify_reviewed_keychain_qa_package(root, permit)
                .map(|_| ())
                .map_err(|_| invalid())
        })
    }
    #[cfg(unix)]
    fn ensure_with(&self, verify: impl Fn(&Path) -> Result<(), String>) -> Result<PathBuf, String> {
        let _lease = cache_lease(&self.cache_root)?;
        let target = self.target_directory();
        if fs::symlink_metadata(&target).is_ok() {
            private_dir(&target)?;
            verify(&target)?;
            return Ok(target);
        }
        // Hash and decode the SAME open file description. No reopen by archive path after trust.
        let mut archive = regular(&self.archive)?;
        if archive.metadata().map_err(|_| invalid())?.len() > COMPRESSED {
            return Err(invalid());
        }
        if hash(&mut archive, COMPRESSED)? != self.archive_sha256 {
            return Err(invalid());
        }
        archive.seek(SeekFrom::Start(0)).map_err(|_| invalid())?;
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).map_err(|_| invalid())?;
        let staging = self.cache_root.join(format!(
            ".staging-{}",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        fs::create_dir(&staging).map_err(|_| invalid())?;
        fs::set_permissions(&staging, fs::Permissions::from_mode(0o700)).map_err(|_| invalid())?;
        let mut guard = Staging(Some(staging.clone()));
        extract(archive, &staging)?;
        verify(&staging)?;
        let tree_commit = sync_extracted_tree(&staging, &self.cache_root)?;
        #[cfg(all(test, target_os = "macos"))]
        tree_commit_test_point("publish").map_err(|_| invalid())?;
        publish_no_replace(&staging, &target)?;
        guard.0 = None;
        // Failure here is an uncertain durable rename, NOT permission to overwrite
        // or remove an already verified target. No successful adoption is returned.
        sync_extracted_parent(&self.cache_root, &tree_commit)?;
        Ok(target)
    }
    #[cfg(not(unix))]
    fn ensure_with(
        &self,
        _verify: impl Fn(&Path) -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        Err(invalid())
    }
}
struct Staging(Option<PathBuf>);
impl Drop for Staging {
    fn drop(&mut self) {
        if let Some(p) = &self.0 {
            make_removable(p);
            let _ = fs::remove_dir_all(p);
        }
    }
}
#[cfg(unix)]
fn make_removable(root: &Path) {
    let Ok(meta) = fs::symlink_metadata(root) else {
        return;
    };
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return;
    }
    let _ = fs::set_permissions(root, fs::Permissions::from_mode(0o700));
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            make_removable(&entry.path());
        }
    }
}
#[cfg(not(unix))]
fn make_removable(_: &Path) {}

fn hash(file: &mut File, limit: u64) -> Result<String, String> {
    let mut h = Sha256::new();
    let mut total = 0;
    let mut b = [0u8; 65536];
    loop {
        let n = file.read(&mut b).map_err(|_| invalid())?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > limit {
            return Err(invalid());
        }
        h.update(&b[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
#[cfg(unix)]
fn regular(path: &Path) -> Result<File, String> {
    let f = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| invalid())?;
    let m = f.metadata().map_err(|_| invalid())?;
    if !m.is_file() || m.nlink() != 1 {
        return Err(invalid());
    }
    Ok(f)
}
#[cfg(not(unix))]
fn regular(_path: &Path) -> Result<File, String> {
    Err(invalid())
}
// POSIX UID/mode bits do not establish a private cache on a macOS volume
// mounted with ownership ignored. Archive resources may live there; executable
// cache state and its initialization lease must live on an ownership-aware volume.
#[cfg(target_os = "macos")]
pub(super) fn ownership_filesystem(path: &Path) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| invalid())?;
    let mut information = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::fstatfs(directory.as_raw_fd(), information.as_mut_ptr()) } != 0 {
        return Err(invalid());
    }
    // Public Darwin sys/mount.h: MNT_IGNORE_OWNERSHIP (MNT_UNKNOWNPERMISSIONS).
    const IGNORE_OWNERSHIP: u32 = 0x0020_0000;
    if unsafe { information.assume_init() }.f_flags & IGNORE_OWNERSHIP != 0 {
        return Err(invalid());
    }
    Ok(())
}
#[cfg(all(unix, not(target_os = "macos")))]
pub(super) fn ownership_filesystem(_path: &Path) -> Result<(), String> {
    Ok(())
}
#[cfg(unix)]
pub(super) fn private_dir(path: &Path) -> Result<(), String> {
    ownership_filesystem(path)?;
    let m = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if !m.is_dir()
        || m.file_type().is_symlink()
        || m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o077 != 0
    {
        return Err(invalid());
    }
    Ok(())
}
// Native-private initialization and use are separately leased. A complete marked
// directory is atomically published; another constructor never observes an
// unmarked root from us and no existing user directory is adopted/replaced.
#[cfg(unix)]
fn bounded_lock(file: &File) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if unsafe {
            libc::flock(
                std::os::fd::AsRawFd::as_raw_fd(file),
                libc::LOCK_EX | libc::LOCK_NB,
            )
        } == 0
        {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if !matches!(
            error.raw_os_error(),
            Some(libc::EWOULDBLOCK) | Some(libc::EINTR)
        ) {
            return Err(invalid());
        }
        if std::time::Instant::now() >= deadline {
            return Err(invalid());
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}
#[cfg(unix)]
pub(super) fn owned_lock(path: &Path, create: bool) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| invalid())?;
    let meta = file.metadata().map_err(|_| invalid())?;
    if !meta.is_file()
        || meta.nlink() != 1
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o777 != 0o600
    {
        return Err(invalid());
    }
    bounded_lock(&file)?;
    let current = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if current.file_type().is_symlink()
        || current.dev() != meta.dev()
        || current.ino() != meta.ino()
    {
        return Err(invalid());
    }
    Ok(file)
}
#[cfg(unix)]
fn initialize_cache_root(root: &Path) -> Result<(), String> {
    let mut prefix = PathBuf::new();
    for component in root.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err(invalid());
        }
        prefix.push(component.as_os_str());
        if let Ok(meta) = fs::symlink_metadata(&prefix) {
            if meta.file_type().is_symlink() {
                return Err(invalid());
            }
        }
    }
    let parent = root.parent().ok_or_else(invalid)?;
    ownership_filesystem(parent)?;
    let parent_meta = fs::symlink_metadata(parent).map_err(|_| invalid())?;
    if !parent_meta.is_dir()
        || parent_meta.uid() != unsafe { libc::geteuid() }
        || parent_meta.mode() & 0o022 != 0
    {
        return Err(invalid());
    }
    if fs::symlink_metadata(root).is_ok() {
        private_dir(root)?;
        verify_marker(root)?;
    }
    use std::os::unix::ffi::OsStrExt;
    let key = format!(
        "{:x}",
        Sha256::digest(root.file_name().ok_or_else(invalid)?.as_bytes())
    );
    let _initialization = owned_lock(
        &parent.join(format!(".blackcrab-payload-init-{}.lock", &key[..24])),
        true,
    )?;
    match fs::symlink_metadata(root) {
        Ok(_) => {
            private_dir(root)?;
            verify_marker(root)?;
            return Ok(());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(invalid()),
    }
    let mut nonce = [0u8; 16];
    getrandom::getrandom(&mut nonce).map_err(|_| invalid())?;
    let stage = parent.join(format!(
        ".payload-cache-init-{}",
        nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&stage)
        .map_err(|_| invalid())?;
    let mut guard = Staging(Some(stage.clone()));
    let mut marker = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(stage.join(MARKER))
        .map_err(|_| invalid())?;
    marker
        .write_all(b"blackcrab-payload-cache-v1\n")
        .and_then(|_| marker.sync_all())
        .map_err(|_| invalid())?;
    drop(owned_lock(&stage.join(".lease"), true)?);
    File::open(&stage)
        .and_then(|f| f.sync_all())
        .map_err(|_| invalid())?;
    publish_no_replace(&stage, root)?;
    guard.0 = None;
    File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|_| invalid())?;
    private_dir(root)?;
    verify_marker(root)
}
#[cfg(unix)]
fn cache_lease(root: &Path) -> Result<File, String> {
    initialize_cache_root(root)?;
    let lease = owned_lock(&root.join(".lease"), false)?;
    private_dir(root)?;
    verify_marker(root)?;
    Ok(lease)
}
#[cfg(unix)]
pub(super) fn publish_no_replace(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;
    let from = std::ffi::CString::new(from.as_os_str().as_bytes()).map_err(|_| invalid())?;
    let to = std::ffi::CString::new(to.as_os_str().as_bytes()).map_err(|_| invalid())?;
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let result = -1;
    if result == 0 {
        Ok(())
    } else {
        Err(invalid())
    }
}
#[cfg(unix)]
fn verify_marker(root: &Path) -> Result<(), String> {
    let mut f = regular(&root.join(MARKER))?;
    let m = f.metadata().map_err(|_| invalid())?;
    if m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o077 != 0
        || m.len() != b"blackcrab-payload-cache-v1\n".len() as u64
    {
        return Err(invalid());
    }
    let mut b = String::new();
    f.read_to_string(&mut b).map_err(|_| invalid())?;
    if b != "blackcrab-payload-cache-v1\n" {
        return Err(invalid());
    }
    Ok(())
}

fn safe_path(s: &str) -> Result<PathBuf, String> {
    if s.is_empty()
        || s.len() > 4096
        || s.chars().any(|c| c.is_control())
        || s.contains('\\')
        || s.contains(':')
        || s.starts_with('/')
    {
        return Err(invalid());
    }
    let s = s.strip_suffix('/').unwrap_or(s);
    if s.split('/').count() > 128 {
        return Err(invalid());
    }
    if s.is_empty() || s.split('/').any(|c| c.is_empty() || c == "." || c == "..") {
        return Err(invalid());
    }
    Ok(PathBuf::from(s))
}
fn parents(root: &Path, path: &Path) -> Result<usize, String> {
    let mut created = 0;
    let mut at = root.to_owned();
    if let Some(parent) = path.parent() {
        for p in parent.components() {
            at.push(p);
            match fs::symlink_metadata(&at) {
                Ok(m) if m.is_dir() && !m.file_type().is_symlink() => {}
                Ok(_) => return Err(invalid()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&at).map_err(|_| invalid())?;
                    created += 1;
                }
                Err(_) => return Err(invalid()),
            }
        }
    }
    Ok(created)
}
struct Bounded<R> {
    inner: R,
    total: u64,
}
impl<R: Read> Read for Bounded<R> {
    fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(b)?;
        self.total += n as u64;
        if self.total > EXPANDED {
            return Err(std::io::Error::other("payload bound"));
        }
        Ok(n)
    }
}
#[cfg(unix)]
fn extract(file: File, root: &Path) -> Result<(), String> {
    let decoder = MultiGzDecoder::new(file);
    let mut archive = tar::Archive::new(Bounded {
        inner: decoder,
        total: 0,
    });
    let mut names = HashSet::new();
    let mut links = HashMap::<PathBuf, String>::new();
    let mut pending = HashMap::<String, String>::new();
    let mut metadata = 0u64;
    let mut count = 0;
    let mut bytes = 0u64;
    let mut indexed_bytes = 0usize;
    let mut output_nodes = 0usize;
    for entry in archive.entries().map_err(|_| invalid())?.raw(true) {
        let mut entry = entry.map_err(|_| invalid())?;
        count += 1;
        if count > ENTRIES {
            return Err(invalid());
        }
        let kind = entry.header().entry_type();
        if kind.is_pax_local_extensions() || kind.is_gnu_longname() || kind.is_gnu_longlink() {
            if entry.size() > META {
                return Err(invalid());
            }
            metadata += entry.size();
            if metadata > 16 * 1024 * 1024 {
                return Err(invalid());
            }
            let mut b = Vec::new();
            entry.read_to_end(&mut b).map_err(|_| invalid())?;
            if kind.is_pax_local_extensions() {
                for ext in tar::PaxExtensions::new(&b) {
                    let ext = ext.map_err(|_| invalid())?;
                    let key = ext.key().map_err(|_| invalid())?;
                    let value = ext.value().map_err(|_| invalid())?;
                    if ![
                        "path",
                        "linkpath",
                        "size",
                        "mtime",
                        "atime",
                        "ctime",
                        "uid",
                        "gid",
                        "uname",
                        "gname",
                        "LIBARCHIVE.creationtime",
                    ]
                    .contains(&key)
                        || value.len() > 4096
                        || pending.insert(key.into(), value.into()).is_some()
                    {
                        return Err(invalid());
                    }
                }
            } else {
                let key = if kind.is_gnu_longname() {
                    "path"
                } else {
                    "linkpath"
                };
                if b.last() == Some(&0) {
                    b.pop();
                }
                let value = String::from_utf8(b).map_err(|_| invalid())?;
                if pending.insert(key.into(), value).is_some() {
                    return Err(invalid());
                }
            }
            continue;
        }
        if !(kind.is_file() || kind.is_dir() || kind.is_symlink()) {
            return Err(invalid());
        }
        let name = match pending.remove("path") {
            Some(s) => s,
            None => entry
                .path()
                .map_err(|_| invalid())?
                .to_str()
                .ok_or_else(invalid)?
                .to_owned(),
        };
        indexed_bytes = indexed_bytes.checked_add(name.len()).ok_or_else(invalid)?;
        if indexed_bytes > 64 * 1024 * 1024 {
            return Err(invalid());
        }
        let relative = safe_path(&name)?;
        if !names.insert(relative.clone()) {
            return Err(invalid());
        }
        output_nodes = output_nodes
            .checked_add(parents(root, &relative)? + 1)
            .ok_or_else(invalid)?;
        if output_nodes > ENTRIES {
            return Err(invalid());
        }
        if let Some(size) = pending.remove("size") {
            if size.parse::<u64>().map_err(|_| invalid())? != entry.size() {
                return Err(invalid());
            }
        }
        bytes = bytes.checked_add(entry.size()).ok_or_else(invalid)?;
        if bytes > EXPANDED {
            return Err(invalid());
        }
        let output = root.join(&relative);
        let mode = entry.header().mode().map_err(|_| invalid())?;
        if mode & 0o7000 != 0 {
            return Err(invalid());
        }
        if kind.is_symlink() {
            if entry.size() != 0 {
                return Err(invalid());
            }
            let target = match pending.remove("linkpath") {
                Some(s) => s,
                None => entry
                    .link_name()
                    .map_err(|_| invalid())?
                    .ok_or_else(invalid)?
                    .to_str()
                    .ok_or_else(invalid)?
                    .to_owned(),
            };
            if target.is_empty()
                || target.len() > 4096
                || target.starts_with('/')
                || target.contains(['\\', ':'])
                || target.chars().any(|c| c.is_control())
            {
                return Err(invalid());
            }
            indexed_bytes = indexed_bytes
                .checked_add(target.len())
                .ok_or_else(invalid)?;
            if indexed_bytes > 64 * 1024 * 1024 {
                return Err(invalid());
            }
            links.insert(relative, target);
        } else if kind.is_dir() {
            if entry.size() != 0 {
                return Err(invalid());
            }
            match fs::create_dir(&output) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if !fs::symlink_metadata(&output)
                        .map_err(|_| invalid())?
                        .is_dir()
                    {
                        return Err(invalid());
                    }
                }
                Err(_) => return Err(invalid()),
            }
            fs::set_permissions(&output, fs::Permissions::from_mode(mode & 0o777))
                .map_err(|_| invalid())?;
        } else {
            let mut out = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&output)
                .map_err(|_| invalid())?;
            let n = std::io::copy(&mut entry, &mut out).map_err(|_| invalid())?;
            if n != entry.size() {
                return Err(invalid());
            }
            out.set_permissions(fs::Permissions::from_mode(mode & 0o777))
                .and_then(|_| sync_extracted_file(&out, root))
                .map_err(|_| invalid())?;
        }
        if pending.contains_key("linkpath") {
            return Err(invalid());
        }
        pending.clear();
    }
    if !pending.is_empty() {
        return Err(invalid());
    }
    // Resolve graph before creating links, so no archive write ever traverses a symlink.
    for (name, target) in &links {
        let mut current = normalize_link(name, target)?;
        let mut seen = HashSet::new();
        for depth in 0..=32 {
            if depth == 32 || !seen.insert(current.clone()) {
                return Err(invalid());
            }
            let mut prefix = PathBuf::new();
            let mut replaced = false;
            let parts: Vec<_> = current
                .components()
                .map(|c| c.as_os_str().to_os_string())
                .collect();
            for (i, c) in parts.iter().enumerate() {
                prefix.push(c.as_os_str());
                if let Some(next) = links.get(&prefix) {
                    current = normalize_link(&prefix, next)?;
                    for rest in &parts[i + 1..] {
                        current.push(rest.as_os_str());
                    }
                    replaced = true;
                    break;
                }
            }
            if !replaced {
                if !names.contains(&current) {
                    return Err(invalid());
                }
                break;
            }
        }
        if fs::symlink_metadata(root.join(name)).is_ok() {
            return Err(invalid());
        }
    }
    for (name, target) in links {
        parents(root, &name)?;
        std::os::unix::fs::symlink(target, root.join(name)).map_err(|_| invalid())?;
    }
    // Drain through gzip trailer/checksum and bound padding; reject nonzero trailing tar bytes.
    let mut reader = archive.into_inner();
    let mut b = [0u8; 8192];
    loop {
        let n = reader.read(&mut b).map_err(|_| invalid())?;
        if n == 0 {
            break;
        }
        if b[..n].iter().any(|x| *x != 0) {
            return Err(invalid());
        }
    }
    Ok(())
}

// macOS embedded-tree commit only. Public sync_directories retains its existing
// semantics for service installation and all other callers.
#[cfg(unix)]
struct ExtractedTreeCommit {
    #[cfg(target_os = "macos")]
    device: u64,
}
#[cfg(unix)]
fn sync_extracted_file(file: &File, root: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let root_metadata = fs::symlink_metadata(root)?;
        let metadata = file.metadata()?;
        if !root_metadata.is_dir()
            || root_metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.nlink() != 1
        {
            return Err(std::io::Error::other("embedded tree identity"));
        }
        same_tree_device(metadata.dev(), root_metadata.dev())?;
        #[cfg(test)]
        tree_commit_test_point("file-posix")?;
        posix_tree_fsync(file)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = root;
        file.sync_all()
    }
}
#[cfg(target_os = "macos")]
fn same_tree_device(actual: u64, expected: u64) -> std::io::Result<()> {
    if actual != expected {
        return Err(std::io::Error::other("embedded tree crossed device"));
    }
    Ok(())
}
#[cfg(target_os = "macos")]
fn tree_directory(path: &Path) -> std::io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_DIRECTORY)
        .open(path)?;
    if !file.metadata()?.is_dir() {
        return Err(std::io::Error::other("embedded tree directory"));
    }
    Ok(file)
}
#[cfg(target_os = "macos")]
fn posix_tree_fsync(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    loop {
        if unsafe { libc::fsync(file.as_raw_fd()) } == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}
#[cfg(target_os = "macos")]
fn full_tree_fsync(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    loop {
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_FULLFSYNC) } == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        // Never silently downgrade the commit barrier to plain fsync.
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}
#[cfg(target_os = "macos")]
fn posix_tree_directories(root: &Path, device: u64) -> std::io::Result<()> {
    let directory = tree_directory(root)?;
    same_tree_device(directory.metadata()?.dev(), device)?;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        same_tree_device(metadata.dev(), device)?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            posix_tree_directories(&entry.path(), device)?;
        } else if metadata.is_file() {
            if metadata.nlink() != 1 {
                return Err(std::io::Error::other("embedded tree hardlink"));
            }
        } else if !metadata.file_type().is_symlink() {
            return Err(std::io::Error::other("embedded tree node"));
        }
    }
    #[cfg(test)]
    tree_commit_test_point(&format!("directory:{}", root.display()))?;
    posix_tree_fsync(&directory)
}
#[cfg(unix)]
fn sync_extracted_tree(root: &Path, parent: &Path) -> Result<ExtractedTreeCommit, String> {
    #[cfg(target_os = "macos")]
    {
        let directory = tree_directory(root).map_err(|_| invalid())?;
        let metadata = directory.metadata().map_err(|_| invalid())?;
        let parent_directory = tree_directory(parent).map_err(|_| invalid())?;
        same_tree_device(
            parent_directory.metadata().map_err(|_| invalid())?.dev(),
            metadata.dev(),
        )
        .map_err(|_| invalid())?;
        posix_tree_directories(root, metadata.dev()).map_err(|_| invalid())?;
        #[cfg(test)]
        tree_commit_test_point("root-full").map_err(|_| invalid())?;
        full_tree_fsync(&directory).map_err(|_| invalid())?;
        let current = fs::symlink_metadata(root).map_err(|_| invalid())?;
        if !current.is_dir()
            || current.file_type().is_symlink()
            || current.dev() != metadata.dev()
            || current.ino() != metadata.ino()
        {
            return Err(invalid());
        }
        Ok(ExtractedTreeCommit {
            device: metadata.dev(),
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = parent;
        sync_directories(root)?;
        Ok(ExtractedTreeCommit {})
    }
}
#[cfg(unix)]
fn sync_extracted_parent(parent: &Path, commit: &ExtractedTreeCommit) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let directory = tree_directory(parent).map_err(|_| invalid())?;
        same_tree_device(
            directory.metadata().map_err(|_| invalid())?.dev(),
            commit.device,
        )
        .map_err(|_| invalid())?;
        #[cfg(test)]
        tree_commit_test_point("parent-full").map_err(|_| invalid())?;
        full_tree_fsync(&directory).map_err(|_| invalid())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = commit;
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| invalid())
    }
}
#[cfg(all(test, target_os = "macos"))]
#[derive(Default)]
struct TreeCommitTestState {
    events: Vec<String>,
    fail_at: Option<usize>,
}
#[cfg(all(test, target_os = "macos"))]
thread_local! {
    static TREE_COMMIT_TEST: std::cell::RefCell<TreeCommitTestState> = Default::default();
}
#[cfg(all(test, target_os = "macos"))]
fn tree_commit_test_point(event: &str) -> std::io::Result<()> {
    TREE_COMMIT_TEST.with(|state| {
        let mut state = state.borrow_mut();
        state.events.push(event.to_owned());
        if state.fail_at == Some(state.events.len()) {
            Err(std::io::Error::from_raw_os_error(libc::EIO))
        } else {
            Ok(())
        }
    })
}

#[cfg(unix)]
pub(super) fn sync_directories(root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|_| invalid())? {
        let entry = entry.map_err(|_| invalid())?;
        if entry.file_type().map_err(|_| invalid())?.is_dir() {
            sync_directories(&entry.path())?;
        }
    }
    File::open(root)
        .and_then(|f| f.sync_all())
        .map_err(|_| invalid())
}
fn normalize_link(name: &Path, target: &str) -> Result<PathBuf, String> {
    let mut result = name.parent().unwrap_or(Path::new("")).to_owned();
    for c in Path::new(target).components() {
        match c {
            Component::Normal(s) => result.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    return Err(invalid());
                }
            }
            _ => return Err(invalid()),
        }
    }
    if result.as_os_str().is_empty() {
        return Err(invalid());
    }
    Ok(result)
}
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        root: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "blackcrab-payload-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self { root }
        }
        fn archive(&self, entries: Vec<(&str, u8, &str)>) -> EmbeddedPayload {
            let file = self.root.join(format!(
                "archive-{}.tgz",
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let out = File::create(&file).unwrap();
            let mut builder = tar::Builder::new(GzEncoder::new(out, Compression::fast()));
            for (name, kind, data) in entries {
                let mut h = tar::Header::new_ustar();
                h.set_entry_type(tar::EntryType::new(kind));
                h.set_mode(
                    if kind == b'5'
                        || name == "t3"
                        || name == "resource-monitor/t3-resource-monitor"
                    {
                        0o755
                    } else {
                        0o644
                    },
                );
                h.set_uid(0);
                h.set_gid(0);
                if kind == b'2' {
                    h.set_link_name(data).unwrap();
                    h.set_size(0);
                } else {
                    h.set_size(data.len() as u64);
                }
                h.set_cksum();
                builder
                    .append_data(
                        &mut h,
                        name,
                        if kind == b'2' {
                            &b""[..]
                        } else {
                            data.as_bytes()
                        },
                    )
                    .unwrap();
            }
            let encoder = builder.into_inner().unwrap();
            encoder.finish().unwrap();
            let digest = hash(&mut File::open(&file).unwrap(), COMPRESSED).unwrap();
            EmbeddedPayload::new(
                PayloadRole::Desktop,
                file,
                digest,
                "a".repeat(64),
                self.root.join("cache"),
            )
            .unwrap()
        }
    }
    fn check(root: &Path) -> Result<(), String> {
        if fs::read(root.join("file")).map_err(|_| invalid())? != b"content" {
            return Err(invalid());
        }
        Ok(())
    }
    #[test]
    fn valid_roundtrip_cache_and_tamper() {
        let f = Fixture::new();
        let p = f.archive(vec![
            ("file", b'0', "content"),
            ("dir/", b'5', ""),
            ("dir/link", b'2', "../file"),
        ]);
        let root = p.ensure_with(check).unwrap();
        assert_eq!(
            fs::read_link(root.join("dir/link")).unwrap(),
            PathBuf::from("../file")
        );
        assert_eq!(p.ensure_with(check).unwrap(), root);
        fs::write(root.join("file"), b"tampered").unwrap();
        assert!(p.ensure_with(check).is_err());
        assert_eq!(fs::read(root.join("file")).unwrap(), b"tampered");
    }
    #[test]
    fn hash_checked_before_parse_and_no_stage_left() {
        let f = Fixture::new();
        let mut p = f.archive(vec![("file", b'0', "content")]);
        p.archive_sha256 = "b".repeat(64);
        assert!(p.ensure_with(check).is_err());
        assert!(!fs::read_dir(&p.cache_root).unwrap().any(|x| x
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".staging")));
    }
    #[test]
    fn unsafe_types_links_duplicates_and_cleanup() {
        for entries in [
            vec![("file", b'0', "content"), ("escape", b'2', "../../outside")],
            vec![("file", b'0', "content"), ("cycle", b'2', "cycle")],
            vec![("file", b'0', "content"), ("file", b'0', "duplicate")],
            vec![("fifo", b'6', "")],
            vec![("hard", b'1', "")],
            vec![("parent", b'2', "file"), ("parent/file", b'0', "content")],
        ] {
            let f = Fixture::new();
            let p = f.archive(entries);
            assert!(p.ensure_with(check).is_err());
            assert!(!p.target_directory().exists());
            assert!(!fs::read_dir(&p.cache_root).unwrap().any(|x| x
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".staging")));
        }
    }
    #[test]
    fn pure_path_rejections() {
        for s in [
            "../escape",
            "/absolute",
            "a/../b",
            "a//b",
            "a\nb",
            "C:evil",
            "a\\b",
        ] {
            assert!(safe_path(s).is_err());
        }
        assert!(normalize_link(Path::new("dir/link"), "../../escape").is_err());
    }
    #[test]
    fn parallel_adoption_is_serialized() {
        let f = Fixture::new();
        let p = f.archive(vec![("file", b'0', "content")]);
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let p = p.clone();
                std::thread::spawn(move || p.ensure_with(check).unwrap())
            })
            .collect();
        for w in workers {
            assert_eq!(w.join().unwrap(), p.target_directory());
        }
    }
    #[test]
    fn pax_long_paths_and_links_are_preserved() {
        let f = Fixture::new();
        let file = f.root.join("pax.tgz");
        let mut builder = tar::Builder::new(GzEncoder::new(
            File::create(&file).unwrap(),
            Compression::fast(),
        ));
        let long = format!("dir/{}/file", "segment".repeat(22));
        builder
            .append_pax_extensions([
                ("path", long.as_bytes()),
                ("LIBARCHIVE.creationtime", &b"315561600"[..]),
            ])
            .unwrap();
        let mut h = tar::Header::new_ustar();
        h.set_size(7);
        h.set_mode(0o755);
        h.set_cksum();
        builder
            .append_data(&mut h, "placeholder", &b"content"[..])
            .unwrap();
        builder
            .append_pax_extensions([("linkpath", long.as_bytes())])
            .unwrap();
        let mut h = tar::Header::new_ustar();
        h.set_entry_type(tar::EntryType::Symlink);
        h.set_size(0);
        h.set_mode(0o777);
        h.set_link_name("placeholder").unwrap();
        h.set_cksum();
        builder.append_data(&mut h, "link", &b""[..]).unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        let digest = hash(&mut File::open(&file).unwrap(), COMPRESSED).unwrap();
        let p = EmbeddedPayload::new(
            PayloadRole::Desktop,
            file,
            digest,
            "a".repeat(64),
            f.root.join("cache"),
        )
        .unwrap();
        let root = p
            .ensure_with(|root| {
                if fs::read(root.join(&long)).map_err(|_| invalid())? != b"content" {
                    return Err(invalid());
                }
                Ok(())
            })
            .unwrap();
        assert_eq!(
            fs::read_link(root.join("link")).unwrap(),
            PathBuf::from(long)
        );
        assert_eq!(
            fs::metadata(root.join("link")).unwrap().mode() & 0o777,
            0o755
        );
    }
    #[test]
    fn real_host_role_verifier_and_manifest_anchor() {
        let f = Fixture::new();
        let files = [
            "LICENSE.upstream",
            "THIRD-PARTY-NOTICES",
            "client/index.html",
            "resource-monitor/t3-resource-monitor",
            "t3",
        ];
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
        let digest = format!("{:x}", Sha256::digest(b"content"));
        let records:Vec<_>=files.iter().map(|p|serde_json::json!({"path":p,"bytes":7,"sha256":digest,"executable":*p=="t3"||p.starts_with("resource-monitor/")})).collect();
        let manifest = serde_json::json!({"schema":1,"kind":"blackcrab-managed-host","upstream":{"repository":"BonJenn/t3code","commit":"7f02de2eb8e253e0ec23f005b3cfff8e2c963be8","archiveSha256":"eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6"},"sourcePatches":[],"runtime":{"platform":platform,"arch":arch,"version":"0.1.7"},"entry":"t3","client":"client/index.html","files":records});
        let text = serde_json::to_string(&manifest).unwrap();
        let mut entries: Vec<_> = files.iter().map(|p| (*p, b'0', "content")).collect();
        entries.push(("blackcrab-managed-host.json", b'0', text.as_str()));
        let mut p = f.archive(entries);
        p.role = PayloadRole::Host;
        p.manifest_sha256 = format!("{:x}", Sha256::digest(text.as_bytes()));
        let target = p.ensure_verified().unwrap();
        assert!(target.join("t3").is_file());
        fs::write(target.join("t3"), b"tampered").unwrap();
        assert!(p.ensure_verified().is_err());
    }
    #[test]
    fn raw_traversal_metadata_and_expansion_bounds() {
        for (name, kind, size) in [
            ("../escape", b'0', 0),
            ("/absolute", b'0', 0),
            ("a/../escape", b'0', 0),
            ("meta", b'x', META + 1),
            ("huge", b'0', EXPANDED + 1),
            ("global", b'g', 0),
        ] {
            let f = Fixture::new();
            let file = f.root.join("malformed.tgz");
            let mut encoder = GzEncoder::new(File::create(&file).unwrap(), Compression::fast());
            let mut header = tar::Header::new_ustar();
            header.set_entry_type(tar::EntryType::new(kind));
            header.set_size(size);
            header.set_mode(0o644);
            header.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
            header.set_cksum();
            encoder.write_all(header.as_bytes()).unwrap();
            encoder.write_all(&[0u8; 1024]).unwrap();
            encoder.finish().unwrap();
            let digest = hash(&mut File::open(&file).unwrap(), COMPRESSED).unwrap();
            let p = EmbeddedPayload::new(
                PayloadRole::Desktop,
                file,
                digest,
                "a".repeat(64),
                f.root.join("cache"),
            )
            .unwrap();
            assert!(p.ensure_with(|_| Ok(())).is_err());
            assert!(!p.target_directory().exists());
        }
    }
    #[test]
    fn lease_worker() {
        let Ok(archive) = std::env::var("BLACKCRAB_PAYLOAD_TEST_ARCHIVE") else {
            return;
        };
        let p = EmbeddedPayload::new(
            PayloadRole::Desktop,
            PathBuf::from(archive),
            std::env::var("BLACKCRAB_PAYLOAD_TEST_DIGEST").unwrap(),
            "a".repeat(64),
            PathBuf::from(std::env::var("BLACKCRAB_PAYLOAD_TEST_CACHE").unwrap()),
        )
        .unwrap();
        p.ensure_with(check).unwrap();
    }
    #[test]
    fn cross_process_first_adoption_lease() {
        let f = Fixture::new();
        let p = f.archive(vec![("file", b'0', "content")]);
        let mut workers: Vec<_> = (0..3)
            .map(|_| {
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "managed_payload::tests::lease_worker", "--quiet"])
                    .env("BLACKCRAB_PAYLOAD_TEST_ARCHIVE", &p.archive)
                    .env("BLACKCRAB_PAYLOAD_TEST_DIGEST", &p.archive_sha256)
                    .env("BLACKCRAB_PAYLOAD_TEST_CACHE", &p.cache_root)
                    .stdout(std::process::Stdio::null())
                    .spawn()
                    .unwrap()
            })
            .collect();
        for worker in &mut workers {
            assert!(worker.wait().unwrap().success());
        }
        assert_eq!(p.ensure_with(check).unwrap(), p.target_directory());
    }
    #[test]
    fn framework_directory_and_file_link_chain() {
        let f = Fixture::new();
        let p = f.archive(vec![
            ("file", b'0', "content"),
            ("Framework/", b'5', ""),
            ("Framework/Versions/", b'5', ""),
            ("Framework/Versions/A/", b'5', ""),
            ("Framework/Versions/A/binary", b'0', "signature"),
            ("Framework/Versions/Current", b'2', "A"),
            ("Framework/binary", b'2', "Versions/Current/binary"),
        ]);
        let target = p.ensure_with(check).unwrap();
        assert_eq!(
            fs::read(target.join("Framework/binary")).unwrap(),
            b"signature"
        );
        assert!(
            fs::symlink_metadata(target.join("Framework/Versions/Current"))
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
    #[test]
    fn existing_unmarked_or_redirected_cache_is_not_modified() {
        let f = Fixture::new();
        let existing = f.root.join("unmarked");
        fs::DirBuilder::new().mode(0o700).create(&existing).unwrap();
        assert!(EmbeddedPayload::new(
            PayloadRole::Host,
            f.root.join("archive"),
            "a".repeat(64),
            "b".repeat(64),
            existing.clone()
        )
        .is_err());
        assert_eq!(fs::read_dir(&existing).unwrap().count(), 0);
        let redirect = f.root.join("redirect");
        std::os::unix::fs::symlink(&existing, &redirect).unwrap();
        assert!(EmbeddedPayload::new(
            PayloadRole::Host,
            f.root.join("archive"),
            "a".repeat(64),
            "b".repeat(64),
            redirect
        )
        .is_err());
    }
    #[test]
    fn concurrent_virgin_constructors_publish_one_marked_root() {
        let f = Fixture::new();
        let source = f.archive(vec![("file", b'0', "content")]);
        let virgin = f.root.join("virgin-cache");
        let workers: Vec<_> = (0..6)
            .map(|_| {
                let source = source.clone();
                let cache = virgin.clone();
                std::thread::spawn(move || {
                    EmbeddedPayload::new(
                        PayloadRole::Desktop,
                        source.archive,
                        source.archive_sha256,
                        "a".repeat(64),
                        cache,
                    )
                    .unwrap()
                    .ensure_with(check)
                    .unwrap()
                })
            })
            .collect();
        let paths: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
        assert!(paths.iter().all(|p| p == &paths[0]));
        verify_marker(&virgin).unwrap();
        assert!(!fs::read_dir(&f.root).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".payload-cache-init")));
    }
    #[test]
    fn occupied_lease_has_a_bounded_deadline() {
        let f = Fixture::new();
        let p = f.archive(vec![("file", b'0', "content")]);
        let _held = cache_lease(&p.cache_root).unwrap();
        let start = std::time::Instant::now();
        assert!(owned_lock(&p.cache_root.join(".lease"), false).is_err());
        assert!(start.elapsed() < std::time::Duration::from_secs(10));
    }
    #[test]
    #[ignore = "requires an explicitly prepared production desktop archive; verifies only, never executes"]
    fn production_desktop_archive_cache() {
        let archive = PathBuf::from(std::env::var("BLACKCRAB_TEST_DESKTOP_ARCHIVE").unwrap());
        let archive_sha = std::env::var("BLACKCRAB_TEST_DESKTOP_ARCHIVE_SHA256").unwrap();
        let manifest_sha = std::env::var("BLACKCRAB_TEST_DESKTOP_MANIFEST_SHA256").unwrap();
        let cache = PathBuf::from(std::env::var("BLACKCRAB_TEST_DESKTOP_CACHE_ROOT").unwrap());
        let payload = EmbeddedPayload::new(
            PayloadRole::Desktop,
            archive,
            archive_sha,
            manifest_sha.clone(),
            cache,
        )
        .unwrap();
        let root = payload.ensure_verified().unwrap();
        crate::managed_desktop::verify_package(&root, &manifest_sha).unwrap();
        assert_eq!(payload.ensure_verified().unwrap(), root);
        println!("Production Desktop archive/cache verified without execution");
    }
    #[test]
    fn unrelated_libarchive_pax_extensions_remain_rejected() {
        let f = Fixture::new();
        let file = f.root.join("unsupported-pax.tgz");
        let mut builder = tar::Builder::new(GzEncoder::new(
            File::create(&file).unwrap(),
            Compression::fast(),
        ));
        builder
            .append_pax_extensions([("LIBARCHIVE.xattr.security", &b"unreviewed"[..])])
            .unwrap();
        let mut h = tar::Header::new_ustar();
        h.set_size(7);
        h.set_mode(0o644);
        h.set_cksum();
        builder
            .append_data(&mut h, "file", &b"content"[..])
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        let archive_sha = hash(&mut File::open(&file).unwrap(), COMPRESSED).unwrap();
        let payload = EmbeddedPayload::new(
            PayloadRole::Desktop,
            file,
            archive_sha,
            "a".repeat(64),
            f.root.join("cache"),
        )
        .unwrap();
        assert!(payload.ensure_with(check).is_err());
        assert!(!payload.target_directory().exists());
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an explicitly supplied task-owned ownership-disabled macOS volume"]
    fn ownership_disabled_volume_cannot_initialize_private_cache() {
        let parent = PathBuf::from(std::env::var_os("BLACKCRAB_TEST_UNOWNED_VOLUME").unwrap());
        assert!(ownership_filesystem(&parent).is_err());
        let target = parent.join(format!("refused-cache-{}", std::process::id()));
        assert!(!target.exists());
        assert!(initialize_cache_root(&target).is_err());
        assert!(!target.exists());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn extracted_tree_commit_orders_posix_and_full_barriers() {
        TREE_COMMIT_TEST.with(|s| *s.borrow_mut() = Default::default());
        let f = Fixture::new();
        let p = f.archive(vec![("nested/file", b'0', "content")]);
        p.ensure_with(|_| Ok(())).unwrap();
        let events = TREE_COMMIT_TEST.with(|s| s.borrow().events.clone());
        assert_eq!(events.iter().filter(|s| *s == "file-posix").count(), 1);
        assert_eq!(events.iter().filter(|s| *s == "root-full").count(), 1);
        assert_eq!(events.iter().filter(|s| *s == "parent-full").count(), 1);
        let full = events.iter().position(|s| s == "root-full").unwrap();
        let publish = events.iter().position(|s| s == "publish").unwrap();
        let parent = events.iter().position(|s| s == "parent-full").unwrap();
        assert!(full < publish && publish < parent);
        let directories: Vec<_> = events
            .iter()
            .filter(|s| s.starts_with("directory:"))
            .collect();
        assert!(directories[0].ends_with("/nested"));
        assert!(!directories.last().unwrap().ends_with("/nested"));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn every_prepublish_sync_failure_prevents_publication() {
        // nested/file => file POSIX, nested dir POSIX, staging dir POSIX,
        // root FULL, then publication. None may publish after an injected failure.
        for fail_at in 1..=5 {
            TREE_COMMIT_TEST.with(|s| {
                *s.borrow_mut() = TreeCommitTestState {
                    fail_at: Some(fail_at),
                    ..Default::default()
                }
            });
            let f = Fixture::new();
            let p = f.archive(vec![("nested/file", b'0', "content")]);
            assert!(p.ensure_with(|_| Ok(())).is_err());
            assert!(!p.target_directory().exists());
        }
        TREE_COMMIT_TEST.with(|s| *s.borrow_mut() = Default::default());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn parent_full_failure_preserves_verified_target_but_returns_error() {
        TREE_COMMIT_TEST.with(|s| {
            *s.borrow_mut() = TreeCommitTestState {
                fail_at: Some(6),
                ..Default::default()
            }
        });
        let f = Fixture::new();
        let p = f.archive(vec![("nested/file", b'0', "content")]);
        assert!(p.ensure_with(|_| Ok(())).is_err());
        assert_eq!(
            fs::read(p.target_directory().join("nested/file")).unwrap(),
            b"content"
        );
        TREE_COMMIT_TEST.with(|s| *s.borrow_mut() = Default::default());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn tree_commit_device_guard_fails_closed() {
        assert!(same_tree_device(10, 10).is_ok());
        assert!(same_tree_device(10, 11).is_err());
    }
#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires two explicitly supplied task-owned roots on distinct devices"]
fn actual_distinct_device_tree_commit_refused() {
    let first = PathBuf::from(std::env::var_os("BLACKCRAB_TEST_DEVICE_ROOT_A").unwrap());
    let second = PathBuf::from(std::env::var_os("BLACKCRAB_TEST_DEVICE_ROOT_B").unwrap());
    for root in [&first, &second] {
        let m = fs::symlink_metadata(root).unwrap();
        assert!(m.is_dir() && !m.file_type().is_symlink());
        assert_eq!(m.uid(), unsafe { libc::geteuid() });
        assert_eq!(m.mode() & 0o777, 0o700);
        assert_eq!(fs::canonicalize(root).unwrap(), *root);
    }
    let a = fs::metadata(&first).unwrap().dev();
    let b = fs::metadata(&second).unwrap().dev();
    assert_ne!(a, b, "fixture must prove actual distinct st_dev");
    let filename = first.join(format!("cross-device-file-{}", std::process::id()));
    let file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&filename).unwrap();
    assert!(sync_extracted_file(&file, &second).is_err());
    assert!(sync_extracted_tree(&first, &second).is_err());
    assert!(sync_extracted_parent(&second, &ExtractedTreeCommit { device: a }).is_err());
    drop(file);
    fs::remove_file(filename).unwrap();
    assert_eq!(fs::read_dir(&first).unwrap().count(), 0);
    assert_eq!(fs::read_dir(&second).unwrap().count(), 0);
}

}
