//! Supervises the background service for a scheduled task on Windows.
//!
//! A task definition carries no environment and ending a task terminates its
//! process without running any handler, which would leave the issuer's
//! journal unretired. This supervisor is what the task runs instead. It
//! starts the service launcher on a hidden console with an exact environment,
//! inside a job so nothing it starts can outlive it, and waits for either the
//! launcher's exit or a stop request. A stop is delivered as Ctrl+C, which the
//! Node launcher handles as SIGINT; only if it has not exited within the grace
//! period is the whole job ended.
//!
//! The stop request is a named event in the session's local namespace that
//! only the current user can open. Creating it also proves there is no other
//! supervisor for the same key in this session.
#![cfg(windows)]
use crate::{
    managed_private_windows::Descriptor,
    managed_spawn_windows::{interrupt, spawn_with, Console, Job, Options},
};
use std::{
    ffi::OsString,
    fs::OpenOptions,
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::PathBuf,
    ptr,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{
        DuplicateHandle, GetLastError, DUPLICATE_SAME_ACCESS, ERROR_ALREADY_EXISTS,
        ERROR_FILE_NOT_FOUND, HANDLE, WAIT_OBJECT_0,
    },
    System::Threading::{
        CreateEventW, GetCurrentProcess, OpenEventW, SetEvent, WaitForMultipleObjects,
        EVENT_MODIFY_STATE, INFINITE,
    },
};

pub(crate) struct Plan {
    pub(crate) executable: PathBuf,
    pub(crate) arguments: Vec<OsString>,
    /// Exactly what the service sees; nothing is inherited.
    pub(crate) environment: Vec<(OsString, OsString)>,
    pub(crate) directory: PathBuf,
    /// Appended to; created inside an already private directory.
    pub(crate) log: Option<PathBuf>,
    /// 32 lowercase hex characters naming this service instance.
    pub(crate) key: String,
    /// How long the service has to exit after being asked to stop.
    pub(crate) grace: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// The service ended by itself with this exit code.
    Exited(u32),
    /// The service was asked to stop and ended by itself with this exit code.
    Stopped(u32),
    /// The service did not stop in time, or could not be asked; it and
    /// everything it started were ended.
    Killed,
}

fn event_name(key: &str) -> io::Result<Vec<u16>> {
    if key.len() != 32 || !key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    Ok(std::ffi::OsStr::new(&format!(r"Local\blackcrab-service-stop-{key}"))
        .encode_wide()
        .chain(std::iter::once(0))
        .collect())
}

/// Runs the service until it exits or a stop is requested. Fails with
/// `AlreadyExists` when another supervisor for `key` is running in this
/// session, without starting anything.
pub(crate) fn supervise(plan: &Plan) -> io::Result<Outcome> {
    let name = event_name(&plan.key)?;
    let descriptor = Descriptor::new("D:P(A;;GA;;;{sid})")?;
    // Manual reset, initially clear.
    let event = unsafe { CreateEventW(&descriptor.attributes(false), 1, 0, name.as_ptr()) };
    let already = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    if event.is_null() {
        return Err(io::Error::last_os_error());
    }
    let event = unsafe { OwnedHandle::from_raw_handle(event) };
    if already {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    let output = match &plan.log {
        None => None,
        Some(path) => {
            let file = OpenOptions::new().append(true).create(true).open(path)?;
            let mut inheritable: HANDLE = ptr::null_mut();
            if unsafe {
                DuplicateHandle(
                    GetCurrentProcess(),
                    file.as_raw_handle() as HANDLE,
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
            Some(unsafe { OwnedHandle::from_raw_handle(inheritable) })
        }
    };
    let job = Job::new()?;
    let process = spawn_with(
        &plan.executable,
        &plan.arguments,
        &plan.environment,
        &plan.directory,
        &[],
        &Options { console: Console::Hidden, output: output.as_ref(), job: Some(&job) },
    )?;
    drop(output);
    let handles = [process.raw(), event.as_raw_handle() as HANDLE];
    let signalled = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, INFINITE) };
    if signalled == WAIT_OBJECT_0 {
        // The lower index wins when both are ready: an exit is never
        // reported as a stop.
        return match process.wait(Duration::ZERO)? {
            Some(code) => Ok(Outcome::Exited(code)),
            None => Err(io::Error::other("service exit not observable")),
        };
    }
    if signalled != WAIT_OBJECT_0 + 1 {
        let error = io::Error::last_os_error();
        let _ = job.terminate();
        return Err(error);
    }
    let asked = interrupt(&process).is_ok();
    if asked {
        if let Some(code) = process.wait(plan.grace)? {
            return Ok(Outcome::Stopped(code));
        }
    }
    job.terminate()?;
    let _ = process.wait(Duration::from_secs(10));
    Ok(Outcome::Killed)
}

/// Asks the supervisor for `key` in this session to stop its service.
/// `Ok(false)` means none is running.
pub(crate) fn request_stop(key: &str) -> io::Result<bool> {
    let name = event_name(key)?;
    let event = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) };
    if event.is_null() {
        return if unsafe { GetLastError() } == ERROR_FILE_NOT_FOUND {
            Ok(false)
        } else {
            Err(io::Error::last_os_error())
        };
    }
    let event = unsafe { OwnedHandle::from_raw_handle(event) };
    if unsafe { SetEvent(event.as_raw_handle() as HANDLE) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // A stand-in for the service launcher with a child of its own, as the
    // launcher has its server. `mode` selects how it treats a stop.
    const SERVICE: &str = r#"
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const [mode, directory] = process.argv.slice(-2);
const note = (name, text) => fs.writeFileSync(path.join(directory, name), text);
if (mode === 'as-child') {
  process.on('SIGINT', () => {});
  setInterval(() => {}, 1000);
  note('child-ready', String(process.pid));
} else {
  console.log('service stdout ' + mode);
  console.error('service stderr ' + mode);
  note('environment', JSON.stringify(process.env));
  if (mode === 'exits') process.exit(7);
  const child = spawn(process.execPath, ['-e', fs.readFileSync(path.join(directory, 'script.js'), 'utf8'), 'as-child', directory],
    { stdio: 'ignore', env: process.env });
  process.on('SIGINT', () => {
    note('signal', 'SIGINT');
    if (mode === 'stops') { child.kill(); setTimeout(() => { note('stopped', 'clean'); process.exit(0); }, 300); }
  });
  setInterval(() => {}, 1000);
  note('ready', String(process.pid));
}
"#;

    struct Fixture {
        directory: PathBuf,
        key: String,
    }
    impl Fixture {
        fn new() -> Self {
            let mut nonce = [0u8; 16];
            getrandom::getrandom(&mut nonce).unwrap();
            let key: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
            let directory = std::env::temp_dir().join(format!("blackcrab-service-run-{key}"));
            std::fs::create_dir(&directory).unwrap();
            std::fs::write(directory.join("script.js"), SERVICE).unwrap();
            Self { directory, key }
        }
        fn plan(&self, mode: &str, grace: Duration) -> Plan {
            let node = std::process::Command::new("where").arg("node.exe").output().unwrap();
            assert!(node.status.success(), "node.exe is required for this test");
            Plan {
                executable: PathBuf::from(String::from_utf8(node.stdout).unwrap().lines().next().unwrap().trim()),
                arguments: vec!["-e".into(), SERVICE.into(), mode.into(), self.directory.clone().into_os_string()],
                environment: vec![
                    ("SystemRoot".into(), std::env::var_os("SystemRoot").unwrap()),
                    ("BLACKCRAB_SERVICE_PROBE".into(), "exact".into()),
                ],
                directory: self.directory.clone(),
                log: Some(self.directory.join("service.log")),
                key: self.key.clone(),
                grace,
            }
        }
        fn read(&self, name: &str) -> Option<String> {
            std::fs::read_to_string(self.directory.join(name)).ok()
        }
        fn wait_for(&self, name: &str) -> String {
            let deadline = std::time::Instant::now() + Duration::from_secs(60);
            loop {
                if let Some(text) = self.read(name) {
                    return text;
                }
                assert!(std::time::Instant::now() < deadline, "{name} never appeared");
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
    fn running(pid: &str) -> bool {
        let listed = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&listed.stdout).contains(&format!("\"{pid}\""))
    }
    fn wait_gone(pid: &str) {
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while running(pid) {
            assert!(std::time::Instant::now() < deadline, "process {pid} survived");
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn log(directory: &Path) -> String {
        std::fs::read_to_string(directory.join("service.log")).unwrap()
    }

    #[test]
    fn a_stop_request_reaches_the_service_as_sigint_and_its_own_exit_is_reported() {
        let fixture = Fixture::new();
        assert!(!request_stop(&fixture.key).unwrap());
        let plan = fixture.plan("stops", Duration::from_secs(30));
        std::thread::scope(|scope| {
            let supervisor = scope.spawn(|| supervise(&plan));
            fixture.wait_for("ready");
            let child = fixture.wait_for("child-ready");
            // A second supervisor for the same instance starts nothing.
            assert_eq!(supervise(&plan).unwrap_err().kind(), io::ErrorKind::AlreadyExists);
            assert!(request_stop(&fixture.key).unwrap());
            assert_eq!(supervisor.join().unwrap().unwrap(), Outcome::Stopped(0));
            assert_eq!(fixture.read("signal").as_deref(), Some("SIGINT"));
            assert_eq!(fixture.read("stopped").as_deref(), Some("clean"));
            wait_gone(&child);
        });
        // Exactly the given environment, and both streams in the log.
        let environment: serde_json::Value = serde_json::from_str(&fixture.read("environment").unwrap()).unwrap();
        assert_eq!(environment["BLACKCRAB_SERVICE_PROBE"], "exact");
        assert_eq!(environment.as_object().unwrap().len(), 2, "{environment}");
        let log = log(&fixture.directory);
        assert!(log.contains("service stdout stops") && log.contains("service stderr stops"), "{log}");
        // With the supervisor gone its name is free again.
        assert!(!request_stop(&fixture.key).unwrap());
    }

    #[test]
    fn a_service_that_ignores_the_stop_is_ended_with_everything_it_started() {
        let fixture = Fixture::new();
        let plan = fixture.plan("ignores", Duration::from_secs(2));
        std::thread::scope(|scope| {
            let supervisor = scope.spawn(|| supervise(&plan));
            let service = fixture.wait_for("ready");
            let child = fixture.wait_for("child-ready");
            assert!(request_stop(&fixture.key).unwrap());
            assert_eq!(supervisor.join().unwrap().unwrap(), Outcome::Killed);
            assert_eq!(fixture.read("signal").as_deref(), Some("SIGINT"));
            assert_eq!(fixture.read("stopped"), None);
            wait_gone(&service);
            wait_gone(&child);
        });
    }

    #[test]
    fn a_service_that_ends_by_itself_reports_its_exit_code_and_appends_to_the_log() {
        let fixture = Fixture::new();
        std::fs::write(fixture.directory.join("service.log"), "earlier run\n").unwrap();
        let plan = fixture.plan("exits", Duration::from_secs(2));
        assert_eq!(supervise(&plan).unwrap(), Outcome::Exited(7));
        let log = log(&fixture.directory);
        assert!(log.starts_with("earlier run\n") && log.contains("service stdout exits"), "{log}");
        for key in ["short", "0123456789abcdef0123456789ABCDEF", "0123456789abcdef0123456789abcde/"] {
            assert_eq!(request_stop(key).unwrap_err().kind(), io::ErrorKind::InvalidInput);
        }
    }
}
