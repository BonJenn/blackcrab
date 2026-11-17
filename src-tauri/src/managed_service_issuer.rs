//! Private child of managed_host; service activation/migration remain unavailable.
//! No renderer constructor, remote endpoint, PID authority, service activation or GUI startup.
#![cfg(any(unix, windows))]
#[path = "managed_service_boot_session.rs"]
mod boot_session;

use super::{bootstrap_token, now_ms, Configuration, ManagedHost, OwnershipMode, MARKER};
use crate::{managed_artifact, managed_payload};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::io::RawFd;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use platform::ISSUER_NAME;
const LIMIT: usize = 64 * 1024;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
const AUTH_REGISTRY: &str =
    include_str!("../../fork-integration/boot-service/owned-auth/registry.json");
const LAUNCHER_REGISTRY: &str =
    include_str!("../../fork-integration/boot-service/launcher-adapter/registry.json");
const BACKEND_REGISTRY: &str =
    include_str!("../../fork-integration/boot-service/backend-identity/registry.json");
const BROWSER_REGISTRY: &str = include_str!("../../fork-integration/boot-service/browser-channel/registry.json");
const BINDING: &str = "native-issuer-binding.json";
const JOURNAL: &str = "native-issuer-epoch.json";
const REGISTRY: &str = include_str!("../../fork-integration/boot-service/registry.json");
type Result<T> = std::result::Result<T, String>;
fn invalid() -> String {
    "Background service issuer is unavailable".into()
}
/// Service runtimes that earlier releases installed, by manifest digest: 0.4.0
/// to 0.4.4, then 0.4.5 and 0.4.6 on Apple silicon, and 0.4.4 to 0.4.6 on Linux
/// and Windows. Service builds are not byte-reproducible, so every release has its
/// own digests and each one must be listed here before the next is built. One is accepted
/// only to stop and unregister that service and then replace its runtime. It is
/// never attached to, started, or issued credentials.
#[cfg(target_os = "macos")]
const PREDECESSORS: &[&str] = &["c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83", "eda8408d56339d98d5e6905b417295add611f0afca1af73bb1da60cf5cbb2160", "abc8ff1e6868528a97c45bd2bf37507b90887026ddac6df2e72e2c3d3d034a67"];
#[cfg(target_os = "linux")]
const PREDECESSORS: &[&str] = &["491d73ac66be7a27338adace318d7dd41f3c107b5e4ec3be68b7e1de7a791775", "3819159dd522d732303965ca5d81679d274e4a7393d8d248bd00388ec5e1baa9", "251c0544067d2f25ce17add23f06c85da4a1d22708e74d3c8873851e04bfa1f2"];
#[cfg(windows)]
const PREDECESSORS: &[&str] = &["54e12d14ab2455530dbce83c3028940595eed637181514264059087610097648", "608b24056ac3f118a881b35e99a484925a5d962bb4bfd9cd1f30d26d76bae495", "a17422616ca56e8d0eebbd7f19f3b17964961ab8181b8800a5ebade0c5090ad2"];
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
const PREDECESSORS: &[&str] = &[];
#[cfg(test)]
thread_local! { static TEST_PREDECESSOR: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) }; }
fn predecessor(digest: &str) -> bool {
    #[cfg(test)]
    if TEST_PREDECESSOR.with(|value| value.borrow().as_deref() == Some(digest)) {
        return true;
    }
    PREDECESSORS.contains(&digest)
}
fn compiled_manifest() -> Result<&'static str> {
    option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256").filter(|value| hex_digest(value)).ok_or_else(invalid)
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
    #[serde(skip_serializing_if = "Option::is_none")]
    desktop_browser_socket: Option<&'a crate::managed_browser::Capability>,
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
        let began = Instant::now();
        let (owner, binding) = installed_layout(executable, expected)?;
        let owner = owner.as_path();
        let step = |name: &str| note(owner, &format!("issuer {name} at {} ms", began.elapsed().as_millis()));
        step("layout verified");
        let session_lease = managed_payload::owned_lock(&owner.join("service-owner.lock"), true)
            .map_err(|_| { step("service-owner lock refused"); invalid() })?;
        let host = ManagedHost::new(owner.to_path_buf());
        // Lock order is service-owner then launcher. Never hold launcher over IPC trial commit.
        let transaction = managed_payload::owned_lock(&owner.join("launcher.lock"), true)
            .map_err(|_| { step("launcher lock refused"); invalid() })?;
        step("locks held");
        verify_selection(&host, &binding).inspect_err(|_| step("selection refused"))?;
        step("selection verified");
        let opened = Self::open_verified(owner, host, binding, session_lease, transaction);
        step(if opened.is_ok() { "open" } else { "reconciliation refused" });
        opened
    }
}
/// The owner directory and binding this helper is installed under. Authority is
/// the fixed layout around the running executable plus the compiled manifest
/// pin, never a path or digest supplied by a caller.
/// A step and its time, beside the service log. Windows only: there the
/// helper has no console and no journal. Never a path or a secret.
#[cfg(windows)]
fn note(owner: &Path, line: &str) {
    if let Ok(mut log) = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(owner.join("logs").join("service-supervisor.log"))
    {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        let _ = writeln!(log, "{seconds} {line}");
    }
}
#[cfg(not(windows))]
fn note(_owner: &Path, _line: &str) {}
fn installed_layout(executable: &Path, expected: &str) -> Result<(PathBuf, Binding)> {
    {
        // owner/issuer/<selfSHA>/blackcrab-issuer, never a request-selected root.
        if executable.file_name().and_then(|x| x.to_str()) != Some(ISSUER_NAME) {
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
        if !platform::canonical(executable) {
            return Err(invalid());
        }
        platform::private_executable(executable)?;
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
        Ok((owner.to_path_buf(), binding))
    }
}
impl NativeIssuer {
    fn open_verified(
        owner: &Path,
        host: ManagedHost,
        binding: Binding,
        session_lease: File,
        transaction: File,
    ) -> Result<Self> {
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
            .map_err(|error| { note(&self.host.root, &format!("issuer begin: launcher lock refused ({error})")); invalid() })?;
        let config = verify_selection(&self.host, &self.binding)
            .inspect_err(|_| note(&self.host.root, "issuer begin: selection refused"))?;
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
        if let Some(browser) = &config.browser { browser.validate(&self.host.root)?; }
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
            desktop_browser_socket: config.browser.as_ref(),
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
        // The request kind only; frames carry secrets and are never recorded.
        let kind = ["begin", "issued", "retire"]
            .into_iter()
            .find(|kind| bytes.windows(kind.len() + 2).any(|part| part == format!("\"{kind}\"").as_bytes()))
            .unwrap_or("unknown");
        note(&self.host.root, &format!("issuer request {kind}: {}", if outcome.is_ok() { "answered" } else { "refused" }));
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
#[cfg(unix)]
pub(super) fn run_private_stdio() -> Result<()> {
    let mut issuer = NativeIssuer::from_installed_executable()?;
    // Preflight/reconciliation completes before original launcher DB recovery begins.
    let ready = issuer.ready_frame()?;
    issuer.transcript_bytes = ready.len();
    write_private_response(libc::STDOUT_FILENO, &ready)?;
    run_io(&mut issuer, libc::STDIN_FILENO, libc::STDOUT_FILENO)
}
// Windows: the inherited standard pipes are synchronous, so the same framing,
// bounds and deadlines run over issuer_io's blocking threads instead of poll.
#[cfg(windows)]
pub(super) fn run_private_stdio() -> Result<()> {
    let mut issuer = NativeIssuer::from_installed_executable()?;
    let (mut input, mut output) = super::issuer_io::standard_pipes().map_err(|_| invalid())?;
    // Preflight/reconciliation completes before original launcher DB recovery begins.
    let ready = issuer.ready_frame()?;
    issuer.transcript_bytes = ready.len();
    write_pipe_response(&mut output, &ready)?;
    run_pipes(&mut issuer, &mut input, &mut output)
}
#[cfg(windows)]
fn run_pipes(
    issuer: &mut NativeIssuer,
    input: &mut super::issuer_io::PrivateInput,
    output: &mut super::issuer_io::PrivateOutput,
) -> Result<()> {
    let mut line = Vec::new();
    let mut frame_deadline = None;
    loop {
        let deadline = match (issuer.delivery_deadline(), frame_deadline) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        let Some(byte) = input.read_byte(deadline).map_err(|_| invalid())? else {
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
        };
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
        write_pipe_response(output, &response)?;
    }
}
#[cfg(windows)]
fn write_pipe_response(output: &mut super::issuer_io::PrivateOutput, response: &[u8]) -> Result<()> {
    if response.len() > LIMIT {
        return Err(invalid());
    }
    output
        .write_frame(response, Duration::from_secs(5))
        .map_err(|_| invalid())
}
#[cfg(unix)]
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
#[cfg(unix)]
struct NonblockingPrivateFd {
    fd: RawFd,
    flags: i32,
}
#[cfg(unix)]
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
#[cfg(unix)]
impl Drop for NonblockingPrivateFd {
    fn drop(&mut self) {
        unsafe {
            libc::fcntl(self.fd, libc::F_SETFL, self.flags);
        }
    }
}
#[cfg(unix)]
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
#[cfg(unix)]
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
/// Bytes are built and signed as a standalone CLI before Root is signed. Root's
/// signature seals these bytes; copying Root itself loses its signed Info.plist.
fn bundled_issuer_source() -> Result<&'static [u8]> {
    #[cfg(blackcrab_bundled_service_issuer)]
    { Ok(include_bytes!(env!("BLACKCRAB_SERVICE_ISSUER_PATH"))) }
    #[cfg(not(blackcrab_bundled_service_issuer))]
    { Err("This build is missing its standalone background-service helper".into()) }
}
/// Publication neither migrates Direct ownership nor enables an OS unit.
pub(super) fn publish_current_issuer(host: &ManagedHost) -> Result<InstalledIssuer> {
    let expected = option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256").ok_or_else(invalid)?;
    publish_verified_source(host, bundled_issuer_source()?, expected)
}
#[cfg(test)]
fn publish_verified_current(host: &ManagedHost, actual_executable: &Path, expected: &str) -> Result<InstalledIssuer> {
    let source = private_or_public_regular(actual_executable, 256 * 1024 * 1024)?;
    publish_verified_source(host, &source, expected)
}
fn publish_verified_source(host: &ManagedHost, source: &[u8], expected: &str) -> Result<InstalledIssuer> {
    if !hex_digest(expected) || source.is_empty() || source.len() > 256 * 1024 * 1024 {
        return Err(invalid());
    }
    managed_payload::private_dir(&host.root).map_err(|_| invalid())?;
    if !platform::canonical(&host.root)
        || private_bytes(&host.root.join(".blackcrab-managed-host"), 64)? != MARKER.as_bytes()
    { return Err(invalid()); }
    let _service = managed_payload::owned_lock(&host.root.join("service-owner.lock"), true).map_err(|_| invalid())?;
    let _transaction = managed_payload::owned_lock(&host.root.join("launcher.lock"), true).map_err(|_| invalid())?;
    if fs::symlink_metadata(host.root.join(BINDING)).is_ok() { return Err(invalid()); }
    let config = host.read_config()?.ok_or_else(invalid)?;
    if config.ownership != OwnershipMode::Service || config.manifest_digest != expected { return Err(invalid()); }
    let self_sha = format!("{:x}", Sha256::digest(source));
    let mut entropy = [0u8; 8];
    getrandom::getrandom(&mut entropy).map_err(|_| invalid())?;
    let generation = generation_from_entropy(entropy);
    let binding = Binding { schema: 1, self_sha256: self_sha.clone(), manifest_sha256: expected.into(),
        generation, environment_id: config.environment_id.clone().ok_or_else(invalid)?, version: "0.1.7".into() };
    verify_payload_config(host, &binding)?;
    let installed = install_issuer_copy(host, source, &self_sha)?;
    verify_payload_config(host, &binding)?;
    verify_installed_copy(installed.parent().ok_or_else(invalid)?, &installed, &self_sha)?;
    publish_binding(host, &binding, false)?;
    Ok(InstalledIssuer { executable: installed, generation })
}
fn install_issuer_copy(host: &ManagedHost, source: &[u8], self_sha: &str) -> Result<PathBuf> {
    let issuer = host.root.join("issuer");
    private_directory_new_or_existing(&issuer)?;
    let target = issuer.join(self_sha);
    let installed = target.join(ISSUER_NAME);
    if fs::symlink_metadata(&target).is_ok() {
        verify_installed_copy(&target, &installed, self_sha)?;
    } else {
        let stage = issuer.join(format!(".native-issuer-{}", super::random_secret()?));
        platform::create_private_directory(&stage)?;
        let outcome = (|| {
            let mut file = platform::create_executable(&stage.join(ISSUER_NAME))?;
            file.write_all(source)
                .and_then(|_| file.sync_all())
                .map_err(|_| invalid())?;
            // Windows cannot rename a directory that holds an open file.
            drop(file);
            verify_installed_copy(&stage, &stage.join(ISSUER_NAME), self_sha)?;
            platform::sync_directory(&stage)?;
            managed_payload::publish_no_replace(&stage, &target).map_err(|_| invalid())?;
            platform::sync_directory(&issuer)
        })();
        if stage.exists() {
            let _ = fs::remove_dir_all(&stage);
        }
        outcome?;
    }
    Ok(installed)
}
fn publish_binding(host: &ManagedHost, binding: &Binding, replace: bool) -> Result<()> {
    let temp = host.root.join(format!(".issuer-binding-{}", super::random_secret()?));
    super::write_new(&temp, &serde_json::to_vec(binding).map_err(|_| invalid())?)?;
    let outcome = (|| {
        if replace {
            fs::rename(&temp, host.root.join(BINDING)).map_err(|_| invalid())?;
        } else {
            managed_payload::publish_no_replace(&temp, &host.root.join(BINDING)).map_err(|_| invalid())?;
        }
        platform::sync_directory(&host.root)
    })();
    if temp.exists() { let _ = fs::remove_file(&temp); }
    outcome
}
/// Called only by explicit install/start/restart after launchd confirms stopped.
/// Keep the selected environment, generation, service unit and journal unchanged.
/// Never repair an active or uncertain same-boot session, or migrate Direct data.
pub(super) fn refresh_bundled_issuer(host: &ManagedHost, config: &Configuration) -> Result<()> {
    #[cfg(not(blackcrab_bundled_service_issuer))]
    { let _ = (host, config); return Ok(()); }
    #[cfg(blackcrab_bundled_service_issuer)]
    {
        let source = bundled_issuer_source()?;
        let _service = managed_payload::owned_lock(&host.root.join("service-owner.lock"), true).map_err(|_| invalid())?;
        let _transaction = managed_payload::owned_lock(&host.root.join("launcher.lock"), true).map_err(|_| invalid())?;
        let mut binding = attachment_binding(host, config)?;
        stopped_control_journal(read_journal(&host.root)?.as_ref(), binding.generation, &boot_session::read_boot_session_id()?)?;
        let next_sha = format!("{:x}", Sha256::digest(source));
        if binding.self_sha256 == next_sha { return Ok(()); }
        let installed = install_issuer_copy(host, source, &next_sha)?;
        verify_selection(host, &binding)?;
        verify_installed_copy(installed.parent().ok_or_else(invalid)?, &installed, &next_sha)?;
        binding.self_sha256 = next_sha;
        publish_binding(host, &binding, true)
    }
}
fn private_directory_new_or_existing(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => managed_payload::private_dir(path).map_err(|_| invalid()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            platform::create_private_directory(path)?;
            managed_payload::private_dir(path).map_err(|_| invalid())
        }
        Err(_) => Err(invalid()),
    }
}
fn verify_installed_copy(directory: &Path, file: &Path, expected: &str) -> Result<()> {
    managed_payload::private_dir(directory).map_err(|_| invalid())?;
    platform::private_executable(file)?;
    if digest_file(file, 256 * 1024 * 1024)? != expected {
        return Err(invalid());
    }
    Ok(())
}
/// Read-only attachment selection. Never takes the service-owner lease, mints
/// an envelope, changes the journal, or starts a process. The caller owns the
/// configuration snapshot is checked; the compiled manifest remains the trust anchor.
fn attachment_binding(host: &ManagedHost, expected_config: &Configuration) -> Result<Binding> {
    selected_binding(host, expected_config, compiled_manifest()?, true)
}
/// Selection for stopping or unregistering a service, and for confirming it has
/// stopped. Besides this build's own runtime it accepts a predecessor that the
/// configuration, binding and installed layout all name, so that the service an
/// earlier release installed can be stopped before its runtime is replaced.
fn control_binding(host: &ManagedHost, expected_config: &Configuration) -> Result<Binding> {
    let installed = expected_config.manifest_digest.as_str();
    if predecessor(installed) && compiled_manifest().ok() != Some(installed) {
        return selected_binding(host, expected_config, installed, false);
    }
    attachment_binding(host, expected_config)
}
fn selected_binding(host: &ManagedHost, expected_config: &Configuration, expected: &str, current: bool) -> Result<Binding> {
    let binding: Binding = serde_json::from_slice(&private_bytes(&host.root.join(BINDING), LIMIT)?)
        .map_err(|_| invalid())?;
    if binding.schema != 1 || !hex_digest(&binding.self_sha256)
        || binding.manifest_sha256 != expected || !safe_number(binding.generation)
        || binding.version != "0.1.7" || !valid_environment(&binding.environment_id) {
        return Err(invalid());
    }
    let issuer = host.root.join("issuer");
    managed_payload::private_dir(&issuer).map_err(|_| invalid())?;
    let directory = issuer.join(&binding.self_sha256);
    verify_installed_copy(&directory, &directory.join(ISSUER_NAME), &binding.self_sha256)?;
    let config = verify_selection_as(host, &binding, current)?;
    if serde_json::to_value(&config).map_err(|_| invalid())? != serde_json::to_value(expected_config).map_err(|_| invalid())? {
        return Err(invalid());
    }
    Ok(binding)
}
pub(super) fn attachment_selection(host: &ManagedHost, expected_config: &Configuration) -> Result<(String, String)> {
    let binding = attachment_binding(host, expected_config)?;
    Ok((binding.manifest_sha256, binding.version))
}
/// Native-only selection for an OS service plan. No deserialized caller receipt.
pub(super) fn control_generation(host: &ManagedHost, expected_config: &Configuration) -> Result<u64> {
    Ok(control_binding(host, expected_config)?.generation)
}
/// The installed helper, which the Windows scheduled task runs, and the
/// generation it is bound to. Same read-only selection as attachment.
#[cfg(windows)]
pub(super) fn service_helper(host: &ManagedHost, expected_config: &Configuration) -> Result<(PathBuf, u64)> {
    let binding = control_binding(host, expected_config)?;
    Ok((host.root.join("issuer").join(&binding.self_sha256).join(ISSUER_NAME), binding.generation))
}
/// Names one service instance for its scheduled task and its stop request:
/// unique to the owner directory, generation and environment.
#[cfg(windows)]
pub(super) fn service_key(root: &Path, generation: u64, environment: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"blackcrab-service-instance-v1\0");
    hash.update(root.to_string_lossy().to_lowercase().as_bytes());
    hash.update([0]);
    hash.update(generation.to_le_bytes());
    hash.update(environment.as_bytes());
    format!("{:x}", hash.finalize())[..32].to_string()
}
/// The Windows scheduled task's action. Starts the selected service launcher
/// under supervision and returns the process exit code: the launcher's own
/// when it ends by itself (a failure makes the task restart it), zero after a
/// requested stop.
#[cfg(windows)]
pub(super) fn run_service_supervisor() -> Result<i32> {
    let executable = std::env::current_exe().map_err(|_| invalid())?;
    let expected = option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256").ok_or_else(invalid)?;
    let (owner, binding) = installed_layout(&executable, expected)?;
    // The helper has no console and the scheduler keeps only an exit code, so
    // the reason a run ended is recorded beside the service's own log. The
    // lines name a step and a system error, never a path or a secret.
    let outcome = supervise_selected(&owner, &binding);
    let line = match &outcome {
        Ok((code, how)) => format!("supervisor ended: {how}, exit {code}"),
        Err(reason) => format!("supervisor failed: {reason}"),
    };
    note(&owner, &line);
    outcome.map(|(code, _)| code).map_err(|_| invalid())
}
#[cfg(windows)]
fn supervise_selected(owner: &Path, binding: &Binding) -> Result<(i32, &'static str)> {
    use crate::managed_service_run_windows::{supervise, Outcome, Plan};
    use std::ffi::OsString;
    let host = ManagedHost::new(owner.to_path_buf());
    let began = Instant::now();
    let config = {
        let _transaction = managed_payload::owned_lock(&owner.join("launcher.lock"), true)
            .map_err(|_| "launcher lock".to_string())?;
        verify_selection(&host, binding).map_err(|_| "selection".to_string())?
    };
    note(owner, &format!("supervisor verified selection in {} ms; starting service", began.elapsed().as_millis()));
    if config.ownership != OwnershipMode::Service {
        return Err("ownership".into());
    }
    // The service runs provider tools and terminals, so it gets the signed-in
    // user's ordinary Windows variables, by name, and nothing else inherited.
    let mut environment: Vec<(OsString, OsString)> = [
        "SystemRoot", "SystemDrive", "windir", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA",
        "LOCALAPPDATA", "ProgramData", "ALLUSERSPROFILE", "PUBLIC", "ProgramFiles",
        "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)",
        "CommonProgramW6432", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERNAME", "USERDOMAIN",
        "COMPUTERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
    ]
    .iter()
    .filter_map(|name| std::env::var_os(name).map(|value| (OsString::from(*name), value)))
    .collect();
    let mut path = config.artifact_path.clone().into_os_string();
    if let Some(inherited) = std::env::var_os("PATH") {
        path.push(";");
        path.push(inherited);
    }
    let stamp = json!({"schema":1,"root":owner,"manifestSha256":binding.manifest_sha256,
        "generation":binding.generation,"environmentId":binding.environment_id});
    environment.extend([
        (OsString::from("PATH"), path),
        (OsString::from("T3CODE_HOME"), owner.join("host").into_os_string()),
        (OsString::from("T3_BOOT_SERVICE_UNIT"), OsString::from("blackcrab.service")),
        (OsString::from("BLACKCRAB_NATIVE_SERVICE_OWNER"), OsString::from(stamp.to_string())),
    ]);
    let plan = Plan {
        executable: config.artifact_path.join("t3.exe"),
        arguments: vec!["__service-launcher".into()],
        environment,
        directory: owner.to_path_buf(),
        log: Some(owner.join("logs").join("boot-service.log")),
        key: service_key(owner, binding.generation, &binding.environment_id),
        grace: Duration::from_secs(90),
        // Windows allows a program only a few seconds once a session is ending.
        session_grace: Duration::from_secs(4),
    };
    match supervise(&plan) {
        Ok(Outcome::Exited(code)) => Ok((code as i32, "service exited by itself")),
        Ok(Outcome::Stopped(_)) => Ok((0, "service stopped cleanly on request")),
        Ok(Outcome::Killed) => Ok((0, "service did not stop in time and was ended")),
        // Another supervisor already runs this service in this session.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok((0, "already running")),
        Err(error) => Err(format!("supervise ({:?}, os {:?})", error.kind(), error.raw_os_error())),
    }
}

fn stopped_control_journal(previous: Option<&Journal>, generation: u64, current_boot: &str) -> Result<()> {
    if boot_session::normalize(current_boot.as_bytes()).as_deref() != Ok(current_boot) { return Err(invalid()); }
    let Some(journal) = previous else { return Ok(()); };
    if journal.generation != generation { return Err(invalid()); }
    if journal.phase == Phase::Retired { return Ok(()); }
    let old = journal.boot_session_id.as_deref().ok_or_else(invalid)?;
    if boot_session::normalize(old.as_bytes()).as_deref() != Ok(old) || old == current_boot {
        return Err("The native service session requires recovery before it can be restarted".into());
    }
    // Predict only. The installed issuer performs any durable prior-boot
    // reconciliation; a service-control action never rewrites an epoch.
    Ok(())
}
pub(super) fn require_stopped_for_control(host: &ManagedHost, config: &Configuration) -> Result<()> {
    let _session = managed_payload::owned_lock(&host.root.join("service-owner.lock"), true)
        .map_err(|_| "The native service session is still active".to_owned())?;
    let _transaction = managed_payload::owned_lock(&host.root.join("launcher.lock"), true).map_err(|_| invalid())?;
    let binding = control_binding(host, config)?;
    stopped_control_journal(read_journal(&host.root)?.as_ref(), binding.generation, &boot_session::read_boot_session_id()?)
}

const RUNTIME_VERSION: &str = "0.1.7";
/// Where the installed service runtime stands relative to this build.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum UpgradePhase {
    /// This build's runtime, or something the ordinary checks will refuse.
    Current,
    /// An earlier release's runtime, complete and consistent.
    Legacy,
    /// A replacement that began and did not finish.
    Replacing,
}
fn installed_binding(host: &ManagedHost) -> Result<Binding> {
    let binding: Binding = serde_json::from_slice(&private_bytes(&host.root.join(BINDING), LIMIT)?)
        .map_err(|_| invalid())?;
    if binding.schema != 1 || !hex_digest(&binding.self_sha256) || !hex_digest(&binding.manifest_sha256)
        || !safe_number(binding.generation) || binding.version != RUNTIME_VERSION
        || !valid_environment(&binding.environment_id) {
        return Err(invalid());
    }
    Ok(binding)
}
/// The manifest the installed version directory was published for, if there is one.
fn layout_manifest(host: &ManagedHost) -> Result<Option<String>> {
    let version = host.root.join("host/runtime/versions").join(RUNTIME_VERSION);
    match fs::symlink_metadata(&version) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(invalid()),
        Ok(_) => {}
    }
    let layout: Value = serde_json::from_slice(&private_bytes(&version.join(".blackcrab-service-layout.json"), LIMIT)?)
        .map_err(|_| invalid())?;
    match layout["manifestSha256"].as_str() {
        Some(digest) if hex_digest(digest) => Ok(Some(digest.to_owned())),
        _ => Err(invalid()),
    }
}
/// Read-only. A runtime this build does not know is reported as `Current`, so
/// that the ordinary checks refuse it exactly as before.
pub(super) fn upgrade_phase(host: &ManagedHost, config: &Configuration) -> Result<UpgradePhase> {
    let Ok(compiled) = compiled_manifest() else { return Ok(UpgradePhase::Current) };
    upgrade_phase_for(host, config, compiled)
}
fn upgrade_phase_for(host: &ManagedHost, config: &Configuration, compiled: &str) -> Result<UpgradePhase> {
    if config.ownership != OwnershipMode::Service || fs::symlink_metadata(host.root.join(BINDING)).is_err() {
        return Ok(UpgradePhase::Current);
    }
    let binding = installed_binding(host)?;
    let layout = layout_manifest(host)?;
    let values = [Some(config.manifest_digest.as_str()), Some(binding.manifest_sha256.as_str()), layout.as_deref()];
    if values.iter().all(|value| *value == Some(compiled))
        || !values.iter().flatten().all(|value| *value == compiled || predecessor(value)) {
        return Ok(UpgradePhase::Current);
    }
    let installed = config.manifest_digest.as_str();
    Ok(if installed != compiled && values.iter().all(|value| *value == Some(installed)) {
        UpgradePhase::Legacy
    } else {
        UpgradePhase::Replacing
    })
}
/// Replaces the runtime of a stopped, unregistered service with the one this
/// build bundles. Conversations, settings, credentials, the environment
/// identity and the service generation are kept; the previous runtime is moved
/// aside whole and the database is copied first. Each step is skipped if an
/// earlier attempt completed it, so an interrupted replacement is finished by
/// calling this again.
pub(super) fn replace_runtime(host: &ManagedHost, payload: &managed_payload::EmbeddedPayload) -> Result<()> {
    let compiled = compiled_manifest()?;
    if payload.expected_host_manifest_sha256() != Some(compiled) {
        return Err("The bundled service runtime differs from this build".into());
    }
    replace_runtime_with(host, compiled, bundled_issuer_source()?, |owner| {
        crate::managed_service_install::SelectedServiceRuntime::from_embedded(owner, payload)
            .map_err(|_| "The bundled runtime does not support background-service setup".to_owned())
    })
}
fn replace_runtime_with(
    host: &ManagedHost,
    compiled: &str,
    issuer: &[u8],
    select: impl FnOnce(PathBuf) -> Result<crate::managed_service_install::SelectedServiceRuntime>,
) -> Result<()> {
    let _service = managed_payload::owned_lock(&host.root.join("service-owner.lock"), true)
        .map_err(|_| "The native service session is still active".to_owned())?;
    let _transaction = managed_payload::owned_lock(&host.root.join("launcher.lock"), true).map_err(|_| invalid())?;
    let mut config = host.read_config()?.ok_or_else(invalid)?;
    let binding = installed_binding(host)?;
    if config.ownership != OwnershipMode::Service
        || config.environment_id.as_deref() != Some(binding.environment_id.as_str())
        || issuer.is_empty() || issuer.len() > 256 * 1024 * 1024 {
        return Err(invalid());
    }
    stopped_control_journal(read_journal(&host.root)?.as_ref(), binding.generation, &boot_session::read_boot_session_id()?)?;
    let layout = layout_manifest(host)?;
    let named = [Some(config.manifest_digest.clone()), Some(binding.manifest_sha256.clone()), layout.clone()];
    if !named.iter().flatten().all(|value| value == compiled || predecessor(value)) {
        return Err(invalid());
    }
    let previous: Vec<&String> = named.iter().flatten().filter(|value| *value != compiled).collect();
    if previous.windows(2).any(|pair| pair[0] != pair[1]) {
        return Err(invalid());
    }
    // 1. The runtime. After this the version directory is this build's.
    if layout.as_deref() != Some(compiled) {
        let previous = previous.first().ok_or_else(invalid)?.as_str();
        let retired = host.root.join("host/runtime/retired");
        private_directory_new_or_existing(&retired)?;
        let retired = retired.join(previous);
        if layout.is_some() {
            backup_user_data(host, previous)?;
        } else if fs::symlink_metadata(&retired).is_err() {
            // Neither the installed runtime nor the one this would have retired.
            return Err(invalid());
        }
        let mut installation = select(host.root.clone())?.prepare_replacement()
            .map_err(|_| "Service runtime preparation failed; the installed service was not changed".to_owned())?;
        installation.validate_version()
            .map_err(|_| "Service runtime validation failed; the installed service was not changed".to_owned())?;
        installation.commit_replacing(&retired)
            .map_err(|_| "Service runtime publication failed; reopen Blackcrab to try again".to_owned())?;
    }
    // 2. The configuration names the new runtime. Its path is unchanged.
    // Windows releases before 0.4.5 had no in-app browser channel; a service
    // upgraded from one gets its capability here, as a fresh setup would.
    #[cfg(windows)]
    let without_browser = config.browser.is_none();
    #[cfg(not(windows))]
    let without_browser = false;
    if config.manifest_digest != compiled || without_browser {
        config.manifest_digest = compiled.into();
        #[cfg(windows)]
        if without_browser {
            super::service_initialization::enable_native_browser(&mut config, &host.root)?;
        }
        host.save_config(&config)?;
        platform::sync_directory(&host.root)?;
    }
    // 3. This build's helper, bound to the same generation and environment.
    let self_sha = format!("{:x}", Sha256::digest(issuer));
    if binding.manifest_sha256 != compiled || binding.self_sha256 != self_sha {
        let installed = install_issuer_copy(host, issuer, &self_sha)?;
        let next = Binding { schema: 1, self_sha256: self_sha.clone(), manifest_sha256: compiled.into(),
            generation: binding.generation, environment_id: binding.environment_id.clone(), version: RUNTIME_VERSION.into() };
        verify_payload_config(host, &next)?;
        verify_installed_copy(installed.parent().ok_or_else(invalid)?, &installed, &self_sha)?;
        publish_binding(host, &next, true)?;
    }
    Ok(())
}
/// Copies the stopped service's database and settings beside its data before
/// its runtime is replaced. The copy is never read back automatically.
fn backup_user_data(host: &ManagedHost, previous: &str) -> Result<()> {
    let source = host.root.join("host/userdata");
    if fs::symlink_metadata(&source).is_err() {
        return Ok(());
    }
    let backups = host.root.join("host/upgrade-backups");
    private_directory_new_or_existing(&backups)?;
    let target = backups.join(&previous[..16]);
    if fs::symlink_metadata(&target).is_ok() {
        return Ok(());
    }
    let stage = backups.join(format!(".backup-{}", super::random_secret()?));
    platform::create_private_directory(&stage)?;
    let outcome = (|| {
        for name in ["statev2.sqlite", "statev2.sqlite-wal", "statev2.sqlite-shm", "settings.json", "keybindings.json"] {
            let from = source.join(name);
            match fs::symlink_metadata(&from) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Ok(metadata) if metadata.is_file() => {}
                _ => return Err(invalid()),
            }
            let copy = stage.join(name);
            fs::copy(&from, &copy).map_err(|_| invalid())?;
            // Flushing needs a writable handle on Windows.
            fs::OpenOptions::new().write(true).open(&copy).and_then(|file| file.sync_all()).map_err(|_| invalid())?;
        }
        platform::sync_directory(&stage)?;
        managed_payload::publish_no_replace(&stage, &target).map_err(|_| invalid())?;
        platform::sync_directory(&backups)
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(&stage);
    }
    outcome.map_err(|_: String| "The service database could not be copied; the installed service was not changed".to_owned())
}

fn verify_selection(host: &ManagedHost, binding: &Binding) -> Result<Configuration> {
    verify_selection_as(host, binding, true)
}
fn verify_selection_as(host: &ManagedHost, binding: &Binding, current: bool) -> Result<Configuration> {
    managed_payload::private_dir(&host.root).map_err(|_| invalid())?;
    if private_bytes(&host.root.join(".blackcrab-managed-host"), 64)? != MARKER.as_bytes() {
        return Err(invalid());
    }
    let installed: Binding = serde_json::from_slice(&private_bytes(&host.root.join(BINDING), LIMIT)?)
        .map_err(|_| invalid())?;
    if &installed != binding {
        return Err(invalid());
    }
    verify_payload_config_as(host, binding, current)
}
fn verify_payload_config(host: &ManagedHost, binding: &Binding) -> Result<Configuration> {
    verify_payload_config_as(host, binding, true)
}
/// `current` is false only for a predecessor being stopped. Its identity,
/// layout and payload integrity are checked as usual; the source records this
/// build requires of its own runtime are not, since a predecessor is never run.
fn verify_payload_config_as(host: &ManagedHost, binding: &Binding, current: bool) -> Result<Configuration> {
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
    if !current {
        return Ok(config);
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
    if config.browser.is_some() { require_source_records(actual, BROWSER_REGISTRY, 3, 1)?; }
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
    let mut file = platform::open_regular(path)?;
    if file.metadata().map_err(|_| invalid())?.len() > limit as u64 {
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
    let mut file = platform::open_regular(path)?;
    if file.metadata().map_err(|_| invalid())?.len() > limit as u64 || !platform::private_file(&file) {
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
/// Replaces the journal with its fully written successor. On Windows another
/// program, typically a virus scanner reading the file just written, can hold
/// the old journal open for a moment and the replacement is then refused; it
/// is retried for a bounded time. Nothing is ever written in place.
fn replace_journal(temp: &Path, journal: &Path) -> std::io::Result<u32> {
    let deadline = Instant::now() + Duration::from_secs(if cfg!(windows) { 3 } else { 0 });
    let mut refused = 0;
    loop {
        match fs::rename(temp, journal) {
            Err(error)
                if cfg!(windows)
                    && error.kind() == std::io::ErrorKind::PermissionDenied
                    && Instant::now() < deadline =>
            {
                refused += 1;
                std::thread::sleep(Duration::from_millis(20))
            }
            outcome => return outcome.map(|()| refused),
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
        let refused = replace_journal(&temp, &owner.join(JOURNAL)).map_err(|error| {
            note(owner, &format!("issuer journal replace failed ({:?}, os {:?})", error.kind(), error.raw_os_error()));
            invalid()
        })?;
        if refused > 0 {
            note(owner, &format!("issuer journal replaced after {refused} refusals"));
        }
        platform::sync_directory(owner)
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

/// The owner and permission checks behind the issuer's private files. Unix
/// reads UID and mode bits; Windows reads the handle's owner and DACL, where
/// "private" is what Unix expresses as 0700 and 0600.
#[cfg(unix)]
mod platform {
    use super::{invalid, Result};
    use std::{
        fs::{self, File, OpenOptions},
        os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        path::Path,
    };
    pub(super) const ISSUER_NAME: &str = "blackcrab-issuer";
    pub(super) fn canonical(path: &Path) -> bool {
        path.canonicalize().is_ok_and(|actual| actual == path)
    }
    pub(super) fn create_private_directory(path: &Path) -> Result<()> {
        fs::DirBuilder::new().mode(0o700).create(path).map_err(|_| invalid())
    }
    pub(super) fn create_executable(path: &Path) -> Result<File> {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|_| invalid())
    }
    /// A regular single-link file of ours with mode exactly 0700.
    pub(super) fn private_executable(path: &Path) -> Result<()> {
        let meta = fs::symlink_metadata(path).map_err(|_| invalid())?;
        if !meta.is_file()
            || meta.nlink() != 1
            || meta.uid() != unsafe { libc::geteuid() }
            || meta.mode() & 0o777 != 0o700
        {
            return Err(invalid());
        }
        Ok(())
    }
    /// Opens a regular single-link file without following a final symlink.
    pub(super) fn open_regular(path: &Path) -> Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|_| invalid())?;
        let metadata = file.metadata().map_err(|_| invalid())?;
        if !metadata.is_file() || metadata.nlink() != 1 {
            return Err(invalid());
        }
        Ok(file)
    }
    /// Ours, with mode exactly 0600.
    pub(super) fn private_file(file: &File) -> bool {
        file.metadata().is_ok_and(|metadata| {
            metadata.uid() == unsafe { libc::geteuid() } && metadata.mode() & 0o777 == 0o600
        })
    }
    pub(super) fn sync_directory(path: &Path) -> Result<()> {
        File::open(path).and_then(|f| f.sync_all()).map_err(|_| invalid())
    }
}
#[cfg(windows)]
mod platform {
    use super::{invalid, Result};
    use crate::managed_private_windows::{self as private, Access};
    use std::{
        fs::{File, OpenOptions},
        path::Path,
    };
    pub(super) const ISSUER_NAME: &str = "blackcrab-issuer.exe";
    /// The path names itself: no link, junction, relative or short-name
    /// component. canonicalize returns the verbatim form; drive letters and
    /// names compare without regard to case, as the filesystem does.
    pub(super) fn canonical(path: &Path) -> bool {
        path.canonicalize().is_ok_and(|actual| {
            let actual = actual.to_string_lossy();
            actual
                .strip_prefix(r"\\?\")
                .unwrap_or(&actual)
                .eq_ignore_ascii_case(&path.to_string_lossy())
        })
    }
    pub(super) fn create_private_directory(path: &Path) -> Result<()> {
        private::create_private_directory(path).map_err(|_| invalid())
    }
    /// Created inside a private directory, whose protected DACL it inherits.
    pub(super) fn create_executable(path: &Path) -> Result<File> {
        private::open_file(path, OpenOptions::new().write(true).create_new(true))
            .map_err(|_| invalid())
    }
    fn private_regular(path: &Path) -> Result<File> {
        let file = open_regular(path)?;
        private::security(&file, Access::Private).map_err(|_| invalid())?;
        Ok(file)
    }
    pub(super) fn private_executable(path: &Path) -> Result<()> {
        private_regular(path).map(|_| ())
    }
    /// A regular single-link file that is not a reparse point.
    pub(super) fn open_regular(path: &Path) -> Result<File> {
        private::open_file(path, OpenOptions::new().read(true)).map_err(|_| invalid())
    }
    pub(super) fn private_file(file: &File) -> bool {
        private::security(file, Access::Private).is_ok()
    }
    /// Directory entries cannot be flushed through a plain handle here. Each
    /// file is flushed and publication renames with write-through.
    pub(super) fn sync_directory(_path: &Path) -> Result<()> {
        Ok(())
    }
}
#[cfg(all(test, windows))]
#[path = "managed_service_issuer_windows_tests.rs"]
mod windows_tests;
#[cfg(all(test, unix))]
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
    fn browser_envelope_uses_only_the_native_owned_capability() {
        let fixture=Fixture::new();let mut core=fixture.core();
        let capability=crate::managed_browser::Capability::allocate(&fixture.0).unwrap();
        let mut configuration=config();configuration.browser=Some(capability.clone());
        let lease=managed_payload::owned_lock(&fixture.0.join("launcher.lock"),true).unwrap();
        let response:Value=serde_json::from_slice(&core.prepare_verified(1,7,configuration,lease).unwrap()).unwrap();
        assert_eq!(response["envelope"]["desktopBrowserSocket"],serde_json::to_value(&capability).unwrap());
        assert_eq!(response["envelope"].as_object().unwrap().len(),6);
        assert!(response["envelope"].get("host").is_none());
        drop(core);
        let foreign=Fixture::new();let mut core=foreign.core();let mut configuration=config();configuration.browser=Some(capability.clone());
        let lease=managed_payload::owned_lock(&foreign.0.join("launcher.lock"),true).unwrap();
        assert!(core.prepare_verified(1,7,configuration,lease).is_err());
        fs::remove_file(capability.path.parent().unwrap().join(".blackcrab-browser-owner.json")).unwrap();
        fs::remove_dir(capability.path.parent().unwrap()).unwrap();
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
        for (registry, patches, added) in [(LAUNCHER_REGISTRY, 2, 2), (BACKEND_REGISTRY, 3, 1), (BROWSER_REGISTRY, 3, 1)] {
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
    fn service_control_never_resets_uncertain_same_boot_issuance() {
        let boot="12345678-1234-1234-1234-123456789abc";
        let old="87654321-1234-1234-1234-123456789abc";
        let mut journal=Journal{schema:1,generation:7,epoch:3,session:"a".repeat(64),phase:Phase::Issued,boot_session_id:Some(boot.into())};
        let before=serde_json::to_vec(&journal).unwrap();
        assert!(stopped_control_journal(Some(&journal),7,boot).is_err());
        assert_eq!(serde_json::to_vec(&journal).unwrap(),before);
        journal.phase=Phase::Prepared;assert!(stopped_control_journal(Some(&journal),7,boot).is_err());
        journal.boot_session_id=None;assert!(stopped_control_journal(Some(&journal),7,boot).is_err());
        journal.boot_session_id=Some(old.into());assert!(stopped_control_journal(Some(&journal),7,boot).is_ok());
        assert!(stopped_control_journal(Some(&journal),8,boot).is_err());
        journal.phase=Phase::Retired;assert!(stopped_control_journal(Some(&journal),7,boot).is_ok());
        assert!(stopped_control_journal(None,7,boot).is_ok());assert!(stopped_control_journal(None,7,"invented-boot").is_err());
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
    #[cfg(all(target_os = "macos", blackcrab_bundled_service_issuer))]
    #[tokio::test]
    #[ignore = "requires signed standalone helper, real bundled host archive and a fresh private test root; no OS service activation"]
    async fn production_standalone_helper_and_stopped_upgrade() {
        use std::process::{Command, Stdio};
        let root = PathBuf::from(std::env::var_os("BLACKCRAB_SERVICE_ISSUER_TEST_ROOT").unwrap());
        assert_eq!(root.canonicalize().unwrap(), root);
        managed_payload::private_dir(&root).unwrap();
        assert!(fs::read_dir(&root).unwrap().next().is_none());
        let archive = PathBuf::from(std::env::var_os("BLACKCRAB_TEST_HOST_ARCHIVE").unwrap());
        let payload = managed_payload::EmbeddedPayload::new(managed_payload::PayloadRole::Host,
            archive, std::env::var("BLACKCRAB_TEST_HOST_ARCHIVE_SHA256").unwrap(),
            option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256").unwrap().into(), root.join("cache")).unwrap();
        let host = ManagedHost::new(root.join("owner")).with_bundled_payload(payload);
        host.initialize_service().await.unwrap();
        let config = host.read_config().unwrap().unwrap();
        let config_bytes = fs::read(host.root.join("configuration.json")).unwrap();
        let original = attachment_binding(&host, &config).unwrap();
        assert!(!host.root.join(JOURNAL).exists());
        // Reproduce the exact 0.4.1 copied app-binary layout in isolated data.
        let old_root = PathBuf::from(std::env::var_os("BLACKCRAB_TEST_LEGACY_ROOT_EXECUTABLE").unwrap());
        let old_bytes = private_or_public_regular(&old_root, 256 * 1024 * 1024).unwrap();
        let old_sha = format!("{:x}", Sha256::digest(&old_bytes));
        let old_file = install_issuer_copy(&host, &old_bytes, &old_sha).unwrap();
        let mut old = original; old.self_sha256 = old_sha;
        publish_binding(&host, &old, true).unwrap();
        let old_binding_bytes = fs::read(host.root.join(BINDING)).unwrap();
        let active_lease = managed_payload::owned_lock(&host.root.join("service-owner.lock"), true).unwrap();
        assert!(refresh_bundled_issuer(&host, &config).is_err());
        assert_eq!(fs::read(host.root.join(BINDING)).unwrap(), old_binding_bytes);
        drop(active_lease);
        refresh_bundled_issuer(&host, &config).unwrap();
        let updated = attachment_binding(&host, &config).unwrap();
        assert_ne!(updated.self_sha256, old.self_sha256);
        assert_eq!(updated.generation, old.generation);
        assert_eq!(updated.environment_id, old.environment_id);
        assert_eq!(fs::read(host.root.join("configuration.json")).unwrap(), config_bytes);
        assert_eq!(fs::read(old_file).unwrap(), old_bytes);
        assert!(!host.root.join(JOURNAL).exists());
        let executable = host.root.join("issuer").join(&updated.self_sha256).join("blackcrab-issuer");
        assert!(Command::new("/usr/bin/codesign").args(["--verify", "--strict"]).arg(&executable).status().unwrap().success());
        let mut child = Command::new(&executable).arg("__blackcrab-service-issuer-v1")
            .env_clear().env("PATH", "/usr/bin:/bin").current_dir(&host.root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        // The private protocol requires pipes/sockets; close our captured input
        // pipe for clean EOF rather than substituting /dev/null (a character device).
        drop(child.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(150);
        loop {
            if child.try_wait().unwrap().is_some() { break; }
            if Instant::now() >= deadline { child.kill().unwrap(); child.wait().unwrap(); panic!("Captured issuer preflight timed out"); }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "Captured standalone issuer did not exit cleanly");
        let ready: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(ready["type"], "ready");
        assert_eq!(ready["generation"], updated.generation);
        assert!(output.stderr.is_empty());
        assert!(!host.root.join(JOURNAL).exists());
        println!("Standalone Developer ID helper passed real private readiness and clean EOF; stopped upgrade retained configuration/generation; zero auth requests or provider commands");
    }
    const OLD: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const NEW: &str = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    fn installed(config_manifest: &str, binding_manifest: &str, layout: Option<&str>, ownership: OwnershipMode) -> (Fixture, ManagedHost, Configuration) {
        TEST_PREDECESSOR.with(|value| *value.borrow_mut() = Some(OLD.into()));
        let fixture = Fixture::new();
        let host = ManagedHost::new(fixture.0.clone());
        let version = fixture.0.join("host/runtime/versions/0.1.7");
        let config = Configuration { schema: 1, ownership, artifact_path: version.join("payload"),
            manifest_digest: config_manifest.into(), bootstrap_secret: "b".repeat(64),
            environment_id: Some("env_fixture".into()), browser: None };
        host.save_config(&config).unwrap();
        publish_binding(&host, &Binding { schema: 1, self_sha256: "a".repeat(64), manifest_sha256: binding_manifest.into(),
            generation: 7, environment_id: "env_fixture".into(), version: "0.1.7".into() }, false).unwrap();
        if let Some(manifest) = layout {
            fs::DirBuilder::new().mode(0o700).recursive(true).create(&version).unwrap();
            super::super::write_new(&version.join(".blackcrab-service-layout.json"),
                &serde_json::to_vec(&json!({"schema":1,"profile":"blackcrab-local-service-layout-v1","protocol":4,"version":"0.1.7","manifestSha256":manifest})).unwrap()).unwrap();
        }
        (fixture, host, config)
    }
    #[test]
    fn upgrade_phase_recognizes_only_a_complete_predecessor_or_an_unfinished_replacement() {
        use OwnershipMode::{Direct, Service};
        let phase = |config: &str, binding: &str, layout: Option<&str>, ownership| {
            let (_fixture, host, configuration) = installed(config, binding, layout, ownership);
            upgrade_phase_for(&host, &configuration, NEW).unwrap()
        };
        assert_eq!(phase(NEW, NEW, Some(NEW), Service), UpgradePhase::Current);
        assert_eq!(phase(OLD, OLD, Some(OLD), Service), UpgradePhase::Legacy);
        // Every interruption point of the replacement: runtime retired, runtime
        // published, configuration rewritten; the binding is rewritten last.
        for (config, binding, layout) in [(OLD, OLD, None), (OLD, OLD, Some(NEW)), (NEW, OLD, Some(NEW)), (NEW, NEW, None)] {
            assert_eq!(phase(config, binding, layout, Service), UpgradePhase::Replacing);
        }
        // A runtime this build does not know, or a direct owner, is not upgraded.
        let unknown = "d".repeat(64);
        assert_eq!(phase(&unknown, &unknown, Some(&unknown), Service), UpgradePhase::Current);
        assert_eq!(phase(OLD, &unknown, Some(OLD), Service), UpgradePhase::Current);
        assert_eq!(phase(OLD, OLD, Some(OLD), Direct), UpgradePhase::Current);
        assert!(predecessor(OLD) && !predecessor(NEW) && !predecessor(&unknown));
    }
    #[test]
    fn replacement_refuses_an_active_session_an_unknown_runtime_and_mixed_predecessors() {
        let select = |_: PathBuf| -> Result<crate::managed_service_install::SelectedServiceRuntime> { panic!("no runtime may be selected") };
        let (fixture, host, _) = installed(OLD, OLD, Some(OLD), OwnershipMode::Service);
        super::super::write_new(&fixture.0.join(".blackcrab-managed-host"), super::super::MARKER.as_bytes()).unwrap();
        let before = fs::read(fixture.0.join("configuration.json")).unwrap();
        let active = managed_payload::owned_lock(&fixture.0.join("service-owner.lock"), true).unwrap();
        assert_eq!(replace_runtime_with(&host, NEW, b"helper", select).unwrap_err(), "The native service session is still active");
        drop(active);
        let unknown = "d".repeat(64);
        for (config, binding, layout) in [(unknown.as_str(), OLD, Some(OLD)), (OLD, unknown.as_str(), Some(OLD)), (OLD, OLD, Some(unknown.as_str()))] {
            let (fixture, host, _) = installed(config, binding, layout, OwnershipMode::Service);
            super::super::write_new(&fixture.0.join(".blackcrab-managed-host"), super::super::MARKER.as_bytes()).unwrap();
            assert!(replace_runtime_with(&host, NEW, b"helper", select).is_err());
        }
        // Retired and installed runtimes both missing: nothing to publish over.
        let (fixture2, host2, _) = installed(OLD, OLD, None, OwnershipMode::Service);
        super::super::write_new(&fixture2.0.join(".blackcrab-managed-host"), super::super::MARKER.as_bytes()).unwrap();
        fs::DirBuilder::new().mode(0o700).recursive(true).create(fixture2.0.join("host/runtime")).unwrap();
        assert!(replace_runtime_with(&host2, NEW, b"helper", select).is_err());
        assert_eq!(fs::read(fixture.0.join("configuration.json")).unwrap(), before);
    }
    #[test]
    fn database_backup_is_a_private_copy_made_once_and_never_changes_the_original() {
        let (fixture, host, _) = installed(OLD, OLD, Some(OLD), OwnershipMode::Service);
        let data = fixture.0.join("host/userdata");
        fs::DirBuilder::new().mode(0o700).create(&data).unwrap();
        fs::write(data.join("statev2.sqlite"), b"conversations").unwrap();
        fs::write(data.join("statev2.sqlite-wal"), b"recent").unwrap();
        fs::write(data.join("settings.json"), b"{}").unwrap();
        fs::write(data.join("unrelated-large-cache"), b"not copied").unwrap();
        backup_user_data(&host, OLD).unwrap();
        let copy = fixture.0.join("host/upgrade-backups").join(&OLD[..16]);
        assert_eq!(fs::read(copy.join("statev2.sqlite")).unwrap(), b"conversations");
        assert_eq!(fs::read(copy.join("statev2.sqlite-wal")).unwrap(), b"recent");
        assert!(!copy.join("unrelated-large-cache").exists() && !copy.join("keybindings.json").exists());
        assert_eq!(fs::metadata(&copy).unwrap().permissions().mode() & 0o777, 0o700);
        // A second attempt keeps the first copy even though the database moved on.
        fs::write(data.join("statev2.sqlite"), b"newer").unwrap();
        backup_user_data(&host, OLD).unwrap();
        assert_eq!(fs::read(copy.join("statev2.sqlite")).unwrap(), b"conversations");
        assert_eq!(fs::read(data.join("statev2.sqlite")).unwrap(), b"newer");
        assert_eq!(fs::read_dir(fixture.0.join("host/upgrade-backups")).unwrap().count(), 1);
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
