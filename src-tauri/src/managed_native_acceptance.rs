//! Opt-in native integration helpers. This module exists only in macOS test binaries.
//! Live spawn tokens cannot be serialized/recreated from runtime records or PIDs.
#[path = "managed_native_diagnostics.rs"]
mod diagnostics;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::{
    collections::HashMap,
    ffi::{c_char, c_void, CStr},
    fs,
    path::{Path, PathBuf},
    process::{Child, ExitStatus},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::{Duration, Instant},
};

#[repr(C)]
#[derive(Default)]
struct BsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
    comm: [u8; 16],
    name: [u8; 32],
    files: u32,
    pgid: u32,
    jobc: u32,
    tty: u32,
    tty_pgid: u32,
    nice: i32,
    start_seconds: u64,
    start_micros: u64,
}
#[link(name = "proc")]
extern "C" {
    fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut c_void, size: i32) -> i32;
    fn proc_pidpath(pid: i32, buffer: *mut c_void, size: u32) -> i32;
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Identity {
    pub pid: u32,
    pub parent: u32,
    pub uid: u32,
    pub pgid: u32,
    pub birth_seconds: u64,
    pub birth_micros: u64,
    pub executable: PathBuf,
}
impl Identity {
    fn read(pid: u32) -> Result<Self, String> {
        let mut info = BsdInfo::default();
        let bytes = unsafe {
            proc_pidinfo(
                pid as i32,
                3,
                0,
                (&mut info as *mut BsdInfo).cast(),
                std::mem::size_of::<BsdInfo>() as i32,
            )
        };
        if bytes != std::mem::size_of::<BsdInfo>() as i32 || info.pid != pid {
            return Err("Captured process identity unavailable".into());
        }
        let mut file = vec![0u8; 4096];
        if unsafe { proc_pidpath(pid as i32, file.as_mut_ptr().cast(), file.len() as u32) } <= 0 {
            return Err("Captured process executable unavailable".into());
        }
        let value =
            CStr::from_bytes_until_nul(&file).map_err(|_| "Captured process path unavailable")?;
        let executable = PathBuf::from(
            value
                .to_str()
                .map_err(|_| "Captured process path encoding")?,
        )
        .canonicalize()
        .map_err(|_| "Captured executable unavailable")?;
        Ok(Self {
            pid,
            parent: info.ppid,
            uid: info.uid,
            pgid: info.pgid,
            birth_seconds: info.start_seconds,
            birth_micros: info.start_micros,
            executable,
        })
    }
    fn current(&self) -> bool {
        Self::read(self.pid).is_ok_and(|value| value == *self)
    }
}
struct HostToken {
    identity: Identity,
    root: PathBuf,
    root_device: u64,
    root_inode: u64,
}
fn protected_pid(pid: u32) -> bool {
    matches!(pid, 86361 | 20779)
}
fn group_present(group: u32) -> Result<bool, String> {
    let result = unsafe { libc::kill(-(group as i32), 0) };
    if result == 0 {
        return Ok(true);
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(libc::ESRCH) => Ok(false),
        Some(libc::EPERM) => Ok(true),
        _ => Err("Captured group state unavailable".into()),
    }
}
impl HostToken {
    fn stop(&self) -> Result<(), String> {
        if protected_pid(self.identity.pid) || protected_pid(self.identity.pgid) {
            return Err("Protected application excluded from fixture cleanup".into());
        }
        crate::managed_payload::private_dir(&self.root)?;
        let root = fs::symlink_metadata(&self.root).map_err(|_| "Captured root unavailable")?;
        if !root.is_dir()
            || root.file_type().is_symlink()
            || root.dev() != self.root_device
            || root.ino() != self.root_inode
            || root.uid() != self.identity.uid
            || self
                .root
                .canonicalize()
                .map_err(|_| "Captured root unavailable")?
                != self.root
        {
            return Err("Captured root identity changed".into());
        }
        if self.identity.pgid != self.identity.pid {
            return Err("Captured host lacks its private process group".into());
        }
        if !self.identity.current() {
            return if group_present(self.identity.pgid)? {
                Err(
                    "Captured leader expired but group remains; ambiguous cleanup, no signal sent"
                        .into(),
                )
            } else {
                Ok(())
            };
        }
        // Authority is this in-memory token minted from Command.spawn, not any saved PID.
        if unsafe { libc::kill(-(self.identity.pid as i32), libc::SIGTERM) } != 0 {
            return Err("Captured host group termination failed".into());
        }
        let until = Instant::now() + Duration::from_secs(15);
        while group_present(self.identity.pgid)? && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        if group_present(self.identity.pgid)? {
            return Err(
                "Captured group remains after fixture cleanup; no further signal sent".into(),
            );
        }
        Ok(())
    }
}

struct NativeToken {
    identity: Identity,
    child: Arc<Mutex<Child>>,
    profile: PathBuf,
}
impl Drop for NativeToken {
    fn drop(&mut self) {
        if protected_pid(self.identity.pid) || !self.identity.current() {
            return;
        }
        if crate::managed_payload::private_dir(&self.profile).is_err() {
            return;
        }
        if let Ok(mut child) = self.child.lock() {
            if child.try_wait().ok().flatten().is_none()
                && child.id() == self.identity.pid
                && self.identity.current()
            {
                // Failure-only cleanup of the actual captured Child. Never a normal-quit pass.
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
struct Inner {
    root: PathBuf,
    profile: PathBuf,
    hosts: Mutex<Vec<HostToken>>,
    natives: Mutex<Vec<NativeToken>>,
}
static SCOPES: OnceLock<Mutex<HashMap<PathBuf, Weak<Inner>>>> = OnceLock::new();
fn scopes() -> &'static Mutex<HashMap<PathBuf, Weak<Inner>>> {
    SCOPES.get_or_init(Default::default)
}
fn scope(path: &Path) -> Option<Arc<Inner>> {
    scopes().lock().ok()?.get(path)?.upgrade()
}

pub(super) struct Scope(Arc<Inner>);
impl Scope {
    pub(super) fn register(root: &Path) -> Result<Self, String> {
        if root
            .canonicalize()
            .map_err(|_| "Fresh fixture root unavailable")?
            != root
        {
            return Err("Fixture root is not canonical".into());
        }
        crate::managed_payload::private_dir(root)?;
        if fs::read_dir(root)
            .map_err(|_| "Fixture root unavailable")?
            .next()
            .is_some()
        {
            return Err("Fixture host root is not fresh".into());
        }
        let profile = root.join("native-desktop-profile-v1");
        let inner = Arc::new(Inner {
            root: root.into(),
            profile: profile.clone(),
            hosts: Mutex::new(vec![]),
            natives: Mutex::new(vec![]),
        });
        let mut map = scopes()
            .lock()
            .map_err(|_| "Fixture capture lock unavailable")?;
        if map.contains_key(root) || map.contains_key(&profile) {
            return Err("Fixture scope already registered".into());
        }
        map.insert(root.into(), Arc::downgrade(&inner));
        map.insert(profile, Arc::downgrade(&inner));
        Ok(Self(inner))
    }
    pub(super) fn host_identity(&self) -> Result<Identity, String> {
        let tokens = self
            .0
            .hosts
            .lock()
            .map_err(|_| "Fixture capture unavailable")?;
        if tokens.len() != 1 {
            return Err("Fixture did not capture exactly one host spawn".into());
        }
        Ok(tokens[0].identity.clone())
    }
    pub(super) fn native_identity(&self, index: usize) -> Result<Identity, String> {
        self.0
            .natives
            .lock()
            .map_err(|_| "Fixture capture unavailable")?
            .get(index)
            .map(|t| t.identity.clone())
            .ok_or("Native spawn was not captured".into())
    }
    pub(super) fn native_count(&self) -> usize {
        self.0.natives.lock().unwrap().len()
    }
    pub(super) async fn normal_quit(
        &self,
        index: usize,
        desktop_identity: crate::managed_desktop::DesktopIdentity,
    ) -> Result<ExitStatus, String> {
        let (identity, child) = {
            let native = self
                .0
                .natives
                .lock()
                .map_err(|_| "Native capture unavailable")?;
            let token = native.get(index).ok_or("Native capture missing")?;
            (token.identity.clone(), token.child.clone())
        };
        sdk_terminate(&identity, &child, desktop_identity)?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            if let Some(status) = child
                .lock()
                .map_err(|_| "Captured native lock unavailable")?
                .try_wait()
                .map_err(|_| "Captured native wait unavailable")?
            {
                if !status.success() {
                    return Err("Native normal quit was not successful".into());
                }
                return Ok(status);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("Native normal quit deadline".into());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    pub(super) fn cleanup_host(&self) -> Result<(), String> {
        for host in self
            .0
            .hosts
            .lock()
            .map_err(|_| "Host capture unavailable")?
            .iter()
        {
            host.stop()?;
        }
        Ok(())
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        if let Ok(mut map) = scopes().lock() {
            map.remove(&self.0.root);
            map.remove(&self.0.profile);
        }
        // First detach/clean native children; then terminate only the captured host group.
        if let Ok(mut tokens) = self.0.natives.lock() {
            tokens.clear();
        }
        if let Ok(tokens) = self.0.hosts.lock() {
            for token in tokens.iter() {
                let _ = token.stop();
            }
        }
    }
}
pub(crate) fn scope_registered(root: &Path) -> bool {
    scope(root).is_some()
}
/// Fixed diagnostic categories only. Never persist a host error, URL or credential.
pub(super) fn record_open_failure(profile: &Path, error: &str) {
    let Some(scope) = scope(profile) else { return };
    let label = match error {
        "Managed host did not become ready; its process was left intact for diagnosis and reconnect" => "entry-open-host-readiness-deadline",
        value if value.starts_with("Managed host exited (") => "entry-open-host-exited",
        _ => "entry-open-other-owner-failure",
    };
    if let Some(root) = scope
        .root
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
    {
        let _ = phase(root, label);
    }
}
pub(crate) fn record_host_spawn(
    child: &mut Child,
    root: &Path,
    executable: &Path,
) -> Result<(), String> {
    let Some(scope) = scope(root) else {
        return Ok(());
    };
    let result = (|| {
        let identity = Identity::read(child.id())?;
        if protected_pid(identity.pid)
            || protected_pid(identity.pgid)
            || identity.parent != std::process::id()
            || identity.uid != unsafe { libc::getuid() }
            || identity.pgid != identity.pid
            || identity.executable
                != executable
                    .canonicalize()
                    .map_err(|_| "Fixture executable unavailable")?
            || !identity.current()
        {
            return Err("Captured host identity differs".into());
        }
        let root_metadata = fs::symlink_metadata(root).map_err(|_| "Captured root unavailable")?;
        scope
            .hosts
            .lock()
            .map_err(|_| "Fixture capture unavailable")?
            .push(HostToken {
                identity,
                root: root.into(),
                root_device: root_metadata.dev(),
                root_inode: root_metadata.ino(),
            });
        Ok(())
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}
pub(crate) fn record_native_spawn(
    child: &Arc<Mutex<Child>>,
    profile: &Path,
    executable: &Path,
) -> Result<(), String> {
    let Some(scope) = scope(profile) else {
        return Ok(());
    };
    let result = (|| {
        let mut captured = child
            .lock()
            .map_err(|_| "Native capture lock unavailable")?;
        if captured
            .try_wait()
            .map_err(|_| "Native wait unavailable")?
            .is_some()
        {
            return Err("Native exited before capture".into());
        }
        let identity = Identity::read(captured.id())?;
        if protected_pid(identity.pid)
            || protected_pid(identity.pgid)
            || identity.parent != std::process::id()
            || identity.uid != unsafe { libc::getuid() }
            || identity.executable
                != executable
                    .canonicalize()
                    .map_err(|_| "Native executable unavailable")?
            || !identity.current()
        {
            return Err("Captured native identity differs".into());
        }
        scope
            .natives
            .lock()
            .map_err(|_| "Fixture capture unavailable")?
            .push(NativeToken {
                identity: identity.clone(),
                child: child.clone(),
                profile: profile.into(),
            });
        diagnostics::start(child.clone(), identity, profile.into());
        Ok(())
    })();
    if result.is_err() {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    result
}

/// Closed, nonsecret stage vocabulary; never accepts broker payloads or errors.
#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeStage {
    InitialGrantRequested,
    InitialGrantSucceeded,
    DescriptorWritten,
    BrokerReady,
    RequestFrame,
    RequestAuthorized,
    RenewalGrantSucceeded,
    ReplyWritten,
    BrokerEof,
    BrokerSucceeded,
    BrokerFailed,
}
pub(crate) fn record_native_stage(child: &Arc<Mutex<Child>>, stage: NativeStage) {
    // Pointer identity binds observations to the actual captured Child, not a PID record.
    let owners: Vec<_> = scopes()
        .lock()
        .map(|map| map.values().filter_map(Weak::upgrade).collect())
        .unwrap_or_default();
    for owner in owners {
        let index = owner.natives.lock().ok().and_then(|natives| {
            natives
                .iter()
                .position(|native| Arc::ptr_eq(&native.child, child))
        });
        let Some(index) = index else {
            continue;
        };
        let path = owner
            .profile
            .join(format!("native-broker-stages-{index}.jsonl"));
        let result = (|| -> Result<(), String> {
            let mut output = fs::OpenOptions::new()
                .append(true)
                .create(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
                .open(path)
                .map_err(|_| "Private stage output unavailable")?;
            let metadata = output
                .metadata()
                .map_err(|_| "Private stage metadata unavailable")?;
            if !metadata.is_file()
                || metadata.uid() != unsafe { libc::getuid() }
                || metadata.nlink() != 1
                || metadata.mode() & 0o777 != 0o600
            {
                return Err("Private stage output differs".into());
            }
            writeln!(
                output,
                "{}",
                serde_json::json!({"stage": format!("{stage:?}")})
            )
            .map_err(|_| "Private stage write unavailable".into())
        })();
        // Diagnostic I/O never changes broker authority or product lifecycle behavior.
        let _ = result;
        return;
    }
}

pub(crate) fn configure_native_output(
    command: &mut std::process::Command,
    profile: &Path,
) -> Result<(), String> {
    let Some(scope) = scope(profile) else {
        return Ok(());
    };
    crate::managed_payload::private_dir(profile)?;
    let index = scope
        .natives
        .lock()
        .map_err(|_| "Native capture unavailable")?
        .len();
    let output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(profile.join(format!("native-acceptance-output-{index}.log")))
        .map_err(|_| "Private native output unavailable")?;
    command.args([
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
    ]);
    command
        .stdout(std::process::Stdio::from(
            output
                .try_clone()
                .map_err(|_| "Private native output unavailable")?,
        ))
        .stderr(std::process::Stdio::from(output));
    Ok(())
}
fn phase(root: &Path, label: &str) -> Result<(), String> {
    let mut output = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(root.join("phase.jsonl"))
        .map_err(|_| "Private phase output unavailable")?;
    let metadata = output
        .metadata()
        .map_err(|_| "Private phase metadata unavailable")?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::getuid() }
        || metadata.nlink() != 1
        || metadata.mode() & 0o777 != 0o600
    {
        return Err("Private phase output differs".into());
    }
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Fixture clock unavailable")?
        .as_millis();
    writeln!(output,"{}",serde_json::json!({"at":time,"phase":label,"dataFree":available_data_bytes()?,"apfsFree":available_fixture_bytes()?})).map_err(|_| "Private phase write failed".into())
}
// Official process-instance lifecycle API. No AppleScript/eval, synthetic input or bundle-wide quit.
#[link(name = "AppKit", kind = "framework")]
extern "C" {}
#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn objc_msgSend();
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
}
type Obj = *mut c_void;
unsafe fn send_obj(object: Obj, selector: &[u8]) -> Obj {
    let call: unsafe extern "C" fn(Obj, Obj) -> Obj =
        std::mem::transmute(objc_msgSend as *const ());
    call(object, sel_registerName(selector.as_ptr().cast()))
}
unsafe fn string(object: Obj) -> Result<String, String> {
    if object.is_null() {
        return Err("SDK identity string missing".into());
    }
    let value = send_obj(object, b"UTF8String\0");
    if value.is_null() {
        return Err("SDK identity string unavailable".into());
    }
    Ok(CStr::from_ptr(value.cast())
        .to_str()
        .map_err(|_| "SDK identity encoding")?
        .into())
}
fn sdk_bundle_id(identity: crate::managed_desktop::DesktopIdentity) -> &'static str {
    match identity {
        crate::managed_desktop::DesktopIdentity::Production => "com.blackcrab.desktop.managed",
        #[cfg(target_arch = "aarch64")]
        crate::managed_desktop::DesktopIdentity::NativeKeychainQa(permit) => permit.pins().app_id,
    }
}
fn sdk_terminate(
    identity: &Identity,
    child: &Arc<Mutex<Child>>,
    desktop_identity: crate::managed_desktop::DesktopIdentity,
) -> Result<(), String> {
    unsafe {
        let pool = objc_autoreleasePoolPush();
        let result = (|| {
            if protected_pid(identity.pid) || protected_pid(identity.pgid) || !identity.current() {
                return Err("Captured native identity expired or protected".into());
            }
            let class = objc_getClass(b"NSRunningApplication\0".as_ptr().cast());
            let lookup: unsafe extern "C" fn(Obj, Obj, i32) -> Obj =
                std::mem::transmute(objc_msgSend as *const ());
            let app = lookup(
                class,
                sel_registerName(
                    b"runningApplicationWithProcessIdentifier:\0"
                        .as_ptr()
                        .cast(),
                ),
                identity.pid as i32,
            );
            if app.is_null() {
                return Err("Captured native application is not registered".into());
            }
            if string(send_obj(app, b"bundleIdentifier\0"))? != sdk_bundle_id(desktop_identity) {
                return Err("Captured native bundle ID differs".into());
            }
            let bundle = PathBuf::from(string(send_obj(send_obj(app, b"bundleURL\0"), b"path\0"))?)
                .canonicalize()
                .map_err(|_| "SDK bundle path unavailable")?;
            let expected = identity
                .executable
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent)
                .ok_or("Captured bundle missing")?;
            if bundle != expected {
                return Err("Captured SDK bundle path differs".into());
            }
            let date = send_obj(app, b"launchDate\0");
            // AppKit documents nil for applications started outside LaunchServices.
            // The retained Child and complete kernel birth identity remain mandatory
            // before and immediately after this optional corroborating SDK value.
            if !date.is_null() {
                let number: unsafe extern "C" fn(Obj, Obj) -> f64 =
                    std::mem::transmute(objc_msgSend as *const ());
                let birth = number(
                    date,
                    sel_registerName(b"timeIntervalSince1970\0".as_ptr().cast()),
                );
                let kernel_birth =
                    identity.birth_seconds as f64 + identity.birth_micros as f64 / 1_000_000.;
                if !birth.is_finite() || (birth - kernel_birth).abs() > 2. {
                    return Err("SDK captured birth differs".into());
                }
            }
            let mut captured = child
                .lock()
                .map_err(|_| "Captured native lock unavailable")?;
            if captured.id() != identity.pid
                || captured
                    .try_wait()
                    .map_err(|_| "Captured native wait unavailable")?
                    .is_some()
                || !identity.current()
            {
                return Err("Captured native no longer live".into());
            }
            let terminate: unsafe extern "C" fn(Obj, Obj) -> bool =
                std::mem::transmute(objc_msgSend as *const ());
            if !terminate(app, sel_registerName(b"terminate\0".as_ptr().cast())) {
                return Err("SDK normal termination refused".into());
            }
            Ok(())
        })();
        objc_autoreleasePoolPop(pool);
        result
    }
}

fn available_data_bytes() -> Result<u64, String> {
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::statfs(b"/private/tmp\0".as_ptr().cast(), stat.as_mut_ptr()) } != 0 {
        return Err("Fixture resource probe unavailable".into());
    }
    let stat = unsafe { stat.assume_init() };
    Ok(stat.f_bavail as u64 * stat.f_bsize as u64)
}
fn available_fixture_bytes() -> Result<u64, String> {
    let root =
        std::env::var_os("BLACKCRAB_NATIVE_ENTRY_TEST_ROOT").ok_or("Fixture root unavailable")?;
    use std::os::unix::ffi::OsStrExt;
    let root =
        std::ffi::CString::new(root.as_os_str().as_bytes()).map_err(|_| "Fixture root invalid")?;
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::statfs(root.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err("Fixture APFS resource probe unavailable".into());
    }
    let stat = unsafe { stat.assume_init() };
    Ok(stat.f_bavail as u64 * stat.f_bsize as u64)
}
async fn verified_blocking<F, T>(work: F, worker_error: &'static str) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    // Propagate BOTH the worker/join failure and the original verifier result.
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| worker_error.to_owned())?
}
async fn guarded<F, T>(future: F, seconds: u64) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    tokio::pin!(future);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        tokio::select! {result=&mut future=>return result,_=tokio::time::sleep(Duration::from_millis(250))=>{
            if available_data_bytes()?<2*1024*1024*1024 || available_fixture_bytes()?<2*1024*1024*1024{return Err("Fixture2GiB resource floor".into());}
            if tokio::time::Instant::now()>=deadline{return Err("Native fixture phase deadline".into());}
        }}
    }
}
pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| "Fixture TLS unavailable")?
    .with_root_certificates(rustls::RootCertStore::empty())
    .with_no_client_auth();
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "Fixture HTTP unavailable".into())
}
fn observer_socket_url(origin: &str, ticket: &str) -> Result<url::Url, String> {
    let mut url = url::Url::parse(origin).map_err(|_| "Fixture origin invalid")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Fixture origin is not the verified loopback base".into());
    }
    url.set_scheme("ws").map_err(|_| "Fixture scheme invalid")?;
    url.set_path("/ws");
    // Pinned client-runtime/connection/compatibility.ts appendOrchestrationProtocol.
    url.query_pairs_mut()
        .append_pair("orchestrationProtocol", "2")
        .append_pair("clientCapabilities", "settingsSecretReferences")
        .append_pair("wsTicket", ticket);
    Ok(url)
}
fn observer_request() -> serde_json::Value {
    serde_json::json!({"_tag":"Request","id":"1","tag":"subscribeAuthAccess","payload":{},"headers":[]})
}
fn observer_connection_error(error: tokio_tungstenite::tungstenite::Error) -> String {
    match error {
        tokio_tungstenite::tungstenite::Error::Http(response) => format!(
            "Original auth-access observer handshake rejected (HTTP {})",
            response.status().as_u16()
        ),
        _ => "Original auth-access observer connection failed (no target/headers logged)".into(),
    }
}
async fn observer_connection_url(
    host: &crate::managed_host::ManagedHost,
) -> Result<url::Url, String> {
    use serde_json::Value;
    let (origin, bearer) = host.native_acceptance_observer().await?;
    let http = http_client()?;
    let ticket = http
        .post(format!("{origin}api/auth/websocket-ticket/rpc"))
        .bearer_auth(&bearer)
        .send()
        .await
        .map_err(|_| "Fixture observer ticket unavailable")?;
    if !ticket.status().is_success() {
        return Err("Fixture observer ticket refused".into());
    }
    let mut ticket = ticket;
    let mut bytes = Vec::new();
    while let Some(chunk) = ticket
        .chunk()
        .await
        .map_err(|_| "Fixture observer ticket unreadable")?
    {
        if bytes.len() + chunk.len() > 16384 {
            return Err("Fixture ticket response exceeded bound".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Fixture ticket invalid")?;
    let ticket = value["ticket"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() < 8192)
        .ok_or("Fixture ticket missing")?;
    observer_socket_url(&origin, ticket)
}
async fn native_auth_presence(
    host: &crate::managed_host::ManagedHost,
    connected: bool,
) -> Result<(), String> {
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use tokio_tungstenite::tungstenite::Message;
    let url = observer_connection_url(host).await?;
    let (mut socket, _) = tokio_tungstenite::connect_async(url.as_str())
        .await
        .map_err(observer_connection_error)?;
    socket
        .send(Message::Text(observer_request().to_string().into()))
        .await
        .map_err(|_| "Original auth-access request failed")?;
    let mut clients = HashMap::<String, Value>::new();
    let mut snapshot = false;
    while let Some(message) = socket.next().await {
        let message = message.map_err(|_| "Original auth-access stream failed")?;
        let data = match message {
            Message::Text(text) => text.as_bytes().to_vec(),
            Message::Binary(data) => data.to_vec(),
            Message::Ping(data) => {
                socket
                    .send(Message::Pong(data))
                    .await
                    .map_err(|_| "Fixture pong unavailable")?;
                continue;
            }
            Message::Close(_) => return Err("Original auth-access stream closed".into()),
            _ => continue,
        };
        if data.len() > 1024 * 1024 {
            return Err("Original auth-access frame exceeded bound".into());
        }
        let parsed: Value =
            serde_json::from_slice(&data).map_err(|_| "Original auth-access JSON invalid")?;
        let packets = if let Value::Array(values) = parsed {
            values
        } else {
            vec![parsed]
        };
        for packet in packets {
            if packet["_tag"] == "Pong" {
                continue;
            }
            if packet["_tag"] == "Exit" {
                return Err("Original auth-access request was rejected".into());
            }
            if packet["_tag"] != "Chunk" || (packet["requestId"] != "1" && packet["requestId"] != 1)
            {
                continue;
            }
            let values = packet["values"]
                .as_array()
                .ok_or("Original auth-access chunk invalid")?;
            for event in values {
                if event["version"] != 1 {
                    return Err("Original auth-access event version invalid".into());
                }
                match event["type"].as_str() {
                    Some("snapshot") => {
                        clients.clear();
                        for item in event["payload"]["clientSessions"]
                            .as_array()
                            .ok_or("Original auth snapshot invalid")?
                        {
                            if let Some(id) = item["sessionId"].as_str() {
                                clients.insert(id.into(), item.clone());
                            }
                        }
                        snapshot = true;
                    }
                    Some("clientUpserted") => {
                        let item = &event["payload"];
                        if let Some(id) = item["sessionId"].as_str() {
                            clients.insert(id.into(), item.clone());
                        }
                    }
                    Some("clientRemoved") => {
                        if let Some(id) = event["payload"]["sessionId"].as_str() {
                            clients.remove(id);
                        }
                    }
                    _ => {}
                }
            }
            socket
                .send(Message::Text(
                    json!({"_tag":"Ack","requestId":"1"}).to_string().into(),
                ))
                .await
                .map_err(|_| "Fixture stream ack unavailable")?;
            let native_connected = clients.values().any(|c| {
                c["client"]["label"] == "Blackcrab Desktop"
                    && c["client"]["deviceType"] == "desktop"
                    && c["connected"] == true
            });
            if snapshot && native_connected == connected {
                let _ = socket.close(None).await;
                return Ok(());
            }
        }
    }
    Err("Original auth-access stream ended".into())
}

const HOST_MANIFEST: &str = "f97ab782c6f30c60825140fddff89e6e5e820e03dfdf57347751ef56230856af";
const HOST_ARCHIVE: &str = "0f7c688ca8ce38960b16587fbb6b0c4b67a295be91d1c458557b74c49f647552";
const DESKTOP_MANIFEST: &str = "b7e3a5f37a383ad803803e7881257e6546a9d559a1d42d5e00076ad315d9b891";
const DESKTOP_ARCHIVE: &str = "72daeedee2e5a3b50ecdcdb974fbb77c4189db55d2bf21bc5cd14fe8e13a15ef";
fn identity_json(value: &Identity) -> serde_json::Value {
    serde_json::json!({"pid":value.pid,"parent":value.parent,"uid":value.uid,"pgid":value.pgid,"birthSeconds":value.birth_seconds,"birthMicros":value.birth_micros,"executable":value.executable})
}
fn checked_fixture_root() -> Result<PathBuf, String> {
    let root = PathBuf::from(
        std::env::var_os("BLACKCRAB_NATIVE_ENTRY_TEST_ROOT")
            .ok_or("Select an explicitly prepared private fixture root")?,
    );
    if !root.is_absolute()
        || root
            .canonicalize()
            .map_err(|_| "Fixture root unavailable")?
            != root
        || !root.file_name().is_some_and(|n| {
            n.to_string_lossy()
                .starts_with("blackcrab-rust-native-entry-")
        })
    {
        return Err("Invalid fresh fixture root".into());
    }
    crate::managed_payload::private_dir(&root)?;
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    let c = std::ffi::CString::new(root.to_str().ok_or("Fixture root encoding")?)
        .map_err(|_| "Fixture root invalid")?;
    if unsafe { libc::statfs(c.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err("Fixture filesystem unavailable".into());
    }
    let stat = unsafe { stat.assume_init() };
    let name = unsafe { CStr::from_ptr(stat.f_fstypename.as_ptr()) };
    if name.to_bytes() != b"apfs" {
        return Err("Fixture requires owned APFS".into());
    }
    for entry in fs::read_dir(&root).map_err(|_| "Fixture root unreadable")? {
        let name = entry.map_err(|_| "Fixture entry unreadable")?.file_name();
        if name != "home" && name != "tmp" {
            return Err("Fixture root is not fresh".into());
        }
    }
    for (key, name) in [("HOME", "home"), ("TMPDIR", "tmp")] {
        let selected =
            PathBuf::from(std::env::var_os(key).ok_or("Fixture private environment missing")?);
        let expected = root.join(name);
        if selected
            .canonicalize()
            .map_err(|_| "Fixture private environment unavailable")?
            != expected
        {
            return Err("Fixture private environment differs".into());
        }
        crate::managed_payload::private_dir(&expected)?;
    }
    for key in [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "T3CODE_HOME",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "NODE_OPTIONS",
        "NODE_PATH",
    ] {
        if std::env::var_os(key).is_some() {
            return Err("Fixture inherited a forbidden external configuration".into());
        }
    }
    Ok(root)
}
// The sole reviewed reuse source is the inactive cold99123 fixture, never main/user data.
const REVIEWED_COLD_ROOT: &str = "/private/tmp/blackcrab-c603-owned-2yw0xkm4/Root-QA/rust-entry-controller-qjizktpi/blackcrab-rust-native-entry-5dbh_a_y";
fn cold_report_allows_artifact_only_reuse(value: &serde_json::Value) -> bool {
    value["passed"] == false
        && value["error"] == "Native fixture phase deadline"
        && value["cleanupError"].is_null()
        && value["providerOrModelCommands"] == 0
        && value.get("actualEntryOpenRunning").is_none()
        && value.get("firstNative").is_none()
        && value.get("hostIdentity").is_none()
}
fn bounded_owned_input(path: &Path, maximum: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Warm cache provenance unavailable")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Warm cache provenance metadata unavailable")?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::getuid() }
        || metadata.nlink() != 1
        || metadata.mode() & 0o022 != 0
        || metadata.len() > maximum
    {
        return Err("Warm cache provenance differs".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Warm cache provenance unreadable")?;
    if bytes.len() as u64 > maximum {
        return Err("Warm cache provenance exceeded bound".into());
    }
    Ok(bytes)
}
fn artifact_cache_app_data(fresh_data: &Path) -> Result<(PathBuf, bool), String> {
    let Some(input) = std::env::var_os("BLACKCRAB_NATIVE_ENTRY_TEST_CACHE_APP_DATA") else {
        return Ok((fresh_data.into(), false));
    };
    let selected = PathBuf::from(input);
    let old_root = Path::new(REVIEWED_COLD_ROOT);
    let expected = old_root.join("data");
    if selected != expected
        || selected
            .canonicalize()
            .map_err(|_| "Reviewed warm cache unavailable")?
            != selected
        || fresh_data == selected
    {
        return Err("Only the reviewed inactive artifact cache may be reused".into());
    }
    let boundary = Path::new("/private/tmp/blackcrab-c603-owned-2yw0xkm4/Root-QA");
    for directory in selected.ancestors() {
        crate::managed_payload::private_dir(directory)?;
        if directory
            .canonicalize()
            .map_err(|_| "Warm cache ancestor unavailable")?
            != directory
            || fs::symlink_metadata(directory)
                .map_err(|_| "Warm cache ancestor missing")?
                .mode()
                & 0o777
                != 0o700
        {
            return Err("Warm cache ancestor differs".into());
        }
        if directory == boundary {
            break;
        }
    }
    // Observations refuse reuse; they never authorize a signal or process adoption.
    if Identity::read(99123).is_ok() || group_present(99123)? {
        return Err("Prior cold fixture is not terminal".into());
    }
    let report: serde_json::Value = serde_json::from_slice(&bounded_owned_input(
        &old_root.join("report.json"),
        64 * 1024,
    )?)
    .map_err(|_| "Cold provenance invalid")?;
    if !cold_report_allows_artifact_only_reuse(&report) {
        return Err("Cold provenance is not the reviewed no-entry-open failure".into());
    }
    let phases = bounded_owned_input(&old_root.join("phase.jsonl"), 64 * 1024)?;
    for line in phases
        .split(|b| *b == b'\n')
        .filter(|line| !line.is_empty())
    {
        let event: serde_json::Value =
            serde_json::from_slice(line).map_err(|_| "Cold phase provenance invalid")?;
        if event["phase"].as_str().is_some_and(|phase| {
            phase.starts_with("entry-") || phase == "artifact-preflight-complete"
        }) {
            return Err("Cold fixture reached an unreviewed lifecycle phase".into());
        }
    }
    let old_host = selected.join("managed-host/v1");
    crate::managed_payload::private_dir(&old_host)?;
    if fs::read_dir(&old_host)
        .map_err(|_| "Old host root unavailable")?
        .next()
        .is_some()
    {
        return Err("Old host data may not be inherited".into());
    }
    let cache = selected.join("managed-payloads-v1");
    crate::managed_payload::private_dir(&cache)?;
    if cache
        .canonicalize()
        .map_err(|_| "Warm cache path unavailable")?
        != cache
        || fs::symlink_metadata(&cache)
            .map_err(|_| "Warm cache path unavailable")?
            .mode()
            & 0o777
            != 0o700
    {
        return Err("Warm cache directory differs".into());
    }
    for name in [".blackcrab-managed-payload-cache-v1", ".lease"] {
        let metadata = fs::symlink_metadata(cache.join(name))
            .map_err(|_| "Warm cache control file unavailable")?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.uid() != unsafe { libc::getuid() }
            || metadata.nlink() != 1
            || metadata.mode() & 0o7777 != 0o600
        {
            return Err("Warm cache control file differs".into());
        }
    }
    if bounded_owned_input(&cache.join(".blackcrab-managed-payload-cache-v1"), 128)?
        != b"blackcrab-payload-cache-v1\n"
    {
        return Err("Warm artifact cache marker differs".into());
    }
    let host = format!("host-{HOST_MANIFEST}-{HOST_ARCHIVE}");
    let desktop = format!("desktop-{DESKTOP_MANIFEST}-{DESKTOP_ARCHIVE}");
    for entry in fs::read_dir(&cache).map_err(|_| "Warm artifact cache unavailable")? {
        let entry = entry.map_err(|_| "Warm cache entry unavailable")?;
        let name = entry.file_name();
        if name != host.as_str()
            && name != desktop.as_str()
            && name != ".lease"
            && name != ".blackcrab-managed-payload-cache-v1"
        {
            return Err("Unexpected warm artifact entry or staging directory".into());
        }
    }
    for (directory, manifest, pin) in [
        (
            cache.join(host),
            "blackcrab-managed-host.json",
            HOST_MANIFEST,
        ),
        (
            cache.join(desktop),
            "blackcrab-managed-desktop.json",
            DESKTOP_MANIFEST,
        ),
    ] {
        crate::managed_payload::private_dir(&directory)?;
        if directory
            .canonicalize()
            .map_err(|_| "Warm target unavailable")?
            != directory
            || fs::symlink_metadata(&directory)
                .map_err(|_| "Warm target unavailable")?
                .mode()
                & 0o777
                != 0o700
        {
            return Err("Warm target ownership differs".into());
        }
        use sha2::{Digest, Sha256};
        let bytes = bounded_owned_input(&directory.join(manifest), 64 * 1024 * 1024)?;
        let hash = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        if hash != pin {
            return Err("Warm manifest differs from actual compiled resource pin".into());
        }
    }
    // This chooses ONLY the artifact cache location. Every original ensure_verified
    // call still rehashes/validates complete cache bytes, modes, links and provenance.
    Ok((selected, true))
}
#[tokio::test]
#[ignore = "opt-in real production Rust entry/NativeDesktopOwner lifecycle; requires explicit APFS root and trusted normal-bundle resources"]
async fn normal_bundled_native_launch_reuse_quit_reopen() {
    native_launch_reuse_quit_reopen(crate::managed_desktop::DesktopIdentity::Production).await;
}

async fn native_launch_reuse_quit_reopen(identity: crate::managed_desktop::DesktopIdentity) {
    use super::{ManagedNativeEntry, Pins};
    use crate::managed_desktop::DesktopIdentity;
    let (desktop_manifest, desktop_archive) = match identity {
        DesktopIdentity::Production => (DESKTOP_MANIFEST, DESKTOP_ARCHIVE),
        #[cfg(target_arch = "aarch64")]
        DesktopIdentity::NativeKeychainQa(permit) => {
            (permit.pins().manifest_sha256, permit.pins().archive_sha256)
        }
    };
    use crate::managed_host::ManagedHost;
    use serde_json::json;
    assert!(
        !protected_pid(std::process::id()),
        "Protected application cannot run the fixture"
    );
    let root = checked_fixture_root().expect("explicit private APFS fixture environment");
    assert!(
        available_data_bytes().unwrap() >= 4 * 1024 * 1024 * 1024
            && available_fixture_bytes().unwrap() >= 4 * 1024 * 1024 * 1024,
        "fixture requires4GiB data/APFS headroom before launch"
    );
    let resources = PathBuf::from(
        std::env::var_os("BLACKCRAB_NATIVE_ENTRY_RESOURCES")
            .expect("explicit trusted normal Root resources"),
    );
    let resources = resources
        .canonicalize()
        .expect("normal bundle resources unavailable");
    let data = root.join("data");
    fs::DirBuilder::new().mode(0o700).create(&data).unwrap();
    crate::managed_payload::private_dir(&data).unwrap();
    let parent = data.join("managed-host");
    fs::DirBuilder::new().mode(0o700).create(&parent).unwrap();
    let host_root = parent.join("v1");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&host_root)
        .unwrap();
    crate::managed_payload::private_dir(&host_root).unwrap();
    let capture = Scope::register(&host_root).unwrap();
    let (cache_data, warm_artifacts) = match identity {
        DesktopIdentity::Production => {
            artifact_cache_app_data(&data).expect("explicit reviewed artifact cache precheck")
        }
        #[cfg(target_arch = "aarch64")]
        DesktopIdentity::NativeKeychainQa(_) => (data.clone(), false),
    };
    let entry = ManagedNativeEntry::from_inputs(
        &resources,
        &cache_data,
        Pins {
            host_manifest: Some(HOST_MANIFEST),
            host_archive: Some(HOST_ARCHIVE),
            desktop_manifest: Some(desktop_manifest),
            desktop_archive: Some(desktop_archive),
        },
    );
    let bundled = entry
        .bundled_host()
        .expect("actual trusted bundled host unavailable");
    let host = ManagedHost::new(host_root).with_bundled_payload(bundled.clone());
    let mut report = json!({"scope":"actual Rust ManagedNativeEntry/NativeDesktopOwner path; NOT main button or full rendered-UI certification","passed":false,"hostManifest":HOST_MANIFEST,"hostArchive":HOST_ARCHIVE,"desktopManifest":desktop_manifest,"desktopArchive":desktop_archive,"providerOrModelCommands":0});
    report["desktopIdentity"] = json!(match identity {
        DesktopIdentity::Production => "production",
        #[cfg(target_arch = "aarch64")]
        DesktopIdentity::NativeKeychainQa(_) => "reviewed-native-keychain-qa",
    });
    report["artifactCacheMode"] = json!(if warm_artifacts {
        "WARM verified artifacts only; fresh host/config/profile/HOME"
    } else {
        "COLD fresh artifact cache"
    });
    report["artifactCacheAppData"] = json!(cache_data);
    report["coldInstallPerformanceGate"] = json!(match identity {
        DesktopIdentity::Production => {
            "99123 cold preflight hit1200s durability bound; remains open, not a native lifecycle pass"
        }
        #[cfg(target_arch = "aarch64")]
        DesktopIdentity::NativeKeychainQa(_) => {
            "Fresh artifact extraction and verification for the exact reviewed QA package"
        }
    });
    let outcome: Result<(), String> = async {
        phase(&root, "artifact-preflight-start")?;
        // Artifact preflight is separate from live lifecycle deadlines. Still the original verifiers.
        let desktop = entry
            .desktop
            .as_ref()
            .ok_or("Actual desktop archive unavailable")?
            .clone();
        guarded(
            async {
                tokio::task::spawn_blocking(move || {
                    bundled.ensure_verified()?;
                    match identity {
                        DesktopIdentity::Production => {
                            desktop.ensure_verified()?;
                        }
                        #[cfg(target_arch = "aarch64")]
                        DesktopIdentity::NativeKeychainQa(permit) => {
                            desktop.ensure_reviewed_native_keychain_qa(&permit)?;
                        }
                    }
                    Ok(())
                })
                .await
                .map_err(|_| "Fixture preflight worker failed")?
            },
            1200,
        )
        .await?;
        phase(&root, "artifact-preflight-complete")?;
        phase(&root, "entry-open-start")?;
        guarded(
            async {
                let state = entry.open_for_identity(host.clone(), identity).await;
                if state.state != "running" {
                    return Err("Real native entry open did not reach running".into());
                }
                Ok(())
            },
            600,
        )
        .await?;
        phase(&root, "entry-open-running")?;
        let first = capture.native_identity(0)?;
        let owned_host = capture.host_identity()?;
        report["actualEntryOpenRunning"] = json!(true);
        report["hostIdentity"] = identity_json(&owned_host);
        report["firstNative"] = identity_json(&first);
        guarded(native_auth_presence(&host, true), 60).await?;
        phase(&root, "native-auth-connected")?;
        report["firstNativeConnectedThroughOriginalAuthAccess"] = json!(true);
        let before =
            serde_json::to_value(host.status().await).map_err(|_| "Fixture status encoding")?;
        if before["state"] != "running" {
            return Err("Captured host not running".into());
        }
        let environment = before["environmentId"].clone();
        phase(&root, "entry-reuse-start")?;
        let reused = guarded(
            async { Ok(entry.open_for_identity(host.clone(), identity).await.state) },
            600,
        )
        .await?;
        if reused != "running"
            || capture.native_count() != 1
            || capture.native_identity(0)? != first
            || !owned_host.current()
        {
            return Err("Repeated open did not reuse actual captured native client".into());
        }
        phase(&root, "entry-reuse-running")?;
        report["repeatedOpenReusedCapturedClient"] = json!(true);
        report["hostIdentity"] = identity_json(&owned_host);
        report["firstNative"] = identity_json(&first);
        phase(&root, "native-sdk-quit-start")?;
        guarded(capture.normal_quit(0, identity), 30).await?;
        phase(&root, "native-sdk-quit-complete")?;
        guarded(native_auth_presence(&host, false), 30).await?;
        if first.current() || !owned_host.current() {
            return Err("Normal native quit changed host lifetime".into());
        }
        let after =
            serde_json::to_value(host.status().await).map_err(|_| "Fixture status encoding")?;
        if after["state"] != "running" || after["environmentId"] != environment {
            return Err("Host identity changed after normal native quit".into());
        }
        report["firstNormalSdkQuitCapturedExitSuccess"] = json!(true);
        report["hostSurvivedNormalQuit"] = json!(true);
        phase(&root, "native-reopen-start")?;
        guarded(
            async {
                if entry.open_for_identity(host.clone(), identity).await.state != "running" {
                    return Err("Native reopen failed".into());
                }
                Ok(())
            },
            600,
        )
        .await?;
        phase(&root, "native-reopen-running")?;
        let second = capture.native_identity(1)?;
        if capture.native_count() != 2 || second == first || capture.host_identity()? != owned_host
        {
            return Err("Reopen did not preserve host/recreate only native client".into());
        }
        guarded(native_auth_presence(&host, true), 60).await?;
        phase(&root, "second-native-auth-connected")?;
        report["secondNativeConnectedThroughOriginalAuthAccess"] = json!(true);
        report["secondNative"] = identity_json(&second);
        phase(&root, "second-native-sdk-quit-start")?;
        guarded(capture.normal_quit(1, identity), 30).await?;
        phase(&root, "second-native-sdk-quit-complete")?;
        guarded(native_auth_presence(&host, false), 30).await?;
        let end =
            serde_json::to_value(host.status().await).map_err(|_| "Fixture status encoding")?;
        if end["state"] != "running" || end["environmentId"] != environment || !owned_host.current()
        {
            return Err("Reopened client quit changed host identity".into());
        }
        report["secondNormalSdkQuitCapturedExitSuccess"] = json!(true);
        report["hostEnvironmentRetained"] = environment;
        Ok(())
    }
    .await;
    let _ = phase(&root, "captured-fixture-cleanup-start");
    // Always clean only captured fixture instances, including an early failure path.
    if let Ok(mut native) = capture.0.natives.lock() {
        native.clear();
    }
    let cleanup = capture.cleanup_host();
    let _ = phase(&root, "captured-fixture-cleanup-complete");
    report["passed"] = json!(outcome.is_ok() && cleanup.is_ok());
    report["error"] = json!(outcome.as_ref().err());
    report["cleanupError"] = json!(cleanup.as_ref().err());
    report["capturedHostStoppedAfterAcceptance"] = json!(capture
        .host_identity()
        .is_ok_and(|p| !p.current() && group_present(p.pgid).is_ok_and(|present| !present)));
    fs::write(
        root.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    assert!(
        outcome.is_ok(),
        "Native lifecycle fixture failed; inspect private report.json"
    );
    assert!(
        cleanup.is_ok(),
        "Captured fixture cleanup failed; inspect private report.json"
    );
}

#[test]
fn observer_url_envelope_and_diagnostics_match_original_contract() {
    use serde_json::json;
    let url = observer_socket_url("http://127.0.0.1:34567/", "private-ticket").unwrap();
    assert_eq!(url.scheme(), "ws");
    assert_eq!(url.path(), "/ws");
    let pairs: HashMap<_, _> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    assert_eq!(pairs.len(), 3);
    assert_eq!(pairs["orchestrationProtocol"], "2");
    assert_eq!(pairs["clientCapabilities"], "settingsSecretReferences");
    assert_eq!(pairs["wsTicket"], "private-ticket");
    assert_eq!(
        observer_request(),
        json!({"_tag":"Request","id":"1","tag":"subscribeAuthAccess","payload":{},"headers":[]})
    );
    for base in [
        "https://127.0.0.1:34567/",
        "http://localhost:34567/",
        "http://127.0.0.1:34567/path",
        "http://127.0.0.1:34567/?secret=x",
    ] {
        assert!(observer_socket_url(base, "private-ticket").is_err());
    }
    let response = tokio_tungstenite::tungstenite::http::Response::builder()
        .status(426)
        .header("Location", "ws://127.0.0.1/ws?wsTicket=private-ticket")
        .body(Some(b"Bearer private-token".to_vec()))
        .unwrap();
    let message = observer_connection_error(tokio_tungstenite::tungstenite::Error::Http(response));
    assert!(message.contains("HTTP 426"));
    assert!(!message.contains("private-ticket"));
    assert!(!message.contains("private-token"));
    assert!(protected_pid(86361));
    assert!(protected_pid(20779));
    assert_eq!(std::mem::size_of::<BsdInfo>(), 136);
}
#[test]
fn optimized_crypto_profile_retains_sha256_and_hmac_known_answers() {
    use hmac::{Hmac, Mac};
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(b"abc");
    assert_eq!(
        hash.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(&[0x0b; 20]).unwrap();
    mac.update(b"Hi There");
    assert_eq!(
        mac.finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}
async fn incompatible_observer_protocol_is_rejected(
    host: &crate::managed_host::ManagedHost,
) -> Result<(), String> {
    let mut url = observer_connection_url(host).await?;
    let pairs: Vec<_> = url
        .query_pairs()
        .filter(|(k, _)| k != "orchestrationProtocol")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    url.set_query(None);
    for (k, v) in pairs {
        url.query_pairs_mut().append_pair(&k, &v);
    }
    match tokio_tungstenite::connect_async(url.as_str()).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(response))
            if response.status().as_u16() == 426 =>
        {
            Ok(())
        }
        _ => Err("Original server did not reject missing observer protocol withHTTP426".into()),
    }
}
#[tokio::test]
#[ignore = "opt-in real packaged-host-only observer contract probe; never launches Electron"]
async fn normal_packaged_host_observer_contract() {
    use super::{ManagedNativeEntry, Pins};
    use crate::managed_host::ManagedHost;
    use serde_json::json;
    let root = checked_fixture_root().expect("explicit fresh APFS host-only fixture environment");
    assert!(
        available_data_bytes().unwrap() >= 4 * 1024 * 1024 * 1024
            && available_fixture_bytes().unwrap() >= 4 * 1024 * 1024 * 1024,
        "fixture4GiB startup guard"
    );
    let resources = PathBuf::from(
        std::env::var_os("BLACKCRAB_NATIVE_ENTRY_RESOURCES").expect("trusted normal resources"),
    )
    .canonicalize()
    .unwrap();
    let data = root.join("data");
    fs::DirBuilder::new().mode(0o700).create(&data).unwrap();
    let parent = data.join("managed-host");
    fs::DirBuilder::new().mode(0o700).create(&parent).unwrap();
    let host_root = parent.join("v1");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&host_root)
        .unwrap();
    let capture = Scope::register(&host_root).unwrap();
    let entry = ManagedNativeEntry::from_inputs(
        &resources,
        &data,
        Pins {
            host_manifest: Some(HOST_MANIFEST),
            host_archive: Some(HOST_ARCHIVE),
            desktop_manifest: None,
            desktop_archive: None,
        },
    );
    let bundled = entry.bundled_host().unwrap();
    let host = ManagedHost::new(host_root).with_bundled_payload(bundled.clone());
    let outcome: Result<(), String> = async {
        phase(&root, "host-only-artifact-preflight-start")?;
        guarded(
            async {
                verified_blocking(
                    move || bundled.ensure_verified(),
                    "Host-only preflight worker failed",
                )
                .await?;
                Ok(())
            },
            1200,
        )
        .await?;
        phase(&root, "host-only-start")?;
        guarded(
            async {
                host.start(None).await?;
                Ok(())
            },
            600,
        )
        .await?;
        capture.host_identity()?;
        if capture.native_count() != 0 {
            return Err("Host-only probe unexpectedly launched a native client".into());
        }
        guarded(incompatible_observer_protocol_is_rejected(&host), 30).await?;
        phase(&root, "original-http426-negative-observed")?;
        guarded(native_auth_presence(&host, false), 60).await?;
        phase(&root, "original-auth-access-snapshot-false-observed")?;
        Ok(())
    }
    .await;
    let cleanup = capture.cleanup_host();
    let report = json!({"scope":"real packaged host observer contract only; no Electron/no models","passed":outcome.is_ok()&&cleanup.is_ok(),"error":outcome.as_ref().err(),"cleanupError":cleanup.as_ref().err(),"nativeSpawns":capture.native_count(),"hostManifest":HOST_MANIFEST,"hostArchive":HOST_ARCHIVE,"observerProtocol":2,"observerMethod":"subscribeAuthAccess","originalMissingProtocolHttpStatus":426,"providerOrModelCommands":0});
    fs::write(
        root.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    assert!(
        outcome.is_ok(),
        "Host-only observer fixture failed; inspect private report"
    );
    assert!(cleanup.is_ok(), "Captured host-only cleanup failed");
}

#[tokio::test]
async fn blocking_verifier_never_discards_inner_failure() {
    let result = verified_blocking(
        || Err::<(), String>("fixture verifier refused".into()),
        "fixture worker failed",
    )
    .await;
    assert_eq!(result, Err("fixture verifier refused".into()));
    assert_eq!(
        verified_blocking(|| Ok::<_, String>(17), "fixture worker failed").await,
        Ok(17)
    );
    let failed = verified_blocking(
        || -> Result<(), String> { panic!("fixture worker panic") },
        "fixture worker failed",
    )
    .await;
    assert_eq!(failed, Err("fixture worker failed".into()));
}

#[test]
fn warm_cache_report_never_authorizes_old_lifecycle_or_manifest_selection() {
    use serde_json::json;
    let report = json!({"passed":false,"error":"Native fixture phase deadline","cleanupError":null,"providerOrModelCommands":0});
    assert!(cold_report_allows_artifact_only_reuse(&report));
    for field in ["actualEntryOpenRunning", "firstNative", "hostIdentity"] {
        let mut bad = report.clone();
        bad[field] = json!(true);
        assert!(!cold_report_allows_artifact_only_reuse(&bad));
    }
    let mut bad = report.clone();
    bad["passed"] = json!(true);
    assert!(!cold_report_allows_artifact_only_reuse(&bad));
    let mut bad = report.clone();
    bad["cleanupError"] = json!("unresolved");
    assert!(!cold_report_allows_artifact_only_reuse(&bad));
    // Report metadata never chooses the actual compiled archive/manifest pins.
    let mut untrusted = report;
    untrusted["hostManifest"] = json!("forged");
    assert!(cold_report_allows_artifact_only_reuse(&untrusted));
    assert_eq!(
        HOST_MANIFEST,
        "f97ab782c6f30c60825140fddff89e6e5e820e03dfdf57347751ef56230856af"
    );
}

// This child inherits the actual private Scope/root/cleanup infrastructure.
// No policy is available until a real artifact is independently reviewed.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[path = "managed_native_keychain_qa.rs"]
pub(crate) mod keychain_qa;

#[cfg(target_arch = "aarch64")]
#[test]
fn sdk_bundle_identity_is_fixed_to_the_verified_purpose() {
    use crate::managed_desktop::DesktopIdentity;
    assert_eq!(
        sdk_bundle_id(DesktopIdentity::Production),
        "com.blackcrab.desktop.managed"
    );
    let permit = keychain_qa::reviewed().unwrap();
    let qa = sdk_bundle_id(DesktopIdentity::NativeKeychainQa(permit));
    assert_eq!(qa, permit.pins().app_id);
    assert_ne!(qa, sdk_bundle_id(DesktopIdentity::Production));
}
