//! Private child of managed_host; service activation/migration remain unavailable.
//! No renderer constructor, remote endpoint, PID authority, service activation or GUI startup.
#![cfg(unix)]
#[path = "managed_service_boot_session.rs"]
mod boot_session;

use super::{bootstrap_token, now_ms, Configuration, ManagedHost, OwnershipMode, MARKER};
use crate::{managed_artifact, managed_payload};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::{
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        io::RawFd,
    },
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
const LIMIT: usize = 64 * 1024;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
const AUTH_REGISTRY: &str =
    include_str!("../../fork-integration/boot-service/owned-auth/registry.json");
const LAUNCHER_REGISTRY: &str =
    include_str!("../../fork-integration/boot-service/launcher-adapter/registry.json");
const BACKEND_REGISTRY: &str =
    include_str!("../../fork-integration/boot-service/backend-identity/registry.json");
const BINDING: &str = "native-issuer-binding.json";
const JOURNAL: &str = "native-issuer-epoch.json";
const REGISTRY: &str = include_str!("../../fork-integration/boot-service/registry.json");
type Result<T> = std::result::Result<T, String>;
fn invalid() -> String {
    "Background service issuer is unavailable".into()
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    schema: u32,
    self_sha256: String,
    manifest_sha256: String,
    generation: u64,
    environment_id: String,
    version: String,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema: u32,
    generation: u64,
    epoch: u64,
    session: String,
    phase: Phase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    boot_session_id: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Prepared,
    Issued,
    Retired,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Begin {
        protocol: u32,
        epoch: u64,
        generation: u64,
    },
    Issued {
        protocol: u32,
        epoch: u64,
        session: String,
    },
    Retire {
        protocol: u32,
        epoch: u64,
        session: String,
    },
}
// Native constructed only: no network/configuration fields and no Deserialize authority.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnedServiceBinding<'a> {
    profile: &'static str,
    generation: u64,
    manifest_sha256: &'a str,
    environment_id: &'a str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnedServiceAuthBootstrap<'a> {
    schema: u32,
    kind: &'static str,
    binding: OwnedServiceBinding<'a>,
    desktop_bootstrap_token: String,
    desktop_bootstrap_secret: &'a str,
}
/// Factory authority comes from fixed installed layout + compiled anchors, not requests.
pub(super) struct NativeIssuer {
    host: ManagedHost,
    binding: Binding,
    _session_lease: File,
    transaction: Option<File>,
    session: String,
    journal: Option<Journal>,
    poisoned: bool,
    pending_deadline: Option<Instant>,
    transcript_bytes: usize,
    boot_session_id: String,
}
impl NativeIssuer {
    pub(super) fn from_installed_executable() -> Result<Self> {
        let executable = std::env::current_exe().map_err(|_| invalid())?;
        let expected =
            option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256").ok_or_else(invalid)?;
        Self::open_installed(&executable, expected)
    }
    fn open_installed(executable: &Path, expected: &str) -> Result<Self> {
        // owner/issuer/<selfSHA>/blackcrab-issuer, never a request-selected root.
        if executable.file_name().and_then(|x| x.to_str()) != Some("blackcrab-issuer") {
            return Err(invalid());
        }
        let digest_dir = executable.parent().ok_or_else(invalid)?;
        let self_sha = digest_dir
            .file_name()
            .and_then(|x| x.to_str())
            .ok_or_else(invalid)?;
        if !hex_digest(self_sha) || !hex_digest(expected) {
            return Err(invalid());
        }
        let issuer = digest_dir.parent().ok_or_else(invalid)?;
        if issuer.file_name().and_then(|x| x.to_str()) != Some("issuer") {
            return Err(invalid());
        }
        let owner = issuer.parent().ok_or_else(invalid)?;
        for directory in [owner, issuer, digest_dir] {
            managed_payload::private_dir(directory).map_err(|_| invalid())?;
        }
        if executable.canonicalize().map_err(|_| invalid())? != executable {
            return Err(invalid());
        }
        let meta = fs::symlink_metadata(executable).map_err(|_| invalid())?;
        if !meta.is_file()
            || meta.nlink() != 1
            || meta.uid() != unsafe { libc::geteuid() }
            || meta.mode() & 0o777 != 0o700
        {
            return Err(invalid());
        }
        if digest_file(executable, 256 * 1024 * 1024)? != self_sha {
            return Err(invalid());
        }
        if private_bytes(&owner.join(".blackcrab-managed-host"), 64)? != MARKER.as_bytes() {
            return Err(invalid());
        }
        let binding: Binding = serde_json::from_slice(&private_bytes(&owner.join(BINDING), LIMIT)?)
            .map_err(|_| invalid())?;
        if binding.schema != 1
            || binding.self_sha256 != self_sha
            || binding.manifest_sha256 != expected
            || !safe_number(binding.generation)
            || binding.version != "0.1.7"
            || !valid_environment(&binding.environment_id)
        {
            return Err(invalid());
        }
        let session_lease = managed_payload::owned_lock(&owner.join("service-owner.lock"), true)
            .map_err(|_| invalid())?;
        let host = ManagedHost::new(owner.to_path_buf());
        // Lock order is service-owner then launcher. Never hold launcher over IPC trial commit.
        let transaction = managed_payload::owned_lock(&owner.join("launcher.lock"), true)
            .map_err(|_| invalid())?;
        verify_selection(&host, &binding)?;
        let boot_session_id = boot_session::read_boot_session_id()?;
        // Selection remains verified under BOTH leases before reconciling prior-boot state.
        verify_selection(&host, &binding)?;
        let previous = reconcile_after_boot(
            owner,
            read_journal(owner)?,
            binding.generation,
            &boot_session_id,
        )?;
        let session = super::random_secret()?;
        drop(transaction);
        Ok(Self {
            host,
            binding,
            _session_lease: session_lease,
            transaction: None,
            session,
            journal: previous,
            poisoned: false,
            pending_deadline: None,
            transcript_bytes: 0,
            boot_session_id,
        })
    }
    fn ready_frame(&self) -> Result<Vec<u8>> {
        if self.poisoned
            || self
                .journal
                .as_ref()
                .is_some_and(|j| j.phase != Phase::Retired)
        {
            return Err(invalid());
        }
        let epoch = match &self.journal {
            Some(j) => next_epoch(j.epoch).ok_or_else(invalid)?,
            None => 1,
        };
        frame(
            &json!({"type":"ready","protocol":1,"generation":self.binding.generation,"nextEpoch":epoch,"manifestSha256":self.binding.manifest_sha256,"environmentId":self.binding.environment_id,"version":self.binding.version}),
        )
    }
    fn begin(&mut self, epoch: u64, generation: u64) -> Result<Vec<u8>> {
        if self.poisoned
            || generation != self.binding.generation
            || self.transaction.is_some()
            || !safe_number(epoch)
            || !safe_number(generation)
            || self
                .journal
                .as_ref()
                .is_some_and(|x| x.phase != Phase::Retired || next_epoch(x.epoch) != Some(epoch))
            || self.journal.is_none() && epoch != 1
        {
            return Err(invalid());
        }
        let transaction = managed_payload::owned_lock(&self.host.root.join("launcher.lock"), true)
            .map_err(|_| invalid())?;
        let config = verify_selection(&self.host, &self.binding)?;
        self.prepare_verified(epoch, generation, config, transaction)
    }
    // Only called after selection verification; tests exercise this state transaction
    // directly without treating their synthetic fixtures as a production artifact.
    fn prepare_verified(
        &mut self,
        epoch: u64,
        generation: u64,
        config: Configuration,
        transaction: File,
    ) -> Result<Vec<u8>> {
        if !safe_number(epoch)
            || !safe_number(generation)
            || generation != self.binding.generation
            || !valid_environment(&self.binding.environment_id)
        {
            return Err(invalid());
        }
        let envelope = OwnedServiceAuthBootstrap {
            schema: 1,
            kind: "blackcrab-owned-service-auth-v1",
            binding: OwnedServiceBinding {
                profile: "blackcrab-local-service-layout-v1",
                generation,
                manifest_sha256: &self.binding.manifest_sha256,
                environment_id: &self.binding.environment_id,
            },
            desktop_bootstrap_token: bootstrap_token(&config.bootstrap_secret, now_ms()?)?,
            desktop_bootstrap_secret: &config.bootstrap_secret,
        };
        let envelope = serde_json::to_value(envelope).map_err(|_| invalid())?;
        // Never persist the secret-bearing envelope; persist uncertain issuance BEFORE exposing it.
        let journal = Journal {
            schema: 1,
            generation,
            epoch,
            session: self.session.clone(),
            phase: Phase::Prepared,
            boot_session_id: Some(self.boot_session_id.clone()),
        };
        self.persist(&journal)?;
        self.journal = Some(journal);
        self.transaction = Some(transaction);
        self.pending_deadline = Some(Instant::now() + Duration::from_secs(30));
        frame(
            &json!({"type":"prepared","protocol":1,"session":self.session,"epoch":epoch,"generation":generation,"envelope":envelope}),
        )
    }
    fn issued(&mut self, epoch: u64, session: &str) -> Result<()> {
        let mut next = self.matching(epoch, session, Phase::Prepared)?.clone();
        if self.transaction.is_none() {
            return Err(invalid());
        }
        next.phase = Phase::Issued;
        self.persist(&next)?;
        self.journal = Some(next);
        self.pending_deadline = None;
        self.transaction = None; // delivery bookkeeping; NOT HTTP readiness or original IPC commit
        Ok(())
    }
    fn retire(&mut self, epoch: u64, session: &str) -> Result<()> {
        let mut next = self.matching(epoch, session, Phase::Issued)?.clone();
        next.phase = Phase::Retired;
        self.persist(&next)?;
        self.journal = Some(next);
        Ok(())
    }
    fn persist(&mut self, journal: &Journal) -> Result<()> {
        if self.poisoned {
            return Err(invalid());
        }
        if let Err(error) = save_journal(&self.host.root, journal) {
            self.poisoned = true; // includes uncertain post-rename fsync failures
            return Err(error);
        }
        Ok(())
    }
    fn matching(&self, epoch: u64, session: &str, phase: Phase) -> Result<&Journal> {
        if self.poisoned || self.pending_deadline.is_some_and(|d| Instant::now() >= d) {
            return Err(invalid());
        }
        self.journal
            .as_ref()
            .filter(|x| x.epoch == epoch && x.session == session && x.phase == phase)
            .ok_or_else(invalid)
    }
    /// Framing/state core for a private captured transport. No blocking unbounded stdin loop.
    /// Event-loop transport must poll this deadline and drop the session on expiry/EOF.
    /// There is deliberately no blocking read that could retain a lease forever.
    pub(super) fn delivery_deadline(&self) -> Option<Instant> {
        self.pending_deadline
    }
    pub(super) fn handle_frame(&mut self, bytes: &[u8]) -> Result<Vec<u8>> {
        self.transcript_bytes = self
            .transcript_bytes
            .checked_add(bytes.len())
            .ok_or_else(invalid)?;
        if self.poisoned
            || self.transcript_bytes > 16 * 1024 * 1024
            || self.pending_deadline.is_some_and(|d| Instant::now() >= d)
        {
            self.poisoned = true;
            return Err(invalid());
        }
        let outcome = (|| match decode(bytes)? {
            Request::Begin {
                protocol: 1,
                epoch,
                generation,
            } => self.begin(epoch, generation),
            Request::Issued {
                protocol: 1,
                epoch,
                session,
            } => {
                self.issued(epoch, &session)?;
                frame(&json!({"type":"issued","protocol":1,"epoch":epoch}))
            }
            Request::Retire {
                protocol: 1,
                epoch,
                session,
            } => {
                self.retire(epoch, &session)?;
                frame(&json!({"type":"retired","protocol":1,"epoch":epoch}))
            }
            _ => Err(invalid()),
        })();
        match outcome {
            Ok(output) => {
                self.transcript_bytes = self
                    .transcript_bytes
                    .checked_add(output.len())
                    .ok_or_else(invalid)?;
                if self.transcript_bytes > 16 * 1024 * 1024 {
                    self.poisoned = true;
                    return Err(invalid());
                }
                Ok(output)
            }
            Err(error) => {
                self.poisoned = true;
                Err(error)
            }
        }
    }
}
/// Fixed native entry target. Main dispatch will call this before GUI startup.
pub(super) fn run_private_stdio() -> Result<()> {
    let mut issuer = NativeIssuer::from_installed_executable()?;
    // Preflight/reconciliation completes before original launcher DB recovery begins.
    let ready = issuer.ready_frame()?;
    issuer.transcript_bytes = ready.len();
    write_private_response(libc::STDOUT_FILENO, &ready)?;
    run_io(&mut issuer, libc::STDIN_FILENO, libc::STDOUT_FILENO)
}
fn wait_fd(fd: RawFd, events: i16, deadline: Option<Instant>) -> Result<()> {
    loop {
        if deadline.is_some_and(|d| Instant::now() >= d) {
            return Err(invalid());
        }
        let mut poll = libc::pollfd {
            fd,
            events,
            revents: 0,
        };
        let millis = deadline
            .map(|d| {
                d.saturating_duration_since(Instant::now())
                    .as_millis()
                    .min(1000) as i32
            })
            .unwrap_or(1000);
        let result = unsafe { libc::poll(&mut poll, 1, millis) };
        if result < 0 {
            if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(invalid());
        }
        if result == 0 {
            continue;
        }
        if poll.revents & (libc::POLLNVAL | libc::POLLERR) != 0 {
            return Err(invalid());
        }
        if poll.revents & (events | libc::POLLHUP) != 0 {
            return Ok(());
        }
    }
}
struct NonblockingPrivateFd {
    fd: RawFd,
    flags: i32,
}
impl NonblockingPrivateFd {
    fn new(fd: RawFd) -> Result<Self> {
        let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe { libc::fstat(fd, metadata.as_mut_ptr()) } != 0 {
            return Err(invalid());
        }
        let kind = unsafe { metadata.assume_init() }.st_mode & libc::S_IFMT;
        if kind != libc::S_IFIFO && kind != libc::S_IFSOCK {
            return Err(invalid());
        }
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(invalid());
        }
        Ok(Self { fd, flags })
    }
}
impl Drop for NonblockingPrivateFd {
    fn drop(&mut self) {
        unsafe {
            libc::fcntl(self.fd, libc::F_SETFL, self.flags);
        }
    }
}
fn run_io(issuer: &mut NativeIssuer, input: RawFd, output: RawFd) -> Result<()> {
    // Only this headless process's private pipe/socket descriptors are changed;
    // flags restore on all exits, and no read/write can block after poll readiness.
    let _input = NonblockingPrivateFd::new(input)?;
    let _output = NonblockingPrivateFd::new(output)?;
    let mut line = Vec::new();
    let mut frame_deadline = None;
    loop {
        let deadline = match (issuer.delivery_deadline(), frame_deadline) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        wait_fd(input, libc::POLLIN, deadline)?;
        // One-byte bounded reads avoid consuming a later frame past a phase boundary.
        let mut byte = 0u8;
        let count = unsafe { libc::read(input, (&mut byte as *mut u8).cast(), 1) };
        if count == 0 {
            return if line.is_empty()
                && issuer
                    .journal
                    .as_ref()
                    .is_none_or(|j| j.phase == Phase::Retired)
            {
                Ok(())
            } else {
                Err(invalid())
            };
        }
        if count < 0 {
            if matches!(
                std::io::Error::last_os_error().kind(),
                std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
            ) {
                continue;
            }
            return Err(invalid());
        }
        if line.is_empty() {
            frame_deadline = Some(Instant::now() + Duration::from_secs(30));
        }
        line.push(byte);
        if line.len() > LIMIT {
            return Err(invalid());
        }
        if byte != b'\n' {
            continue;
        }
        let response = issuer.handle_frame(&line)?;
        line.clear();
        frame_deadline = None;
        write_private_response(output, &response)?;
    }
}
fn write_private_response(output: RawFd, response: &[u8]) -> Result<()> {
    if response.len() > LIMIT {
        return Err(invalid());
    }
    let _output = NonblockingPrivateFd::new(output)?;
    let deadline = Some(Instant::now() + Duration::from_secs(5));
    let mut sent = 0;
    while sent < response.len() {
        wait_fd(output, libc::POLLOUT, deadline)?;
        // <= PIPE_BUF; a single private captured writer, no unbounded write_all.
        let length = (response.len() - sent).min(512);
        let count = unsafe { libc::write(output, response[sent..].as_ptr().cast(), length) };
        if count <= 0 {
            if count < 0
                && matches!(
                    std::io::Error::last_os_error().kind(),
                    std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
                )
            {
                continue;
            }
            return Err(invalid());
        }
        sent += count as usize;
    }
    Ok(())
}
/// Native-only publication result, never a serialized authority receipt.
pub(super) struct InstalledIssuer {
    pub(super) executable: PathBuf,
    pub(super) generation: u64,
}
/// Publication neither migrates Direct ownership nor enables an OS unit.
/// Actual current_exe and compiled Host pin are the only executable/artifact inputs.
pub(super) fn publish_current_issuer(host: &ManagedHost) -> Result<InstalledIssuer> {
    let expected = option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256").ok_or_else(invalid)?;
    let executable = std::env::current_exe().map_err(|_| invalid())?;
    publish_verified_current(host, &executable, expected)
}
fn publish_verified_current(
    host: &ManagedHost,
    actual_executable: &Path,
    expected: &str,
) -> Result<InstalledIssuer> {
    // Private implementation receives current_exe only; not exposed to renderer/CLI.
    if !hex_digest(expected) {
        return Err(invalid());
    }
    managed_payload::private_dir(&host.root).map_err(|_| invalid())?;
    if host.root.canonicalize().map_err(|_| invalid())? != host.root
        || private_bytes(&host.root.join(".blackcrab-managed-host"), 64)? != MARKER.as_bytes()
    {
        return Err(invalid());
    }
    let _service = managed_payload::owned_lock(&host.root.join("service-owner.lock"), true)
        .map_err(|_| invalid())?;
    let _transaction = managed_payload::owned_lock(&host.root.join("launcher.lock"), true)
        .map_err(|_| invalid())?;
    if fs::symlink_metadata(host.root.join(BINDING)).is_ok() {
        return Err(invalid());
    }
    let config = host.read_config()?.ok_or_else(invalid)?;
    // Never convert a Direct config, even if its runtime record looks stopped.
    if config.ownership != OwnershipMode::Service || config.manifest_digest != expected {
        return Err(invalid());
    }
    let source = private_or_public_regular(actual_executable, 256 * 1024 * 1024)?;
    let self_sha = format!("{:x}", Sha256::digest(&source));
    let mut entropy = [0u8; 8];
    getrandom::getrandom(&mut entropy).map_err(|_| invalid())?;
    let generation = generation_from_entropy(entropy);
    let binding = Binding {
        schema: 1,
        self_sha256: self_sha.clone(),
        manifest_sha256: expected.into(),
        generation,
        environment_id: config.environment_id.clone().ok_or_else(invalid)?,
        version: "0.1.7".into(),
    };
    verify_payload_config(host, &binding)?;
    let issuer = host.root.join("issuer");
    private_directory_new_or_existing(&issuer)?;
    let target = issuer.join(&self_sha);
    let installed = target.join("blackcrab-issuer");
    if fs::symlink_metadata(&target).is_ok() {
        verify_installed_copy(&target, &installed, &self_sha)?;
    } else {
        let stage = issuer.join(format!(".native-issuer-{}", super::random_secret()?));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&stage)
            .map_err(|_| invalid())?;
        let outcome = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o700)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(stage.join("blackcrab-issuer"))
                .map_err(|_| invalid())?;
            file.write_all(&source)
                .and_then(|_| file.sync_all())
                .map_err(|_| invalid())?;
            verify_installed_copy(&stage, &stage.join("blackcrab-issuer"), &self_sha)?;
            File::open(&stage)
                .and_then(|f| f.sync_all())
                .map_err(|_| invalid())?;
            managed_payload::publish_no_replace(&stage, &target).map_err(|_| invalid())?;
            File::open(&issuer)
                .and_then(|f| f.sync_all())
                .map_err(|_| invalid())
        })();
        if stage.exists() {
            let _ = fs::remove_dir_all(&stage);
        }
        outcome?;
    }
    // Reverify payload/config immediately before no-overwrite binding publication.
    verify_payload_config(host, &binding)?;
    verify_installed_copy(&target, &installed, &self_sha)?;
    let temp = host
        .root
        .join(format!(".issuer-binding-{}", super::random_secret()?));
    super::write_new(&temp, &serde_json::to_vec(&binding).map_err(|_| invalid())?)?;
    let outcome = (|| {
        managed_payload::publish_no_replace(&temp, &host.root.join(BINDING))
            .map_err(|_| invalid())?;
        File::open(&host.root)
            .and_then(|f| f.sync_all())
            .map_err(|_| invalid())
    })();
    if temp.exists() {
        let _ = fs::remove_file(&temp);
    }
    outcome?;
    Ok(InstalledIssuer {
        executable: installed,
        generation,
    })
}
fn private_directory_new_or_existing(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => managed_payload::private_dir(path).map_err(|_| invalid()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(path)
                .map_err(|_| invalid())?;
            managed_payload::private_dir(path).map_err(|_| invalid())
        }
        Err(_) => Err(invalid()),
    }
}
fn verify_installed_copy(directory: &Path, file: &Path, expected: &str) -> Result<()> {
    managed_payload::private_dir(directory).map_err(|_| invalid())?;
    let metadata = fs::symlink_metadata(file).map_err(|_| invalid())?;
    if metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o700
        || digest_file(file, 256 * 1024 * 1024)? != expected
    {
        return Err(invalid());
    }
    Ok(())
}
fn verify_selection(host: &ManagedHost, binding: &Binding) -> Result<Configuration> {
    managed_payload::private_dir(&host.root).map_err(|_| invalid())?;
    if private_bytes(&host.root.join(".blackcrab-managed-host"), 64)? != MARKER.as_bytes() {
        return Err(invalid());
    }
    let current: Binding = serde_json::from_slice(&private_bytes(&host.root.join(BINDING), LIMIT)?)
        .map_err(|_| invalid())?;
    if &current != binding {
        return Err(invalid());
    }
    verify_payload_config(host, binding)
}
fn verify_payload_config(host: &ManagedHost, binding: &Binding) -> Result<Configuration> {
    // Retain original native configuration validation, and bind the resulting value
    // to a bounded no-follow private descriptor read under the configuration lease.
    let config = host.read_config()?.ok_or_else(invalid)?;
    let protected: Configuration = serde_json::from_slice(&private_bytes(
        &host.root.join("configuration.json"),
        LIMIT,
    )?)
    .map_err(|_| invalid())?;
    if serde_json::to_value(&config).map_err(|_| invalid())?
        != serde_json::to_value(&protected).map_err(|_| invalid())?
    {
        return Err(invalid());
    }
    let config = protected;
    let payload = host
        .root
        .join("host/runtime/versions")
        .join(&binding.version)
        .join("payload");
    let version_root = payload.parent().ok_or_else(invalid)?;
    let layout: Value = serde_json::from_slice(&private_bytes(
        &version_root.join(".blackcrab-service-layout.json"),
        LIMIT,
    )?)
    .map_err(|_| invalid())?;
    if layout
        != json!({"schema":1,"profile":"blackcrab-local-service-layout-v1","protocol":4,"version":binding.version,"manifestSha256":binding.manifest_sha256})
        || private_bytes(&version_root.join(".install-complete"), 128)?
            != format!("{}\n", binding.version).as_bytes()
    {
        return Err(invalid());
    }
    if config.ownership != OwnershipMode::Service
        || config.manifest_digest != binding.manifest_sha256
        || config.environment_id.as_deref() != Some(binding.environment_id.as_str())
        || config.artifact_path != payload
    {
        return Err(invalid());
    }
    let artifact = managed_artifact::verify(&payload).map_err(|_| invalid())?;
    if artifact.manifest_digest != binding.manifest_sha256 || artifact.version != binding.version {
        return Err(invalid());
    }
    let manifest: Value = serde_json::from_slice(&private_or_public_regular(
        &payload.join("blackcrab-managed-host.json"),
        64 * 1024 * 1024,
    )?)
    .map_err(|_| invalid())?;
    let registry: Value = serde_json::from_str(REGISTRY).map_err(|_| invalid())?;
    let expected = registry["patches"].as_array().ok_or_else(invalid)?;
    let actual = manifest["sourcePatches"].as_array().ok_or_else(invalid)?;
    if expected.len() != 5
        || expected.iter().any(|record| {
            !actual
                .iter()
                .any(|a| a["id"] == record["id"] && a["sha256"] == record["sha256"])
        })
    {
        return Err(invalid());
    }
    let auth_registry: Value = serde_json::from_str(AUTH_REGISTRY).map_err(|_| invalid())?;
    let patches = auth_registry["patches"].as_array().ok_or_else(invalid)?;
    let additions = auth_registry["addedSources"]
        .as_array()
        .ok_or_else(invalid)?;
    if patches.len() != 3
        || additions.len() != 1
        || patches.iter().chain(additions.iter()).any(|record| {
            !actual
                .iter()
                .any(|a| a["id"] == record["id"] && a["sha256"] == record["sha256"])
        })
    {
        return Err(invalid());
    }
    require_source_records(actual, LAUNCHER_REGISTRY, 2, 2)?;
    require_source_records(actual, BACKEND_REGISTRY, 3, 1)?;
    Ok(config)
}
fn require_source_records(
    actual: &[Value],
    registry: &str,
    patches: usize,
    additions: usize,
) -> Result<()> {
    let registry: Value = serde_json::from_str(registry).map_err(|_| invalid())?;
    let changes = registry["patches"].as_array().ok_or_else(invalid)?;
    let sources = registry["addedSources"].as_array().ok_or_else(invalid)?;
    if changes.len() != patches
        || sources.len() != additions
        || changes.iter().chain(sources.iter()).any(|record| {
            !actual
                .iter()
                .any(|a| a["id"] == record["id"] && a["sha256"] == record["sha256"])
        })
    {
        return Err(invalid());
    }
    Ok(())
}
fn generation_from_entropy(entropy: [u8; 8]) -> u64 {
    (u64::from_le_bytes(entropy) & MAX_SAFE).max(1)
}
fn safe_number(value: u64) -> bool {
    value > 0 && value <= MAX_SAFE
}
fn next_epoch(epoch: u64) -> Option<u64> {
    epoch.checked_add(1).filter(|n| safe_number(*n))
}
fn valid_environment(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 128
        && value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}') == value
        && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn hex_digest(x: &str) -> bool {
    x.len() == 64
        && x.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn private_or_public_regular(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| invalid())?;
    let metadata = file.metadata().map_err(|_| invalid())?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > limit as u64 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() > limit {
        return Err(invalid());
    }
    Ok(bytes)
}
fn private_bytes(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| invalid())?;
    let metadata = file.metadata().map_err(|_| invalid())?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.len() > limit as u64
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
    {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() > limit {
        return Err(invalid());
    }
    Ok(bytes)
}
fn digest_file(path: &Path, limit: usize) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(private_or_public_regular(path, limit)?)
    ))
}
// Called only by native factory AFTER selected payload/config verification and
// service-owner + launcher lease acquisition. Not a request/receipt entry point.
fn reconcile_after_boot(
    owner: &Path,
    previous: Option<Journal>,
    generation: u64,
    current_boot: &str,
) -> Result<Option<Journal>> {
    if boot_session::normalize(current_boot.as_bytes()).as_deref() != Ok(current_boot) {
        return Err(invalid());
    }
    let Some(mut journal) = previous else {
        return Ok(None);
    };
    if journal.generation != generation {
        return Err(invalid());
    }
    if journal.phase != Phase::Retired {
        let old = journal.boot_session_id.as_deref().ok_or_else(invalid)?;
        if boot_session::normalize(old.as_bytes()).as_deref() != Ok(old) || old == current_boot {
            return Err(invalid());
        }
        // A genuine different kernel boot proves the old captured processes cannot
        // still execute. Preserve epoch/session; no prior envelope is replayed.
        journal.phase = Phase::Retired;
        journal.boot_session_id = Some(current_boot.into());
        save_journal(owner, &journal)?;
    }
    Ok(Some(journal))
}
fn read_journal(owner: &Path) -> Result<Option<Journal>> {
    match fs::symlink_metadata(owner.join(JOURNAL)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(invalid()),
        Ok(_) => {
            let journal: Journal =
                serde_json::from_slice(&private_bytes(&owner.join(JOURNAL), LIMIT)?)
                    .map_err(|_| invalid())?;
            if journal.schema != 1
                || !safe_number(journal.epoch)
                || !safe_number(journal.generation)
                || !hex_digest(&journal.session)
                || journal
                    .boot_session_id
                    .as_ref()
                    .is_some_and(|b| boot_session::normalize(b.as_bytes()).as_ref() != Ok(b))
            {
                return Err(invalid());
            }
            Ok(Some(journal))
        }
    }
}
fn save_journal(owner: &Path, journal: &Journal) -> Result<()> {
    if journal.schema != 1
        || !safe_number(journal.epoch)
        || !safe_number(journal.generation)
        || !hex_digest(&journal.session)
        || journal
            .boot_session_id
            .as_ref()
            .is_some_and(|b| boot_session::normalize(b.as_bytes()).as_ref() != Ok(b))
    {
        return Err(invalid());
    }
    let temp = owner.join(format!(".issuer-journal-{}", super::random_secret()?));
    let bytes = serde_json::to_vec(journal).map_err(|_| invalid())?;
    super::write_new(&temp, &bytes)?;
    let outcome = (|| {
        fs::rename(&temp, owner.join(JOURNAL)).map_err(|_| invalid())?;
        File::open(owner)
            .and_then(|f| f.sync_all())
            .map_err(|_| invalid())
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(temp);
    }
    outcome
}
fn decode(bytes: &[u8]) -> Result<Request> {
    if bytes.is_empty()
        || bytes.len() > LIMIT
        || bytes.last() != Some(&b'\n')
        || bytes[..bytes.len() - 1].contains(&b'\n')
    {
        return Err(invalid());
    }
    let request: Request = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    match &request {
        Request::Begin {
            epoch, generation, ..
        } if safe_number(*epoch) && safe_number(*generation) => {}
        Request::Issued { epoch, session, .. } | Request::Retire { epoch, session, .. }
            if safe_number(*epoch) && hex_digest(session) => {}
        _ => return Err(invalid()),
    }
    Ok(request)
}
fn frame(value: &Value) -> Result<Vec<u8>> {
    let mut out = serde_json::to_vec(value).map_err(|_| invalid())?;
    out.push(b'\n');
    if out.len() > LIMIT {
        return Err(invalid());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "issuer-core-{}",
                super::super::random_secret().unwrap()
            ));
            fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
            managed_payload::private_dir(&path).unwrap();
            Self(path)
        }
        fn core(&self) -> NativeIssuer {
            NativeIssuer {
                host: ManagedHost::new(self.0.clone()),
                binding: Binding {
                    schema: 1,
                    self_sha256: "a".repeat(64),
                    manifest_sha256: "b".repeat(64),
                    generation: 7,
                    environment_id: "env_fixture".into(),
                    version: "0.1.7".into(),
                },
                _session_lease: managed_payload::owned_lock(
                    &self.0.join("service-owner.lock"),
                    true,
                )
                .unwrap(),
                transaction: None,
                session: "c".repeat(64),
                journal: None,
                poisoned: false,
                pending_deadline: None,
                transcript_bytes: 0,
                boot_session_id: "27e29119-7aee-46e8-86f1-212756a4da80".into(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn config() -> Configuration {
        Configuration {
            schema: 1,
            ownership: OwnershipMode::Service,
            artifact_path: PathBuf::from("/synthetic-not-a-selected-artifact"),
            manifest_digest: "b".repeat(64),
            bootstrap_secret: "d".repeat(64),
            environment_id: Some("env_fixture".into()),
            browser: None,
        }
    }
    fn prepare(core: &mut NativeIssuer) -> Value {
        let lease =
            managed_payload::owned_lock(&core.host.root.join("launcher.lock"), true).unwrap();
        serde_json::from_slice(&core.prepare_verified(1, 7, config(), lease).unwrap()).unwrap()
    }
    #[test]
    fn preflight_frame_contains_no_envelope_and_precedes_recovery_authority() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        let ready: Value = serde_json::from_slice(&core.ready_frame().unwrap()).unwrap();
        assert_eq!(ready["type"], "ready");
        assert_eq!(ready["nextEpoch"], 1);
        assert_eq!(ready.as_object().unwrap().len(), 7);
        assert!(ready.get("envelope").is_none());
        assert!(!String::from_utf8(core.ready_frame().unwrap())
            .unwrap()
            .contains(&"d".repeat(64)));
        prepare(&mut core);
        assert!(core.ready_frame().is_err());
    }
    #[test]
    fn mandatory_launcher_and_concrete_backend_source_records_are_all_required() {
        for (registry, patches, added) in [(LAUNCHER_REGISTRY, 2, 2), (BACKEND_REGISTRY, 3, 1)] {
            let parsed: Value = serde_json::from_str(registry).unwrap();
            let mut actual = parsed["patches"].as_array().unwrap().clone();
            actual.extend(parsed["addedSources"].as_array().unwrap().clone());
            require_source_records(&actual, registry, patches, added).unwrap();
            let removed = actual.pop().unwrap();
            assert!(require_source_records(&actual, registry, patches, added).is_err());
            actual.push(removed);
            actual[0]["sha256"] = json!("0".repeat(64));
            assert!(require_source_records(&actual, registry, patches, added).is_err());
        }
    }
    #[test]
    fn fixed_headless_dispatch_rejects_extra_paths_unknown_versions_and_invalid_encoding() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        assert_eq!(crate::dispatch_private_service_issuer(vec![]), None);
        assert_eq!(
            crate::dispatch_private_service_issuer(vec!["blackcrab-remote://pair".into()]),
            None
        );
        // Actual unit-test executable is not an installed issuer; no authority or GUI.
        assert_eq!(
            crate::dispatch_private_service_issuer(vec!["__blackcrab-service-issuer-v1".into()]),
            Some(1)
        );
        for args in [
            vec![OsString::from("__blackcrab-service-issuer-v2")],
            vec![
                OsString::from("__blackcrab-service-issuer-v1"),
                OsString::from("/arbitrary/root"),
            ],
            vec![OsString::from_vec(
                b"__blackcrab-service-issuer-\xff".to_vec(),
            )],
        ] {
            assert_eq!(crate::dispatch_private_service_issuer(args), Some(64));
        }
    }
    #[test]
    fn only_a_genuine_different_boot_retires_uncertain_issuance_monotonically() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        // Core owns the captured lease; retire requires a separate startup after drop.
        let previous = read_journal(&fixture.0).unwrap().unwrap();
        drop(core);
        let _service =
            managed_payload::owned_lock(&fixture.0.join("service-owner.lock"), false).unwrap();
        let _launcher =
            managed_payload::owned_lock(&fixture.0.join("launcher.lock"), false).unwrap();
        let next = "a7e29119-7aee-46e8-86f1-212756a4da80";
        let retired = reconcile_after_boot(&fixture.0, Some(previous.clone()), 7, next)
            .unwrap()
            .unwrap();
        assert_eq!(retired.phase, Phase::Retired);
        assert_eq!(retired.epoch, previous.epoch);
        assert_eq!(retired.session, previous.session);
        assert_eq!(retired.boot_session_id.as_deref(), Some(next));
        assert_eq!(read_journal(&fixture.0).unwrap().unwrap(), retired);
        assert_eq!(next_epoch(retired.epoch), Some(2));
    }
    #[test]
    fn same_boot_legacy_missing_bad_identity_or_changed_selection_never_recovers() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        let original = private_bytes(&fixture.0.join(JOURNAL), LIMIT).unwrap();
        let previous = read_journal(&fixture.0).unwrap().unwrap();
        assert!(
            reconcile_after_boot(&fixture.0, Some(previous.clone()), 7, &core.boot_session_id)
                .is_err()
        );
        assert!(reconcile_after_boot(
            &fixture.0,
            Some(previous.clone()),
            8,
            "a7e29119-7aee-46e8-86f1-212756a4da80"
        )
        .is_err());
        assert!(reconcile_after_boot(&fixture.0, Some(previous.clone()), 7, "").is_err());
        let mut legacy = previous.clone();
        legacy.boot_session_id = None;
        assert!(reconcile_after_boot(
            &fixture.0,
            Some(legacy),
            7,
            "a7e29119-7aee-46e8-86f1-212756a4da80"
        )
        .is_err());
        let mut malformed = previous;
        malformed.boot_session_id = Some("not-a-kernel-uuid".into());
        assert!(reconcile_after_boot(
            &fixture.0,
            Some(malformed),
            7,
            "a7e29119-7aee-46e8-86f1-212756a4da80"
        )
        .is_err());
        assert_eq!(
            private_bytes(&fixture.0.join(JOURNAL), LIMIT).unwrap(),
            original
        );
    }
    #[test]
    fn changed_boot_reconciliation_cannot_acknowledge_failed_durable_publication() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        let previous = read_journal(&fixture.0).unwrap().unwrap();
        fs::remove_file(fixture.0.join(JOURNAL)).unwrap();
        fs::create_dir(fixture.0.join(JOURNAL)).unwrap();
        assert!(reconcile_after_boot(
            &fixture.0,
            Some(previous),
            7,
            "a7e29119-7aee-46e8-86f1-212756a4da80"
        )
        .is_err());
        assert!(fixture.0.join(JOURNAL).is_dir());
    }
    #[test]
    fn node_safe_integer_contract_rejects_zero_overflow_and_exhausted_epochs() {
        for number in [0, MAX_SAFE + 1, u64::MAX] {
            for (epoch, generation) in [(number, 7), (1, number)] {
                assert!(decode(
                    &frame(
                        &json!({"type":"begin","protocol":1,"epoch":epoch,"generation":generation})
                    )
                    .unwrap()
                )
                .is_err());
            }
            assert!(decode(
                &frame(
                    &json!({"type":"issued","protocol":1,"epoch":number,"session":"c".repeat(64)})
                )
                .unwrap()
            )
            .is_err());
        }
        assert!(decode(
            &frame(&json!({"type":"begin","protocol":1,"epoch":MAX_SAFE,"generation":MAX_SAFE}))
                .unwrap()
        )
        .is_ok());
        assert_eq!(next_epoch(MAX_SAFE), None);
        assert_eq!(next_epoch(MAX_SAFE - 1), Some(MAX_SAFE));
        assert_eq!(generation_from_entropy([255; 8]), MAX_SAFE);
        assert_eq!(generation_from_entropy([0; 8]), 1);
        let fixture = Fixture::new();
        let mut journal = Journal {
            schema: 1,
            generation: MAX_SAFE,
            epoch: MAX_SAFE,
            session: "c".repeat(64),
            phase: Phase::Retired,
            boot_session_id: Some("27e29119-7aee-46e8-86f1-212756a4da80".into()),
        };
        save_journal(&fixture.0, &journal).unwrap();
        assert_eq!(read_journal(&fixture.0).unwrap().unwrap(), journal);
        journal.epoch = MAX_SAFE + 1;
        assert!(save_journal(&fixture.0, &journal).is_err());
        fs::write(
            fixture.0.join(JOURNAL),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        assert!(read_journal(&fixture.0).is_err());
        let mut core = fixture.core();
        core.journal = Some(Journal {
            schema: 1,
            generation: 7,
            epoch: MAX_SAFE,
            session: core.session.clone(),
            phase: Phase::Retired,
            boot_session_id: Some("27e29119-7aee-46e8-86f1-212756a4da80".into()),
        });
        assert!(core.begin(MAX_SAFE, 7).is_err());
    }
    #[test]
    fn existing_environment_identity_is_not_narrowed_to_uuid() {
        for value in [
            "legacy_environment",
            "My existing local environment",
            "環境",
        ] {
            assert!(valid_environment(value));
        }
        for value in ["", " bad", "bad ", "bad\nvalue", "\u{feff}bad"] {
            assert!(!valid_environment(value));
        }
        assert!(!valid_environment(&"😀".repeat(65)));
    }
    #[test]
    fn framing_rejects_unknown_fields_multiline_oversize_and_authority_paths() {
        for bytes in [
            b"{}".as_slice(),
            b"{}\n{}\n",
            b"{\"type\":\"begin\",\"protocol\":1,\"epoch\":1,\"generation\":7,\"path\":\"/tmp\"}\n",
            b"{\"type\":\"issued\",\"protocol\":1,\"epoch\":1,\"session\":\"x\",\"pid\":1}\n",
        ] {
            assert!(decode(bytes).is_err());
        }
        assert!(decode(&vec![b'x'; LIMIT + 1]).is_err());
        assert!(
            decode(b"{\"type\":\"begin\",\"protocol\":1,\"epoch\":1,\"generation\":7}\n").is_ok()
        );
    }
    #[test]
    fn exact_original_envelope_is_private_and_transaction_releases_before_trial_ready() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        let response = prepare(&mut core);
        let envelope = &response["envelope"];
        assert_eq!(envelope["desktopBootstrapSecret"], "d".repeat(64));
        let now = now_ms().unwrap();
        assert!([now.saturating_sub(1), now, now + 1]
            .iter()
            .any(|n| bootstrap_token(&"d".repeat(64), *n).unwrap()
                == envelope["desktopBootstrapToken"].as_str().unwrap()));
        assert_eq!(envelope["kind"], "blackcrab-owned-service-auth-v1");
        assert_eq!(envelope["binding"]["generation"], 7);
        assert_eq!(envelope.as_object().unwrap().len(), 5);
        for key in [
            "mode",
            "host",
            "port",
            "t3Home",
            "tailscaleServeEnabled",
            "tailscaleServePort",
            "privateNetworkOnly",
        ] {
            assert!(envelope.get(key).is_none());
        }
        let bytes = private_bytes(&fixture.0.join(JOURNAL), LIMIT).unwrap();
        assert!(!String::from_utf8(bytes).unwrap().contains(&"d".repeat(64)));
        assert_eq!(
            read_journal(&fixture.0).unwrap().unwrap().phase,
            Phase::Prepared
        );
        let session = core.session.clone();
        core.issued(1, &session).unwrap();
        assert!(core.transaction.is_none());
        // Actual cross-FD lease reacquisition, with no HTTP/native child or prepared IPC.
        let lease = managed_payload::owned_lock(&fixture.0.join("launcher.lock"), false).unwrap();
        drop(lease);
        core.retire(1, &session).unwrap();
        assert_eq!(
            read_journal(&fixture.0).unwrap().unwrap().phase,
            Phase::Retired
        );
    }
    #[test]
    fn stale_epoch_session_replay_and_unretired_restart_fail_closed() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        assert!(core.issued(2, &core.session.clone()).is_err());
        assert!(core.issued(1, "stale").is_err());
        assert!(core.retire(1, &core.session.clone()).is_err());
        assert!(core.begin(2, 7).is_err());
        let session = core.session.clone();
        core.issued(1, &session).unwrap();
        assert!(core.issued(1, &session).is_err());
        assert_ne!(
            read_journal(&fixture.0).unwrap().unwrap().phase,
            Phase::Retired
        );
        core.retire(1, &session).unwrap();
        assert!(core.begin(1, 7).is_err());
        assert!(core.begin(2, 8).is_err());
    }
    #[test]
    fn failed_journal_commit_poisoned_session_cannot_retry() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        fs::remove_file(fixture.0.join(JOURNAL)).unwrap();
        fs::create_dir(fixture.0.join(JOURNAL)).unwrap();
        assert!(core.issued(1, &core.session.clone()).is_err());
        assert!(core.poisoned);
        fs::remove_dir(fixture.0.join(JOURNAL)).unwrap();
        assert!(core.issued(1, &core.session.clone()).is_err());
        assert!(core.retire(1, &core.session.clone()).is_err());
    }
    #[test]
    fn unverified_selection_cannot_mint_auth_envelope() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        assert!(core.begin(1, 7).is_err());
        assert!(!fixture.0.join(JOURNAL).exists());
        assert!(
            NativeIssuer::open_installed(&fixture.0.join("arbitrary-helper"), &"b".repeat(64))
                .is_err()
        );
    }
    #[test]
    fn delivery_timeout_and_transcript_budget_fail_closed() {
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        assert!(core.delivery_deadline().is_some());
        core.pending_deadline = Some(Instant::now() - Duration::from_secs(1));
        assert!(core.handle_frame(b"{}\n").is_err());
        assert!(core.poisoned);
        drop(core);
        let mut core = fixture.core();
        core.transcript_bytes = 16 * 1024 * 1024;
        assert!(core.handle_frame(b"{}\n").is_err());
        assert!(core.poisoned);
    }
    #[test]
    fn real_private_stream_loop_issues_retires_and_handles_clean_eof() {
        use std::io::{BufRead, BufReader};
        use std::os::unix::{io::AsRawFd, net::UnixStream};
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        let session = core.session.clone();
        let (server, mut client) = UnixStream::pair().unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let task = std::thread::spawn(move || {
            let result = run_io(&mut core, server.as_raw_fd(), server.as_raw_fd());
            (result, core.journal.unwrap().phase)
        });
        for phase in ["issued", "retire"] {
            let request = json!({"type":phase,"protocol":1,"epoch":1,"session":session});
            client.write_all(&frame(&request).unwrap()).unwrap();
            let mut response = String::new();
            BufReader::new(&client).read_line(&mut response).unwrap();
            let response: Value = serde_json::from_str(&response).unwrap();
            assert_eq!(
                response["type"],
                if phase == "issued" {
                    "issued"
                } else {
                    "retired"
                }
            );
        }
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let (result, phase) = task.join().unwrap();
        assert!(result.is_ok());
        assert_eq!(phase, Phase::Retired);
    }
    #[test]
    fn real_stream_eof_during_prepared_phase_is_uncertain_and_never_retires() {
        use std::os::unix::{io::AsRawFd, net::UnixStream};
        let fixture = Fixture::new();
        let mut core = fixture.core();
        prepare(&mut core);
        let (server, client) = UnixStream::pair().unwrap();
        drop(client);
        assert!(run_io(&mut core, server.as_raw_fd(), server.as_raw_fd()).is_err());
        assert_eq!(
            read_journal(&fixture.0).unwrap().unwrap().phase,
            Phase::Prepared
        );
        assert!(wait_fd(
            server.as_raw_fd(),
            libc::POLLIN,
            Some(Instant::now() - Duration::from_secs(1))
        )
        .is_err());
    }
    #[test]
    fn native_binding_publication_never_migrates_direct_or_replaces_binding() {
        let fixture = Fixture::new();
        let host = ManagedHost::new(fixture.0.clone());
        super::super::write_new(
            &fixture.0.join(".blackcrab-managed-host"),
            MARKER.as_bytes(),
        )
        .unwrap();
        let mut config = config();
        config.ownership = OwnershipMode::Direct;
        host.save_config(&config).unwrap();
        let before = fs::read(fixture.0.join("configuration.json")).unwrap();
        assert!(publish_verified_current(
            &host,
            &std::env::current_exe().unwrap(),
            &"b".repeat(64)
        )
        .is_err());
        assert_eq!(
            fs::read(fixture.0.join("configuration.json")).unwrap(),
            before
        );
        assert!(!fixture.0.join("issuer").exists());
        super::super::write_new(&fixture.0.join(BINDING), b"existing-native-binding").unwrap();
        assert!(publish_verified_current(
            &host,
            &std::env::current_exe().unwrap(),
            &"b".repeat(64)
        )
        .is_err());
        assert_eq!(
            fs::read(fixture.0.join(BINDING)).unwrap(),
            b"existing-native-binding"
        );
    }
    #[test]
    fn installed_copy_checks_actual_bytes_mode_and_regular_unlinked_file() {
        let fixture = Fixture::new();
        let file = fixture.0.join("blackcrab-issuer");
        fs::write(&file, b"synthetic-copy-not-executable-authority").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o700)).unwrap();
        let hash = digest_file(&file, 1024).unwrap();
        verify_installed_copy(&fixture.0, &file, &hash).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(verify_installed_copy(&fixture.0, &file, &hash).is_err());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(&file, b"tampered").unwrap();
        assert!(verify_installed_copy(&fixture.0, &file, &hash).is_err());
        fs::hard_link(&file, fixture.0.join("alias")).unwrap();
        assert!(digest_file(&file, 1024).is_err());
    }
    #[test]
    fn private_records_reject_links_modes_unknown_fields_and_oversize() {
        let fixture = Fixture::new();
        let journal = Journal {
            schema: 1,
            generation: 7,
            epoch: 1,
            session: "c".repeat(64),
            phase: Phase::Prepared,
            boot_session_id: Some("27e29119-7aee-46e8-86f1-212756a4da80".into()),
        };
        save_journal(&fixture.0, &journal).unwrap();
        fs::set_permissions(fixture.0.join(JOURNAL), fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_journal(&fixture.0).is_err());
        fs::remove_file(fixture.0.join(JOURNAL)).unwrap();
        std::os::unix::fs::symlink("elsewhere", fixture.0.join(JOURNAL)).unwrap();
        assert!(read_journal(&fixture.0).is_err());
        assert!(!hex_digest(&"G".repeat(64)));
        assert!(hex_digest(&"a".repeat(64)));
    }
}
