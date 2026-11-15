//! Starting the workspace on Windows: the account home, the private profile,
//! the exact environment, the private channels and the process itself.
//!
//! This is the Windows form of what `managed_desktop.rs` does on macOS and
//! Linux with UIDs, mode bits and socket pairs. It knows nothing about the
//! host, pairing or packages; `managed_desktop.rs` supplies those.
use crate::{
    managed_private_windows::{self as private, Access},
    managed_spawn_windows::{channel, spawn, ChildEnd, Pipe, Process},
};
use std::{
    ffi::OsString,
    fs::OpenOptions,
    io::{self, Read, Write},
    os::windows::{ffi::OsStringExt, io::{FromRawHandle, OwnedHandle}},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_INSUFFICIENT_BUFFER, HANDLE},
    Security::TOKEN_QUERY,
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

#[link(name = "userenv")]
extern "system" {
    fn GetUserProfileDirectoryW(token: HANDLE, directory: *mut u16, size: *mut u32) -> i32;
}

fn refused() -> io::Error {
    io::Error::from(io::ErrorKind::PermissionDenied)
}

/// A real path as Node's `realpathSync` reports it: canonical, without the
/// `\\?\` prefix. Network and device paths are refused.
fn real(path: &Path) -> io::Result<PathBuf> {
    let canonical = std::fs::canonicalize(path)?;
    let text = canonical.to_str().ok_or_else(refused)?;
    let plain = text.strip_prefix(r"\\?\").ok_or_else(refused)?;
    let bytes = plain.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || &bytes[1..3] != br":\" {
        return Err(refused());
    }
    Ok(PathBuf::from(plain))
}

/// The signed-in account's profile directory, from this process's own token.
/// No environment variable, argument or descriptor has any say in it.
pub(crate) fn account_home() -> io::Result<PathBuf> {
    let mut token: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(token) };
    let raw = {
        use std::os::windows::io::AsRawHandle;
        token.as_raw_handle() as HANDLE
    };
    let mut size = 0u32;
    unsafe { GetUserProfileDirectoryW(raw, std::ptr::null_mut(), &mut size) };
    if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER || size == 0 || size > 32_768 {
        return Err(refused());
    }
    let mut units = vec![0u16; size as usize];
    if unsafe { GetUserProfileDirectoryW(raw, units.as_mut_ptr(), &mut size) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let length = units.iter().position(|unit| *unit == 0).ok_or_else(refused)?;
    let home = PathBuf::from(OsString::from_wide(&units[..length]));
    if !home.is_absolute() {
        return Err(refused());
    }
    let home = real(&home)?;
    // A real directory nobody else can modify: the equivalent of refusing a
    // group- or world-writable home.
    private::directory(&home, Access::NoForeignWrite).map_err(|_| refused())?;
    Ok(home)
}

fn private_directory(path: &Path) -> io::Result<()> {
    match private::create_private_directory(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    private::directory(path, Access::Private).map_err(|_| refused())
}

/// Creates the workspace profile on first use and verifies it every time: a
/// real directory at its canonical path, private by its own protected DACL,
/// inside a private parent, carrying our marker. Returns the canonical path.
pub(crate) fn prepare_profile(path: &Path, marker: &[u8]) -> io::Result<PathBuf> {
    let parent = path.parent().ok_or_else(refused)?;
    private::directory(parent, Access::Private).map_err(|_| refused())?;
    let name = path.join(".blackcrab-managed-desktop");
    if !path.exists() {
        private::create_private_directory(path)?;
        let mut file = private::open_file(&name, OpenOptions::new().write(true).create_new(true))
            .map_err(|_| refused())?;
        file.write_all(marker)?;
        file.sync_all()?;
    }
    private::directory(path, Access::Private).map_err(|_| refused())?;
    let mut file = private::open_file(&name, OpenOptions::new().read(true)).map_err(|_| refused())?;
    private::security(&file, Access::Private).map_err(|_| refused())?;
    let mut found = Vec::new();
    (&mut file).take(marker.len() as u64 + 1).read_to_end(&mut found)?;
    if found != marker {
        return Err(refused());
    }
    let canonical = real(path)?;
    private_directory(&canonical.join("tmp"))?;
    Ok(canonical)
}

/// Exactly what the workspace is given. The environment contract owns
/// `USERPROFILE`, `TEMP` and `TMP`; the rest is what a Windows program needs
/// to start at all. Nothing is inherited by default.
pub(crate) fn environment(home: &Path, profile: &Path) -> io::Result<Vec<(OsString, OsString)>> {
    let system = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty()).ok_or_else(refused);
    let root = PathBuf::from(system("SystemRoot")?);
    if !root.is_absolute() {
        return Err(refused());
    }
    // The system's own default search path, built from SystemRoot and never
    // inherited. The workspace reads the user's shell environment through
    // PowerShell, which lives in its own directory under System32.
    let system32 = root.join("System32");
    let mut path = system32.clone().into_os_string();
    for directory in [root.clone(), system32.join("Wbem"), system32.join("WindowsPowerShell").join("v1.0")] {
        path.push(";");
        path.push(directory);
    }
    let temporary = profile.join("tmp").into_os_string();
    Ok(vec![
        ("SystemRoot".into(), root.clone().into_os_string()),
        ("SystemDrive".into(), system("SystemDrive")?),
        ("windir".into(), root.into_os_string()),
        ("USERPROFILE".into(), home.as_os_str().to_owned()),
        ("PATH".into(), path),
        ("TEMP".into(), temporary.clone()),
        ("TMP".into(), temporary),
        ("OTEL_SDK_DISABLED".into(), "true".into()),
    ])
}

/// A started workspace and our ends of its private channels.
pub(crate) struct Started {
    pub(crate) process: Process,
    /// Descriptor 3 in the workspace: the bootstrap descriptor, written once.
    pub(crate) bootstrap: Pipe,
    /// Descriptor 4: credential renewal requests and replies.
    pub(crate) renewal: Pipe,
    /// Descriptor 6: window activation requests and replies.
    pub(crate) lifecycle: Pipe,
}

/// Starts the verified workspace executable in its package directory with
/// the exact environment and its three private channels. Its standard
/// streams are the null device.
pub(crate) fn start(executable: &Path, package: &Path, home: &Path, profile: &Path) -> io::Result<Started> {
    let (bootstrap, renewal, lifecycle) =
        (channel(ChildEnd::Blocking)?, channel(ChildEnd::Duplex)?, channel(ChildEnd::Duplex)?);
    let descriptors = [(3, &bootstrap.theirs), (4, &renewal.theirs), (6, &lifecycle.theirs)];
    // Test builds only: CI can keep what the workspace prints, with
    // Chromium's own logging on, to see why a page did not load. A product
    // build always discards the workspace's output and adds no variable.
    #[cfg(test)]
    if let Some(file) = std::env::var_os("BLACKCRAB_TEST_WORKSPACE_OUTPUT") {
        use crate::managed_spawn_windows::{spawn_with, Console, Options};
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::{DuplicateHandle, DUPLICATE_SAME_ACCESS};
        let log = OpenOptions::new().append(true).create(true).open(file)?;
        let mut inheritable: HANDLE = std::ptr::null_mut();
        if unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                log.as_raw_handle() as HANDLE,
                GetCurrentProcess(),
                &mut inheritable,
                0,
                1,
                DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let output = unsafe { OwnedHandle::from_raw_handle(inheritable) };
        let mut variables = environment(home, profile)?;
        variables.push(("ELECTRON_ENABLE_LOGGING".into(), "1".into()));
        // Chromium's debugging port, so CI can read the page itself.
        let arguments: Vec<OsString> = std::env::var("BLACKCRAB_TEST_WORKSPACE_DEBUG_PORT")
            .ok()
            .map(|port| OsString::from(format!("--remote-debugging-port={port}")))
            .into_iter()
            .collect();
        let process = spawn_with(
            executable,
            &arguments,
            &variables,
            package,
            &descriptors,
            &Options { console: Console::Inherited, output: Some(&output), job: None },
        )?;
        return Ok(Started { process, bootstrap: bootstrap.ours, renewal: renewal.ours, lifecycle: lifecycle.ours });
    }
    let process = spawn(executable, &[], &environment(home, profile)?, package, &descriptors)?;
    // Dropping `theirs` here leaves the workspace holding the only other end
    // of each channel, so its exit is seen as end of stream.
    Ok(Started { process, bootstrap: bootstrap.ours, renewal: renewal.ours, lifecycle: lifecycle.ours })
}

/// Window activation over descriptor 6. The same protocol and deadlines as
/// the Unix channel in `managed_desktop_lifecycle.rs`.
pub(crate) struct Lifecycle {
    pipe: Option<Pipe>,
    next_id: u64,
    answered: bool,
}
const STARTUP: Duration = Duration::from_secs(60);
const STEADY: Duration = Duration::from_secs(3);
const REPLY_LIMIT: usize = 1024;
impl Lifecycle {
    pub(crate) fn new(pipe: Pipe) -> Self {
        Self { pipe: Some(pipe), next_id: 1, answered: false }
    }
    pub(crate) fn close(&mut self) {
        self.pipe = None;
    }
    /// Asks the workspace to show its window; `Ok(visible)` is its answer.
    /// A channel that failed or timed out is never used again: a late reply
    /// could otherwise be taken for the answer to a later request.
    pub(crate) fn activate(&mut self) -> io::Result<bool> {
        let timeout = if self.answered { STEADY } else { STARTUP };
        let result = self.exchange(timeout);
        match result {
            Ok(_) => self.answered = true,
            Err(_) => self.close(),
        }
        result
    }
    fn exchange(&mut self, timeout: Duration) -> io::Result<bool> {
        let pipe = self.pipe.as_ref().ok_or_else(refused)?;
        if self.next_id > 9_007_199_254_740_991 {
            return Err(refused());
        }
        let id = self.next_id;
        self.next_id += 1;
        let deadline = Instant::now() + timeout;
        pipe.write_all(
            format!("{{\"version\":1,\"id\":{id},\"action\":\"activate\"}}\n").as_bytes(),
            Some(timeout),
        )?;
        let mut frame = Vec::new();
        loop {
            let left = deadline
                .checked_duration_since(Instant::now())
                .filter(|left| !left.is_zero())
                .ok_or_else(|| io::Error::from(io::ErrorKind::TimedOut))?;
            let mut byte = [0u8; 1];
            if pipe.read(&mut byte, Some(left))? != 1 {
                return Err(io::Error::from(io::ErrorKind::UnexpectedEof));
            }
            if byte[0] == b'\n' {
                break;
            }
            frame.push(byte[0]);
            if frame.len() > REPLY_LIMIT {
                return Err(refused());
            }
        }
        let reply: serde_json::Value = serde_json::from_slice(&frame).map_err(|_| refused())?;
        let fields = reply.as_object().ok_or_else(refused)?;
        if fields.len() != 3 || reply["version"] != 1 || reply["id"] != id {
            return Err(refused());
        }
        reply["visible"].as_bool().ok_or_else(refused)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let path = real(&std::env::temp_dir()).unwrap().join(format!(
            "blackcrab-workspace-{}",
            nonce.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
        ));
        private::create_private_directory(&path).unwrap();
        path
    }

    #[test]
    fn the_account_home_is_the_token_profile_at_its_real_path() {
        let home = account_home().unwrap();
        assert!(home.is_dir());
        assert_eq!(real(&home).unwrap(), home);
        // On an ordinary account it is what USERPROFILE names.
        let named = real(Path::new(&std::env::var_os("USERPROFILE").unwrap())).unwrap();
        assert_eq!(home.to_string_lossy().to_lowercase(), named.to_string_lossy().to_lowercase());
    }

    #[test]
    fn a_profile_is_created_private_and_then_only_accepted_as_it_was_made() {
        let base = scratch();
        let marker = b"profile-marker-v1\n";
        let profile = prepare_profile(&base.join("profile"), marker).unwrap();
        assert_eq!(profile, base.join("profile"));
        assert_eq!(private::directory(&profile, Access::Private), Ok(()));
        assert_eq!(private::directory(&profile.join("tmp"), Access::Private), Ok(()));
        // Opening it again changes nothing and is accepted.
        assert_eq!(prepare_profile(&profile, marker).unwrap(), profile);
        // A different marker is someone else's directory.
        assert!(prepare_profile(&profile, b"other\n").is_err());
        // Readable by everyone is not private.
        let granted = std::process::Command::new("icacls")
            .arg(&profile)
            .args(["/grant", "*S-1-1-0:(OI)(CI)R"])
            .output()
            .unwrap();
        assert!(granted.status.success());
        assert!(prepare_profile(&profile, marker).is_err());
        // Nor is a profile inside a parent others can read.
        let open = base.join("open");
        std::fs::create_dir(&open).unwrap();
        let granted = std::process::Command::new("icacls")
            .arg(&open)
            .args(["/grant", "*S-1-1-0:(OI)(CI)R"])
            .output()
            .unwrap();
        assert!(granted.status.success());
        assert!(prepare_profile(&open.join("profile"), marker).is_err());
        assert!(!open.join("profile").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_environment_is_exactly_the_owned_and_system_variables() {
        let home = PathBuf::from(r"C:\Users\someone");
        let profile = PathBuf::from(r"C:\Users\someone\AppData\profile");
        let variables = environment(&home, &profile).unwrap();
        let names: Vec<_> = variables.iter().map(|(name, _)| name.to_string_lossy().into_owned()).collect();
        assert_eq!(
            names,
            ["SystemRoot", "SystemDrive", "windir", "USERPROFILE", "PATH", "TEMP", "TMP", "OTEL_SDK_DISABLED"]
        );
        let value = |name: &str| variables.iter().find(|(key, _)| key == name).unwrap().1.clone();
        assert_eq!(value("USERPROFILE"), home.as_os_str());
        assert_eq!(value("TEMP"), profile.join("tmp").as_os_str());
        assert_eq!(value("TMP"), value("TEMP"));
        let root = std::env::var("SystemRoot").unwrap();
        assert_eq!(
            value("PATH").to_string_lossy(),
            format!(r"{root}\System32;{root};{root}\System32\Wbem;{root}\System32\WindowsPowerShell\v1.0")
        );
    }

    #[test]
    fn activation_is_answered_once_per_request_and_a_bad_reply_retires_the_channel() {
        let pair = channel(ChildEnd::Duplex).unwrap();
        // Stand in for the workspace on the other end.
        let theirs = Pipe::adopt(pair.theirs);
        let peer = std::thread::spawn(move || {
            let mut answered = 0;
            let mut line = Vec::new();
            loop {
                let mut byte = [0u8; 1];
                match theirs.read(&mut byte, Some(Duration::from_secs(10))) {
                    Ok(1) => {}
                    _ => return answered,
                }
                if byte[0] != b'\n' {
                    line.push(byte[0]);
                    continue;
                }
                let request: serde_json::Value = serde_json::from_slice(&line).unwrap();
                line.clear();
                assert_eq!(request["action"], "activate");
                answered += 1;
                let reply = if answered == 1 {
                    format!("{{\"version\":1,\"id\":{},\"visible\":true}}\n", request["id"])
                } else {
                    // The wrong request's number.
                    "{\"version\":1,\"id\":99,\"visible\":true}\n".to_string()
                };
                theirs.write_all(reply.as_bytes(), Some(Duration::from_secs(10))).unwrap();
            }
        });
        let mut lifecycle = Lifecycle::new(pair.ours);
        assert!(lifecycle.activate().unwrap());
        assert!(lifecycle.activate().is_err());
        // Retired: nothing more is sent.
        assert!(lifecycle.activate().is_err());
        drop(lifecycle);
        assert_eq!(peer.join().unwrap(), 2);
    }
}
