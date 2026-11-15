//! Starts a child with private inherited channels at fixed descriptor numbers,
//! the Windows counterpart of the Unix `dup2` into descriptors 3 and up.
//!
//! Windows has no descriptor table in the kernel. The C runtime in the child
//! rebuilds one from `STARTUPINFO.lpReserved2`, which is how Node and Electron
//! children receive extra `stdio` entries. Each channel is one duplex named
//! pipe with a random name, a single instance, a DACL for the current user
//! only and remote clients rejected. The child receives exactly the listed
//! handles: inheritance is restricted with an explicit handle list, so nothing
//! else this process holds leaks into it.
#![cfg(windows)]
use crate::managed_private_windows::Descriptor;
use std::{
    ffi::{OsStr, OsString},
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{
        GetLastError, ERROR_BROKEN_PIPE, ERROR_IO_PENDING, HANDLE, INVALID_HANDLE_VALUE,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
        OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
    },
    System::{
        IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED},
        Pipes::{
            CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
            PIPE_WAIT,
        },
        Threading::{
            CreateEventW, CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
            InitializeProcThreadAttributeList, TerminateProcess, UpdateProcThreadAttribute,
            WaitForSingleObject, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT,
            EXTENDED_STARTUPINFO_PRESENT,
            LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    },
};

const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
// C runtime descriptor flags carried in lpReserved2.
const FOPEN: u8 = 0x01;
const FPIPE: u8 = 0x08;
const FDEV: u8 = 0x40;
/// Highest descriptor number a child may be given.
pub(crate) const MAX_DESCRIPTOR: u32 = 15;

fn wide(text: &OsStr) -> io::Result<Vec<u16>> {
    let mut units: Vec<u16> = text.encode_wide().collect();
    if units.contains(&0) {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    units.push(0);
    Ok(units)
}

/// Our end of a channel. It is overlapped, so a pending read never blocks a
/// write on the same pipe and every transfer can be bounded in time. A peer
/// that has closed reads as end of stream.
pub(crate) struct Pipe(OwnedHandle);
impl Pipe {
    fn transfer(
        &self,
        timeout: Option<Duration>,
        start: impl FnOnce(HANDLE, *mut OVERLAPPED) -> i32,
    ) -> io::Result<usize> {
        let handle = self.0.as_raw_handle() as HANDLE;
        let event = unsafe { CreateEventW(ptr::null(), 1, 0, ptr::null()) };
        if event.is_null() {
            return Err(io::Error::last_os_error());
        }
        let _event = unsafe { OwnedHandle::from_raw_handle(event) };
        let mut state: OVERLAPPED = unsafe { std::mem::zeroed() };
        state.hEvent = event;
        if start(handle, &mut state) == 0 {
            let code = unsafe { GetLastError() };
            if code != ERROR_IO_PENDING {
                return Err(io::Error::from_raw_os_error(code as i32));
            }
            let millis = timeout
                .map(|t| t.as_millis().min(u128::from(u32::MAX - 1)) as u32)
                .unwrap_or(u32::MAX);
            if unsafe { WaitForSingleObject(event, millis) } == WAIT_TIMEOUT {
                // Cancel, then collect the outcome: the transfer may have
                // completed in the meantime and its bytes must not be lost.
                unsafe { CancelIoEx(handle, &state) };
                let mut moved = 0;
                if unsafe { GetOverlappedResult(handle, &state, &mut moved, 1) } != 0 {
                    return Ok(moved as usize);
                }
                return Err(io::Error::from(io::ErrorKind::TimedOut));
            }
        }
        let mut moved = 0;
        if unsafe { GetOverlappedResult(handle, &state, &mut moved, 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(moved as usize)
    }
    /// Reads at most `buffer.len()` bytes; `Ok(0)` means the peer closed.
    pub(crate) fn read(&self, buffer: &mut [u8], timeout: Option<Duration>) -> io::Result<usize> {
        let length = buffer.len().min(u32::MAX as usize) as u32;
        let pointer = buffer.as_mut_ptr();
        match self.transfer(timeout, |handle, state| unsafe {
            ReadFile(handle, pointer, length, ptr::null_mut(), state)
        }) {
            Err(error) if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) => Ok(0),
            other => other,
        }
    }
    /// Writes all of `bytes`, each transfer bounded by `timeout`.
    pub(crate) fn write_all(&self, mut bytes: &[u8], timeout: Option<Duration>) -> io::Result<()> {
        while !bytes.is_empty() {
            let length = bytes.len().min(u32::MAX as usize) as u32;
            let pointer = bytes.as_ptr();
            let written = self.transfer(timeout, |handle, state| unsafe {
                WriteFile(handle, pointer, length, ptr::null_mut(), state)
            })?;
            if written == 0 {
                return Err(io::Error::from(io::ErrorKind::WriteZero));
            }
            bytes = &bytes[written..];
        }
        Ok(())
    }
}

/// One private duplex channel: `ours` stays in this process, `theirs` is the
/// inheritable end handed to exactly one child.
pub(crate) struct Channel {
    pub(crate) ours: Pipe,
    pub(crate) theirs: OwnedHandle,
}

/// How the child will use its end. Node opens an inherited pipe with whatever
/// mode the handle has: a synchronous handle allows a blocking descriptor read
/// but stalls a write while a read is pending, so anything used in both
/// directions at once must be overlapped.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChildEnd {
    /// Read to end of stream with blocking reads (the bootstrap descriptor).
    Blocking,
    /// Request/reply or streaming in both directions.
    Duplex,
}

pub(crate) fn channel(child: ChildEnd) -> io::Result<Channel> {
    let mut nonce = [0u8; 16];
    getrandom::getrandom(&mut nonce).map_err(|_| io::Error::other("random unavailable"))?;
    let name: OsString = format!(
        r"\\.\pipe\blackcrab-{}",
        nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
    .into();
    let name = wide(&name)?;
    // Only the current user may open the pipe; SYSTEM and Administrators are
    // deliberately not granted, since no one else needs to connect.
    let descriptor = Descriptor::new("D:P(A;;GA;;;{sid})")?;
    let server = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            65536,
            65536,
            0,
            &descriptor.attributes(false),
        )
    };
    if server == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let ours = Pipe(unsafe { OwnedHandle::from_raw_handle(server) });
    // The single instance is taken by our own client end immediately.
    let client = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            &descriptor.attributes(true),
            OPEN_EXISTING,
            if child == ChildEnd::Duplex { FILE_FLAG_OVERLAPPED } else { 0 },
            ptr::null_mut(),
        )
    };
    if client == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(Channel {
        ours,
        theirs: unsafe { OwnedHandle::from_raw_handle(client) },
    })
}

fn null_device() -> io::Result<OwnedHandle> {
    let name = wide(OsStr::new("NUL"))?;
    let descriptor = Descriptor::new("D:P(A;;GA;;;{sid})")?;
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            3,
            &descriptor.attributes(true),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

/// Quotes one argument the way the Microsoft C runtime parses a command line.
fn quote(argument: &OsStr, line: &mut Vec<u16>) {
    let units: Vec<u16> = argument.encode_wide().collect();
    let plain = !units.is_empty()
        && !units
            .iter()
            .any(|u| [b' ', b'\t', b'\n', 0x0b, b'"'].contains(&(*u as u8)) && *u < 128);
    if plain {
        line.extend(units);
        return;
    }
    line.push(u16::from(b'"'));
    let mut backslashes = 0;
    for unit in units {
        if unit == u16::from(b'\\') {
            backslashes += 1;
        } else {
            if unit == u16::from(b'"') {
                // Escape the run of backslashes and the quote itself.
                line.extend(std::iter::repeat(u16::from(b'\\')).take(backslashes + 1));
            }
            backslashes = 0;
        }
        line.push(unit);
    }
    // Backslashes before the closing quote must be doubled.
    line.extend(std::iter::repeat(u16::from(b'\\')).take(backslashes));
    line.push(u16::from(b'"'));
}

pub(crate) struct Process {
    handle: OwnedHandle,
    pub(crate) id: u32,
}
impl Process {
    /// `Some(code)` once the process has exited.
    pub(crate) fn wait(&self, timeout: Duration) -> io::Result<Option<u32>> {
        let millis = timeout.as_millis().min(u128::from(u32::MAX - 1)) as u32;
        match unsafe { WaitForSingleObject(self.handle.as_raw_handle() as HANDLE, millis) } {
            WAIT_OBJECT_0 => {
                let mut code = 0;
                if unsafe { GetExitCodeProcess(self.handle.as_raw_handle() as HANDLE, &mut code) }
                    == 0
                {
                    return Err(io::Error::last_os_error());
                }
                Ok(Some(code))
            }
            WAIT_TIMEOUT => Ok(None),
            _ => Err(io::Error::last_os_error()),
        }
    }
    pub(crate) fn terminate(&self) -> io::Result<()> {
        if unsafe { TerminateProcess(self.handle.as_raw_handle() as HANDLE, 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

/// Delivers Ctrl+C to every process on the hidden console `process` was
/// started with: the only stop a Node program can handle on Windows, where it
/// arrives as SIGINT. Windows sends console events to a console, not a
/// process, so this process leaves its own console, joins the child's, ignores
/// the event itself and raises it there. It stays detached afterwards: the
/// caller is a background helper with no console to return to.
pub(crate) fn interrupt(process: &Process) -> io::Result<()> {
    use windows_sys::Win32::System::Console::{
        AttachConsole, FreeConsole, GenerateConsoleCtrlEvent, SetConsoleCtrlHandler, CTRL_C_EVENT,
    };
    unsafe {
        // Fails harmlessly when this process has no console.
        FreeConsole();
        if AttachConsole(process.id) == 0 {
            return Err(io::Error::last_os_error());
        }
        // A null handler with TRUE makes this process ignore Ctrl+C. Without
        // it the event raised below would end this process too.
        let outcome = if SetConsoleCtrlHandler(None, 1) == 0
            || GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) == 0
        {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        };
        FreeConsole();
        outcome
    }
}

struct AttributeList(Vec<u64>);
impl Drop for AttributeList {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.0.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST) };
    }
}

/// Starts `executable` with exactly `environment`, standard streams on the
/// null device, and each `(number, handle)` in `descriptors` visible to the
/// child's C runtime as that descriptor. Numbers must be 3..=MAX_DESCRIPTOR
/// and unique; unlisted numbers below the highest stay closed in the child.
pub(crate) fn spawn(
    executable: &Path,
    arguments: &[OsString],
    environment: &[(OsString, OsString)],
    directory: &Path,
    descriptors: &[(u32, &OwnedHandle)],
) -> io::Result<Process> {
    spawn_with(executable, arguments, environment, directory, descriptors, Console::Inherited)
}

/// Which console a console-subsystem child gets.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Console {
    /// The parent's, if it has one.
    Inherited,
    /// A new console of its own with no window. Its descendants share it, and
    /// `interrupt` can address it without touching any other console.
    Hidden,
}

pub(crate) fn spawn_with(
    executable: &Path,
    arguments: &[OsString],
    environment: &[(OsString, OsString)],
    directory: &Path,
    descriptors: &[(u32, &OwnedHandle)],
    console: Console,
) -> io::Result<Process> {
    let invalid = || io::Error::from(io::ErrorKind::InvalidInput);
    let mut count = 3;
    for (index, (number, _)) in descriptors.iter().enumerate() {
        if *number < 3
            || *number > MAX_DESCRIPTOR
            || descriptors[..index].iter().any(|(other, _)| other == number)
        {
            return Err(invalid());
        }
        count = count.max(*number as usize + 1);
    }
    let null = null_device()?;
    // int count; unsigned char flags[count]; HANDLE handles[count]; unaligned.
    let mut flags = vec![0u8; count];
    let mut handles = vec![INVALID_HANDLE_VALUE; count];
    for slot in 0..3 {
        flags[slot] = FOPEN | FDEV;
        handles[slot] = null.as_raw_handle() as HANDLE;
    }
    for (number, handle) in descriptors {
        flags[*number as usize] = FOPEN | FPIPE;
        handles[*number as usize] = handle.as_raw_handle() as HANDLE;
    }
    let mut reserved = Vec::with_capacity(4 + count + count * 8);
    reserved.extend_from_slice(&(count as u32).to_ne_bytes());
    reserved.extend_from_slice(&flags);
    for handle in &handles {
        reserved.extend_from_slice(&(*handle as usize).to_ne_bytes());
    }

    let mut inherited: Vec<HANDLE> = vec![null.as_raw_handle() as HANDLE];
    inherited.extend(descriptors.iter().map(|(_, h)| h.as_raw_handle() as HANDLE));
    let mut size = 0usize;
    unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), 1, 0, &mut size) };
    let mut list = AttributeList(vec![0u64; size.div_ceil(8).max(1)]);
    let attributes = list.0.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
    if unsafe { InitializeProcThreadAttributeList(attributes, 1, 0, &mut size) } == 0 {
        let error = io::Error::last_os_error();
        // Never initialised: nothing to delete.
        std::mem::forget(list);
        return Err(error);
    }
    if unsafe {
        UpdateProcThreadAttribute(
            attributes,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            inherited.as_ptr().cast(),
            inherited.len() * std::mem::size_of::<HANDLE>(),
            ptr::null_mut(),
            ptr::null(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }

    let application = wide(executable.as_os_str())?;
    let mut line = Vec::new();
    quote(executable.as_os_str(), &mut line);
    for argument in arguments {
        if argument.encode_wide().any(|u| u == 0) {
            return Err(invalid());
        }
        line.push(u16::from(b' '));
        quote(argument, &mut line);
    }
    line.push(0);
    // "NAME=value\0" entries, sorted without regard to case, then a final NUL.
    let mut entries: Vec<(String, Vec<u16>)> = Vec::new();
    for (name, value) in environment {
        let key: Vec<u16> = name.encode_wide().collect();
        let text: Vec<u16> = value.encode_wide().collect();
        if key.is_empty()
            || key.contains(&0)
            || key.contains(&u16::from(b'='))
            || text.contains(&0)
        {
            return Err(invalid());
        }
        let sort = name.to_string_lossy().to_uppercase();
        if entries.iter().any(|(other, _)| *other == sort) {
            return Err(invalid());
        }
        let mut entry = key;
        entry.push(u16::from(b'='));
        entry.extend(text);
        entry.push(0);
        entries.push((sort, entry));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut block: Vec<u16> = entries.into_iter().flat_map(|(_, entry)| entry).collect();
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    let directory = wide(directory.as_os_str())?;

    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = null.as_raw_handle() as HANDLE;
    startup.StartupInfo.hStdOutput = null.as_raw_handle() as HANDLE;
    startup.StartupInfo.hStdError = null.as_raw_handle() as HANDLE;
    startup.StartupInfo.cbReserved2 = reserved.len() as u16;
    startup.StartupInfo.lpReserved2 = reserved.as_mut_ptr();
    startup.lpAttributeList = attributes;
    let mut created: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        CreateProcessW(
            application.as_ptr(),
            line.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT
                | CREATE_UNICODE_ENVIRONMENT
                | if console == Console::Hidden { CREATE_NO_WINDOW } else { 0 },
            block.as_ptr().cast(),
            directory.as_ptr(),
            &startup.StartupInfo,
            &mut created,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    drop(unsafe { OwnedHandle::from_raw_handle(created.hThread) });
    Ok(Process {
        handle: unsafe { OwnedHandle::from_raw_handle(created.hProcess) },
        id: created.dwProcessId,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn text(line: &[u16]) -> String {
        String::from_utf16(line).unwrap()
    }
    #[test]
    fn arguments_are_quoted_for_the_c_runtime_parser() {
        for (argument, expected) in [
            ("plain", "plain"),
            ("", "\"\""),
            ("two words", "\"two words\""),
            (r"C:\dir\", r"C:\dir\"),
            (r"C:\a b\", r#""C:\a b\\""#),
            (r#"say "hi""#, r#""say \"hi\"""#),
            (r#"back\"slash"#, r#""back\\\"slash""#),
        ] {
            let mut line = Vec::new();
            quote(OsStr::new(argument), &mut line);
            assert_eq!(text(&line), expected, "{argument}");
        }
    }

    fn node() -> PathBuf {
        let found = std::process::Command::new("where").arg("node.exe").output().unwrap();
        assert!(found.status.success(), "node.exe is required for this test");
        PathBuf::from(String::from_utf8(found.stdout).unwrap().lines().next().unwrap().trim())
    }
    fn try_line(pipe: &Pipe) -> Result<String, String> {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        while !bytes.ends_with(b"\n") {
            match pipe.read(&mut buffer, Some(Duration::from_secs(30))) {
                Ok(0) => return Err("child closed the channel".into()),
                Ok(read) => bytes.extend_from_slice(&buffer[..read]),
                Err(error) => return Err(format!("no child reply: {error}")),
            }
        }
        Ok(String::from_utf8(bytes).unwrap())
    }
    fn line(pipe: &Pipe) -> String {
        try_line(pipe).unwrap()
    }

    // The child's standard streams are the null device, so it records each
    // step in a file the test prints if the child never reports.
    const CHILD: &str = r#"
const fs = require('fs'), net = require('net');
const trace = text => { try { fs.appendFileSync(process.argv[process.argv.length - 2], text + '\n'); } catch {} };
process.on('uncaughtException', error => { trace('uncaught ' + (error && error.stack)); process.exit(3); });
const kind = fd => { try { const s = fs.fstatSync(fd); return s.isFIFO() ? 'pipe' : s.isSocket() ? 'socket' : 'other'; } catch (error) { return 'closed'; } };
trace('started ' + JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7].map(kind)));
let descriptor = Buffer.alloc(0);
for (;;) { const b = Buffer.alloc(1024); const n = fs.readSync(3, b, 0, 1024, null); trace('read ' + n); if (!n) break; descriptor = Buffer.concat([descriptor, b.subarray(0, n)]); }
fs.closeSync(3);
trace('descriptor complete');
const renewal = new net.Socket({ fd: 4, readable: true, writable: true });
const lifecycle = new net.Socket({ fd: 6, readable: true, writable: true });
trace('sockets open');
renewal.on('error', error => trace('renewal error ' + error));
lifecycle.on('error', error => trace('lifecycle error ' + error));
renewal.on('data', chunk => renewal.write('renewal:' + chunk));
lifecycle.on('data', chunk => lifecycle.write('lifecycle:' + chunk));
renewal.write(JSON.stringify({ descriptor: descriptor.toString(), four: kind(4), five: kind(5), six: kind(6), seven: kind(7),
  probe: process.env.BLACKCRAB_PROBE, variables: Object.keys(process.env).length, argument: process.argv[process.argv.length - 1], directory: process.cwd() }) + '\n',
  error => trace('report written ' + error));
"#;

    #[test]
    fn a_node_child_receives_only_the_listed_descriptors_and_environment() {
        let node = node();
        let (bootstrap, renewal, lifecycle) = (
            channel(ChildEnd::Blocking).unwrap(),
            channel(ChildEnd::Duplex).unwrap(),
            channel(ChildEnd::Duplex).unwrap(),
        );
        let unrelated = channel(ChildEnd::Duplex).unwrap();
        let directory = std::env::temp_dir();
        let root = std::env::var_os("SystemRoot").unwrap();
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let trace = directory.join(format!(
            "blackcrab-spawn-trace-{}.txt",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        let process = spawn(
            &node,
            &[
                "-e".into(),
                CHILD.into(),
                trace.clone().into_os_string(),
                "an argument with \"quotes\" and spaces".into(),
            ],
            &[("SystemRoot".into(), root), ("BLACKCRAB_PROBE".into(), "only this".into())],
            &directory,
            &[(3, &bootstrap.theirs), (4, &renewal.theirs), (6, &lifecycle.theirs)],
        )
        .unwrap();
        // The child holds its own copies; ours would keep the pipes open.
        drop((bootstrap.theirs, renewal.theirs, lifecycle.theirs));
        let second = Some(Duration::from_secs(10));
        bootstrap.ours.write_all(b"{\"version\":1}", second).unwrap();
        // Closing our end is the end-of-descriptor signal.
        drop(bootstrap.ours);

        let report = try_line(&renewal.ours).unwrap_or_else(|failure| {
            panic!(
                "{failure}; child exit {:?}; child trace:\n{}",
                process.wait(Duration::from_millis(0)),
                std::fs::read_to_string(&trace).unwrap_or_else(|e| format!("<no trace: {e}>"))
            )
        });
        let _ = std::fs::remove_file(&trace);
        assert!(report.contains(r#""descriptor":"{\"version\":1}""#), "{report}");
        // Node reports these pipes as neither FIFO nor socket on Windows.
        assert!(report.contains(r#""four":"other""#), "{report}");
        assert!(report.contains(r#""five":"closed""#), "{report}");
        assert!(report.contains(r#""six":"other""#), "{report}");
        assert!(report.contains(r#""seven":"closed""#), "{report}");
        assert!(report.contains(r#""probe":"only this""#), "{report}");
        assert!(report.contains(r#""argument":"an argument with \"quotes\" and spaces""#), "{report}");
        // Exactly what was passed: no inherited PATH, USERPROFILE or the like.
        assert!(report.contains(r#""variables":2"#), "{report}");

        // A read with nothing to receive times out and loses nothing; a
        // pending read on one channel does not block a write on it.
        let mut scratch = [0u8; 16];
        let quiet = renewal.ours.read(&mut scratch, Some(Duration::from_millis(200)));
        assert_eq!(quiet.unwrap_err().kind(), io::ErrorKind::TimedOut);
        std::thread::scope(|scope| {
            let waiting = scope.spawn(|| line(&renewal.ours));
            std::thread::sleep(Duration::from_millis(200));
            renewal.ours.write_all(b"ping\n", second).unwrap();
            assert_eq!(waiting.join().unwrap(), "renewal:ping\n");
        });
        lifecycle.ours.write_all(b"activate\n", second).unwrap();
        assert_eq!(line(&lifecycle.ours), "lifecycle:activate\n");

        assert_eq!(process.wait(Duration::from_millis(50)).unwrap(), None);
        process.terminate().unwrap();
        assert_eq!(process.wait(Duration::from_secs(10)).unwrap(), Some(1));
        // With the child gone its ends are closed: reads report end of stream.
        assert_eq!(renewal.ours.read(&mut scratch, second).unwrap(), 0);
        drop(unrelated);
    }

    // The workspace's own channel modules, unmodified, on Root-made pipes.
    const WORKSPACE: &str = r#"
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [trace, directory] = process.argv.slice(-2);
const note = text => { try { fs.appendFileSync(trace, text + '\n'); } catch {} };
process.on('uncaughtException', error => { note('uncaught ' + (error && error.stack)); process.exit(3); });
const load = name => import(pathToFileURL(directory + '/' + name).href);
const hold = setInterval(() => {}, 1000);
try {
  const { openLifecycle } = await load('lifecycle.mjs');
  const { createCredentialBroker } = await load('credential-broker.mjs');
  const { openUpdateClient } = await load('update-client.mjs');
  openLifecycle({ lifecycle: { kind: 'launcher-lifecycle-fd-v1', fd: 6 } }, async () => true);
  const updates = openUpdateClient({ kind: 'launcher-updates-fd-v1', fd: 5 });
  const broker = createCredentialBroker({ owner: { generation: 7, environmentId: 'owned-environment' } });
  note('channels open');
  const credential = await broker.renew();
  note('renewed ' + credential);
  // Only reached with an accepted credential.
  updates.request('status').catch(error => note('update ' + error));
} catch (error) { note('failed ' + (error && error.stack)); process.exit(4); }
"#;

    #[test]
    fn the_workspace_channel_modules_work_over_root_pipes() {
        let node = node();
        let (renewal, updates, lifecycle) = (
            channel(ChildEnd::Duplex).unwrap(),
            channel(ChildEnd::Duplex).unwrap(),
            channel(ChildEnd::Duplex).unwrap(),
        );
        let modules = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("managed-desktop");
        let modules = std::fs::canonicalize(modules).unwrap();
        // Node's file URLs do not take the verbatim prefix canonicalize adds.
        let modules = PathBuf::from(modules.to_string_lossy().trim_start_matches(r"\\?\"));
        let directory = std::env::temp_dir();
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let trace = directory.join(format!(
            "blackcrab-workspace-trace-{}.txt",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        let process = spawn(
            &node,
            &[
                "--input-type=module".into(),
                "-e".into(),
                WORKSPACE.into(),
                trace.clone().into_os_string(),
                modules.into_os_string(),
            ],
            &[("SystemRoot".into(), std::env::var_os("SystemRoot").unwrap())],
            &directory,
            &[(4, &renewal.theirs), (5, &updates.theirs), (6, &lifecycle.theirs)],
        )
        .unwrap();
        drop((renewal.theirs, updates.theirs, lifecycle.theirs));
        let explain = |failure: String| -> String {
            panic!(
                "{failure}; child exit {:?}; child trace:\n{}",
                process.wait(Duration::from_millis(0)),
                std::fs::read_to_string(&trace).unwrap_or_else(|e| format!("<no trace: {e}>"))
            )
        };
        let second = Some(Duration::from_secs(10));

        // FD4: the broker asks for a credential and accepts only a matching reply.
        let request: serde_json::Value =
            serde_json::from_str(&try_line(&renewal.ours).unwrap_or_else(explain)).unwrap();
        assert_eq!(request["kind"], "native-client-credential");
        assert_eq!(request["generation"], 7);
        let expires = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + 60_000;
        let reply = serde_json::json!({"version":1,"kind":"paired-credential","requestId":request["requestId"],
            "generation":7,"environmentId":request["environmentId"],"credential":"23456789ABCD","expiresAt":expires});
        renewal.ours.write_all(format!("{reply}\n").as_bytes(), second).unwrap();

        // FD5: sent only after the credential was accepted.
        let update: serde_json::Value =
            serde_json::from_str(&try_line(&updates.ours).unwrap_or_else(explain)).unwrap();
        assert_eq!(update, serde_json::json!({"action":"status","expectedVersion":null}));

        // FD6: the lifecycle server answers Root's activation request.
        lifecycle
            .ours
            .write_all(b"{\"version\":1,\"id\":1,\"action\":\"activate\"}\n", second)
            .unwrap();
        let visible: serde_json::Value =
            serde_json::from_str(&try_line(&lifecycle.ours).unwrap_or_else(explain)).unwrap();
        assert_eq!(visible, serde_json::json!({"version":1,"id":1,"visible":true}));

        process.terminate().unwrap();
        assert_eq!(process.wait(Duration::from_secs(10)).unwrap(), Some(1));
        let _ = std::fs::remove_file(&trace);
    }

    /// The exact variables Root gives the Windows workspace: the account home
    /// and both temporary variables the environment contract owns, and the few
    /// system variables Windows programs need to start at all.
    fn workspace_environment(profile: &Path) -> Vec<(OsString, OsString)> {
        let system = |name: &str| (OsString::from(name), std::env::var_os(name).unwrap());
        let root = PathBuf::from(std::env::var_os("SystemRoot").unwrap());
        let mut path = root.join("System32").into_os_string();
        path.push(";");
        path.push(&root);
        vec![
            system("SystemRoot"),
            system("SystemDrive"),
            system("USERPROFILE"),
            ("windir".into(), root.into_os_string()),
            ("PATH".into(), path),
            ("TEMP".into(), profile.join("tmp").into_os_string()),
            ("TMP".into(), profile.join("tmp").into_os_string()),
            ("OTEL_SDK_DISABLED".into(), "true".into()),
        ]
    }
    fn listing(root: &Path, depth: usize, found: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(root) else { return };
        for entry in entries.flatten().take(60) {
            let path = entry.path();
            found.push(format!("{}{}", "  ".repeat(3 - depth), entry.file_name().to_string_lossy()));
            if depth > 0 && path.is_dir() {
                listing(&path, depth - 1, found);
            }
        }
    }
    /// What is on screen when the workspace does not start: on Windows an
    /// uncaught error in Electron's main process is a message box.
    fn screenshot(name: &str) {
        let Some(directory) = std::env::var_os("BLACKCRAB_BOOT_EVIDENCE") else { return };
        let file = PathBuf::from(directory).join(name);
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
             $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \
             $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; \
             $g=[System.Drawing.Graphics]::FromImage($i); \
             $g.CopyFromScreen($b.Left,$b.Top,0,0,$i.Size); \
             $i.Save('{}')",
            file.display()
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output();
    }

    #[test]
    #[ignore = "requires an actual built Windows workspace; starts its real Electron main process"]
    fn built_workspace_boots_from_a_root_shaped_launch() {
        use crate::managed_private_windows::{create_private_directory, directory as inspect, Access};
        let package = std::fs::canonicalize(std::env::var("BLACKCRAB_NATIVE_PACKAGE_ROOT").unwrap()).unwrap();
        let plain = |path: PathBuf| PathBuf::from(path.to_string_lossy().trim_start_matches(r"\\?\"));
        let package = plain(package);
        let executable = package.join("Blackcrab.exe");
        assert!(executable.is_file());

        // A fresh private profile at its canonical path, as Root's will be.
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let base = plain(std::fs::canonicalize(std::env::temp_dir()).unwrap()).join(format!(
            "blackcrab-boot-{}",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        create_private_directory(&base).unwrap();
        let profile = base.join("profile");
        create_private_directory(&profile).unwrap();
        assert_eq!(inspect(&profile, Access::Private), Ok(()));

        let (bootstrap, renewal, lifecycle) = (
            channel(ChildEnd::Blocking).unwrap(),
            channel(ChildEnd::Duplex).unwrap(),
            channel(ChildEnd::Duplex).unwrap(),
        );
        let process = spawn(
            &executable,
            &[],
            &workspace_environment(&profile),
            &package,
            &[(3, &bootstrap.theirs), (4, &renewal.theirs), (6, &lifecycle.theirs)],
        )
        .unwrap();
        drop((bootstrap.theirs, renewal.theirs, lifecycle.theirs));

        // The right shape with a made-up credential and an unused port: the
        // workspace cannot attach to any service, only start.
        let expires = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + 3_600_000;
        let descriptor = serde_json::json!({
            "version": 1,
            "owner": {"kind": "blackcrab-managed-host", "generation": 1, "environmentId": "startup-probe",
                "origin": "http://127.0.0.1:9/", "serverVersion": "0.1.7", "orchestrationProtocolVersion": 2},
            "profile": {"root": profile, "namespace": "blackcrab-managed-v1", "appId": "com.blackcrab.desktop.managed"},
            "control": {"kind": "unavailable"},
            "authorization": {"kind": "paired-credential", "credential": "222222222222", "expiresAt": expires,
                "renewal": {"kind": "owner-credential-fd-v1", "fd": 4}},
            "lifecycle": {"kind": "launcher-lifecycle-fd-v1", "fd": 6}
        });
        let second = Some(Duration::from_secs(10));
        bootstrap.ours.write_all(descriptor.to_string().as_bytes(), second).unwrap();
        drop(bootstrap.ours);

        // The environment contract creates these only after it has read the
        // descriptor from 3 and accepted the profile and variables.
        let expected = [
            profile.join("app-data").join("blackcrab-managed-v1"),
            profile.join("tmp"),
            profile.join("logs"),
        ];
        let deadline = std::time::Instant::now() + Duration::from_secs(90);
        let mut exited = None;
        while !expected.iter().all(|path| path.is_dir()) {
            exited = process.wait(Duration::from_millis(500)).unwrap();
            if exited.is_some() || std::time::Instant::now() >= deadline {
                screenshot("workspace-boot-failure.png");
                let mut found = Vec::new();
                listing(&profile, 3, &mut found);
                let _ = process.terminate();
                panic!(
                    "the built workspace did not accept its bootstrap; exit {exited:?}; profile:\n{}",
                    found.join("\n")
                );
            }
        }
        for path in &expected {
            assert_eq!(inspect(path, Access::Private), Ok(()), "{}", path.display());
        }

        // Not required to pass: with nothing to attach to, the workspace may
        // answer "not visible" or give up first. Recorded for the next step.
        let _ = lifecycle
            .ours
            .write_all(b"{\"version\":1,\"id\":1,\"action\":\"activate\"}\n", second);
        let mut buffer = [0u8; 256];
        let reply = match lifecycle.ours.read(&mut buffer, Some(Duration::from_secs(45))) {
            Ok(0) => "channel closed".to_string(),
            Ok(read) => String::from_utf8_lossy(&buffer[..read]).trim().to_string(),
            Err(error) => format!("no reply: {error}"),
        };
        screenshot("workspace-boot.png");
        let mut found = Vec::new();
        listing(&profile, 2, &mut found);
        println!(
            "WORKSPACE_BOOT lifecycle={reply} exit={:?}\n{}",
            process.wait(Duration::from_millis(0)),
            found.join("\n")
        );
        let _ = process.terminate();
        let _ = process.wait(Duration::from_secs(10));
        let _ = exited;
        let _ = std::fs::remove_dir_all(&base);
    }

    // A stand-in for the service launcher: it handles SIGINT as the launcher
    // does, and has a child of its own on the same console, as the launcher
    // has its server.
    const STOPPABLE: &str = r#"
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const directory = process.argv[process.argv.length - 1];
const note = (name, text) => fs.writeFileSync(path.join(directory, name), text);
// A plain word: Node would take a dashed marker for one of its own options.
if (process.argv.includes('as-child')) {
  process.on('SIGINT', () => { note('child-signal', 'SIGINT'); process.exit(0); });
  setInterval(() => {}, 1000);
  note('child-ready', String(process.pid));
} else {
  const child = spawn(process.execPath, ['-e', fs.readFileSync(path.join(directory, 'script.js'), 'utf8'), 'as-child', directory],
    { stdio: 'ignore', env: process.env });
  child.on('exit', (code, signal) => note('child-exit', JSON.stringify({ code, signal })));
  process.on('SIGINT', () => {
    note('parent-signal', 'SIGINT');
    // Orderly work after the signal, as the launcher retires its session.
    setTimeout(() => { note('parent-stopped', 'clean'); process.exit(0); }, 500);
  });
  setInterval(() => {}, 1000);
  note('parent-ready', String(process.pid));
}
"#;

    #[test]
    fn a_hidden_console_child_handles_an_interrupt_as_sigint_and_exits_cleanly() {
        let node = node();
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let directory = std::env::temp_dir().join(format!(
            "blackcrab-interrupt-{}",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("script.js"), STOPPABLE).unwrap();
        let process = spawn_with(
            &node,
            &["-e".into(), STOPPABLE.into(), directory.clone().into_os_string()],
            &[("SystemRoot".into(), std::env::var_os("SystemRoot").unwrap())],
            &directory,
            &[],
            Console::Hidden,
        )
        .unwrap();
        let read = |name: &str| std::fs::read_to_string(directory.join(name)).ok();
        let state = || {
            ["parent-ready", "child-ready", "parent-signal", "parent-stopped", "child-signal", "child-exit"]
                .map(|name| format!("{name}={:?}", read(name)))
                .join(" ")
        };
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        while read("parent-ready").is_none() || read("child-ready").is_none() {
            assert!(std::time::Instant::now() < deadline, "not ready: {}", state());
            assert_eq!(process.wait(Duration::from_millis(100)).unwrap(), None, "{}", state());
        }

        interrupt(&process).unwrap_or_else(|error| panic!("interrupt failed: {error}; {}", state()));
        // The program ran its handler and chose its own exit code; a
        // terminated process would report something else and leave no marker.
        let code = process.wait(Duration::from_secs(30)).unwrap();
        assert_eq!(code, Some(0), "{}", state());
        assert_eq!(read("parent-signal").as_deref(), Some("SIGINT"), "{}", state());
        assert_eq!(read("parent-stopped").as_deref(), Some("clean"), "{}", state());
        // What reached the program's own child on the same console is
        // recorded for the service design, not required.
        std::thread::sleep(Duration::from_secs(2));
        println!("WINDOWS_INTERRUPT {}", state());
        // This process ignored the event and is still running to say so.
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn invalid_descriptor_numbers_and_environment_are_refused_before_spawning() {
        let pipe = channel(ChildEnd::Duplex).unwrap();
        let other = channel(ChildEnd::Duplex).unwrap();
        let here = std::env::temp_dir();
        let program = PathBuf::from(r"C:\nonexistent\never-started.exe");
        for descriptors in [
            vec![(2u32, &pipe.theirs)],
            vec![(MAX_DESCRIPTOR + 1, &pipe.theirs)],
            vec![(3, &pipe.theirs), (3, &other.theirs)],
        ] {
            let error = spawn(&program, &[], &[], &here, &descriptors).err().unwrap();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        }
        for environment in [
            vec![(OsString::from("A=B"), OsString::from("x"))],
            vec![(OsString::from(""), OsString::from("x"))],
            vec![(OsString::from("Path"), OsString::from("x")), (OsString::from("PATH"), OsString::from("y"))],
        ] {
            let error = spawn(&program, &[], &environment, &here, &[]).err().unwrap();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        }
    }
}
