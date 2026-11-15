//! The per-user scheduled task that starts the background service at sign-in.
//!
//! This is the Windows counterpart of the launchd agent and the systemd user
//! unit. The task needs no administrator rights, runs only while the user is
//! signed in, restarts its action on failure, and its registered definition
//! can be read back and compared with what was written.
//!
//! Task names are global to the machine, so the name carries a key unique to
//! the user and owner directory. Only fixed Windows tools are run, by absolute
//! path from the system directory, with a cleared environment, no window and
//! a time limit: `schtasks.exe` to create, run, end and delete, and Windows
//! PowerShell to export the registered definition as UTF-8, since `schtasks`
//! prints in the console code page and would corrupt non-ASCII paths.
#![cfg(windows)]
use crate::managed_private_windows::{account_sid, current_user_sid};
use std::{
    ffi::OsStr,
    io::{self, Read},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const OUTPUT_LIMIT: usize = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Definition {
    /// 32 lowercase hex characters; the same key the supervisor uses.
    pub(crate) key: String,
    pub(crate) command: PathBuf,
    /// The command-line tail exactly as the task will pass it.
    pub(crate) arguments: String,
    pub(crate) directory: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Registration {
    Absent,
    /// Registered and identical to the definition in every checked respect.
    Ours,
    /// A task with this name exists but is not the one this definition
    /// describes. It is never run, replaced or deleted on our behalf.
    Foreign,
}

fn invalid() -> io::Error {
    io::Error::from(io::ErrorKind::InvalidInput)
}

impl Definition {
    pub(crate) fn name(&self) -> io::Result<String> {
        if self.key.len() != 32
            || !self.key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid());
        }
        Ok(format!("Blackcrab Service {}", self.key))
    }
    fn text(&self) -> io::Result<(String, String, String)> {
        let text = |value: &OsStr| value.to_str().map(str::to_owned).ok_or_else(invalid);
        let (command, directory) =
            (text(self.command.as_os_str())?, text(self.directory.as_os_str())?);
        // XML 1.0 cannot carry control characters, and none belongs in a path
        // or an argument here.
        if [&command, &self.arguments, &directory]
            .iter()
            .any(|value| value.chars().any(char::is_control))
            || !self.command.is_absolute()
            || !self.directory.is_absolute()
        {
            return Err(invalid());
        }
        Ok((command, self.arguments.clone(), directory))
    }
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// The settings every Blackcrab service task has, as (element, value, the
/// value Windows assumes when the element is absent). Windows stores a task
/// without the elements that are at their defaults, so an absent element
/// matches only where our value is the default.
const SETTINGS: [(&str, &str, &str); 12] = [
    ("MultipleInstancesPolicy", "IgnoreNew", "IgnoreNew"),
    ("DisallowStartIfOnBatteries", "false", "true"),
    ("StopIfGoingOnBatteries", "false", "true"),
    ("AllowHardTerminate", "true", "true"),
    ("StartWhenAvailable", "false", "false"),
    ("RunOnlyIfNetworkAvailable", "false", "false"),
    ("AllowStartOnDemand", "true", "true"),
    ("Hidden", "false", "false"),
    ("RunOnlyIfIdle", "false", "false"),
    ("WakeToRun", "false", "false"),
    // No limit: the service runs for the whole session.
    ("ExecutionTimeLimit", "PT0S", "PT72H"),
    ("Priority", "7", "7"),
];

/// The task definition for `user` (an `S-1-…` SID).
pub(crate) fn render(definition: &Definition, user: &str) -> io::Result<String> {
    let (command, arguments, directory) = definition.text()?;
    if !user.starts_with("S-1-") || !user.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(invalid());
    }
    let mut settings = String::new();
    for (name, value, _) in SETTINGS {
        settings.push_str(&format!("    <{name}>{value}</{name}>\r\n"));
        if name == "RunOnlyIfNetworkAvailable" {
            settings.push_str("    <IdleSettings>\r\n      <StopOnIdleEnd>false</StopOnIdleEnd>\r\n      <RestartOnIdle>false</RestartOnIdle>\r\n    </IdleSettings>\r\n");
        }
        if name == "AllowStartOnDemand" {
            settings.push_str("    <Enabled>true</Enabled>\r\n");
        }
    }
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n\
<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n\
  <RegistrationInfo>\r\n    <Description>Keeps Blackcrab's background service running while you are signed in.</Description>\r\n  </RegistrationInfo>\r\n\
  <Triggers>\r\n    <LogonTrigger>\r\n      <Enabled>true</Enabled>\r\n      <UserId>{user}</UserId>\r\n    </LogonTrigger>\r\n  </Triggers>\r\n\
  <Principals>\r\n    <Principal id=\"Author\">\r\n      <UserId>{user}</UserId>\r\n      <LogonType>InteractiveToken</LogonType>\r\n      <RunLevel>LeastPrivilege</RunLevel>\r\n    </Principal>\r\n  </Principals>\r\n\
  <Settings>\r\n{settings}    <RestartOnFailure>\r\n      <Interval>PT1M</Interval>\r\n      <Count>999</Count>\r\n    </RestartOnFailure>\r\n  </Settings>\r\n\
  <Actions Context=\"Author\">\r\n    <Exec>\r\n      <Command>{}</Command>\r\n      <Arguments>{}</Arguments>\r\n      <WorkingDirectory>{}</WorkingDirectory>\r\n    </Exec>\r\n  </Actions>\r\n\
</Task>\r\n",
        escape(&command),
        escape(&arguments),
        escape(&directory),
    ))
}

/// Every text value of `<name>…</name>` in `xml`, in order.
fn elements(xml: &str, name: &str) -> Vec<String> {
    let (open, close) = (format!("<{name}>"), format!("</{name}>"));
    let mut found = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        let Some(end) = after.find(&close) else { break };
        found.push(unescape(after[..end].trim()));
        rest = &after[end + close.len()..];
    }
    found
}
fn count(xml: &str, tag: &str) -> usize {
    xml.matches(&format!("<{tag}>")).count() + xml.matches(&format!("<{tag} ")).count()
}

/// The single `<name …>…</name>` section of `xml`, if there is exactly one.
fn section<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    if count(xml, name) != 1 {
        return None;
    }
    let close = format!("</{name}>");
    let start = xml.find(&format!("<{name}>")).or_else(|| xml.find(&format!("<{name} ")))?;
    let body = &xml[start..];
    let body = &body[body.find('>')? + 1..];
    Some(&body[..body.find(&close)?])
}

/// Whether an exported task is exactly the one `definition` describes for
/// `user`: one sign-in trigger for that user, one program action with our
/// command, arguments and directory, run as that user without elevation, and
/// every setting as written. Anything extra or different is not ours.
///
/// Windows rewrites a definition when it stores it: elements at their default
/// are dropped, sections are reordered, and the trigger's user is recorded by
/// account name. `resolve` turns such a name into a SID.
pub(crate) fn matches_with(
    exported: &str,
    definition: &Definition,
    user: &str,
    resolve: impl Fn(&str) -> Option<String>,
) -> bool {
    let Ok((command, arguments, directory)) = definition.text() else {
        return false;
    };
    let (Some(triggers), Some(principals), Some(settings), Some(actions)) = (
        section(exported, "Triggers"),
        section(exported, "Principals"),
        section(exported, "Settings"),
        section(exported, "Actions"),
    ) else {
        return false;
    };
    let one = |xml: &str, name: &str, value: &str| elements(xml, name) == [value.to_string()];
    // Present with our value, or absent where our value is the default.
    let set = |xml: &str, name: &str, value: &str, default: &str| {
        let found = elements(xml, name);
        found == [value.to_string()] || (found.is_empty() && value == default)
    };
    let none = |xml: &str, names: &[&str]| {
        names.iter().all(|name| count(xml, name) == 0)
    };
    let trigger_user = match elements(triggers, "UserId").as_slice() {
        [name] => name == user || resolve(name).as_deref() == Some(user),
        _ => false,
    };
    count(triggers, "LogonTrigger") == 1
        && none(
            triggers,
            &[
                "BootTrigger",
                "RegistrationTrigger",
                "IdleTrigger",
                "TimeTrigger",
                "EventTrigger",
                "CalendarTrigger",
                "SessionStateChangeTrigger",
                "WnfStateChangeTrigger",
                "Delay",
                "Repetition",
                "StartBoundary",
                "EndBoundary",
                "ExecutionTimeLimit",
            ],
        )
        && trigger_user
        && set(triggers, "Enabled", "true", "true")
        && count(principals, "Principal") == 1
        && none(principals, &["GroupId"])
        && one(principals, "UserId", user)
        && one(principals, "LogonType", "InteractiveToken")
        && set(principals, "RunLevel", "LeastPrivilege", "LeastPrivilege")
        && count(actions, "Exec") == 1
        && none(actions, &["ComHandler", "SendEmail", "ShowMessage"])
        && one(actions, "Command", &command)
        && set(actions, "Arguments", &arguments, "")
        && one(actions, "WorkingDirectory", &directory)
        && set(settings, "Enabled", "true", "true")
        && SETTINGS.iter().all(|(name, value, default)| set(settings, name, value, default))
        && one(settings, "Interval", "PT1M")
        && one(settings, "Count", "999")
        && none(settings, &["DeleteExpiredTaskAfter", "NetworkSettings"])
}

pub(crate) fn matches(exported: &str, definition: &Definition, user: &str) -> bool {
    matches_with(exported, definition, user, |name| account_sid(name).ok())
}

fn system_directory() -> io::Result<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buffer = vec![0u16; 512];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(io::Error::last_os_error());
    }
    Ok(PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length])))
}

struct Finished {
    code: Option<i32>,
    output: Vec<u8>,
}
/// Runs one fixed tool to completion with nothing inherited from this
/// process's environment but the system root, bounded in time and output.
fn tool(program: &Path, arguments: &[&OsStr], timeout: Duration) -> io::Result<Finished> {
    let system = system_directory()?;
    let root = system.parent().ok_or_else(invalid)?.to_path_buf();
    let mut child = Command::new(program)
        .args(arguments)
        .env_clear()
        .env("SystemRoot", &root)
        .env("windir", &root)
        .current_dir(&system)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    let mut stdout = child.stdout.take().ok_or_else(invalid)?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = (&mut stdout).take(OUTPUT_LIMIT as u64 + 1).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::from(io::ErrorKind::TimedOut));
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let output = reader.join().map_err(|_| io::Error::other("tool output unavailable"))?;
    if output.len() > OUTPUT_LIMIT {
        return Err(io::Error::other("tool output exceeds bound"));
    }
    Ok(Finished { code: status.code(), output })
}
fn schtasks(arguments: &[&OsStr]) -> io::Result<Finished> {
    tool(&system_directory()?.join("schtasks.exe"), arguments, Duration::from_secs(60))
}

fn exists(name: &str) -> io::Result<bool> {
    Ok(schtasks(&["/Query".as_ref(), "/TN".as_ref(), name.as_ref()])?.code == Some(0))
}

/// The registered definition as UTF-8 XML.
fn export(name: &str) -> io::Result<String> {
    // The name is fixed text plus hex; it still goes in as a quoted literal.
    let script = format!(
        "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding $false; \
         [Console]::Out.Write((Export-ScheduledTask -TaskName '{}' -TaskPath '\\'))",
        name.replace('\'', "''")
    );
    let powershell = system_directory()?
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let finished = tool(
        &powershell,
        &[
            "-NoProfile".as_ref(),
            "-NonInteractive".as_ref(),
            "-ExecutionPolicy".as_ref(),
            "Bypass".as_ref(),
            "-Command".as_ref(),
            script.as_ref(),
        ],
        Duration::from_secs(120),
    )?;
    if finished.code != Some(0) {
        return Err(io::Error::other("registered task could not be exported"));
    }
    String::from_utf8(finished.output).map_err(|_| io::Error::from(io::ErrorKind::InvalidData))
}

pub(crate) fn registration(definition: &Definition) -> io::Result<Registration> {
    let name = definition.name()?;
    if !exists(&name)? {
        return Ok(Registration::Absent);
    }
    Ok(if matches(&export(&name)?, definition, &current_user_sid()?) {
        Registration::Ours
    } else {
        Registration::Foreign
    })
}

/// Registers the task. `scratch` is an existing private directory for the
/// definition file, which is removed again. An existing task of the same name
/// is never replaced; a foreign one is an error and ours is left as it is.
pub(crate) fn register(definition: &Definition, scratch: &Path) -> io::Result<()> {
    let name = definition.name()?;
    match registration(definition)? {
        Registration::Ours => return Ok(()),
        Registration::Foreign => return Err(io::Error::from(io::ErrorKind::AlreadyExists)),
        Registration::Absent => {}
    }
    let xml = render(definition, &current_user_sid()?)?;
    let mut nonce = [0u8; 16];
    getrandom::getrandom(&mut nonce).map_err(|_| io::Error::other("random unavailable"))?;
    let file = scratch.join(format!(
        ".service-task-{}.xml",
        nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ));
    // UTF-16LE with a byte-order mark, as the declaration says.
    let mut bytes = vec![0xFF, 0xFE];
    bytes.extend(xml.encode_utf16().flat_map(u16::to_le_bytes));
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .and_then(|mut handle| std::io::Write::write_all(&mut handle, &bytes))?;
    let created = schtasks(&[
        "/Create".as_ref(),
        "/TN".as_ref(),
        name.as_ref(),
        "/XML".as_ref(),
        file.as_os_str(),
    ]);
    let _ = std::fs::remove_file(&file);
    if created?.code != Some(0) {
        return Err(io::Error::other("scheduled task was not created"));
    }
    // What Windows now holds must be what was asked for.
    match registration(definition)? {
        Registration::Ours => Ok(()),
        _ => Err(io::Error::other("registered task differs from its definition")),
    }
}

fn ours(definition: &Definition) -> io::Result<String> {
    match registration(definition)? {
        Registration::Ours => definition.name(),
        Registration::Absent => Err(io::Error::from(io::ErrorKind::NotFound)),
        Registration::Foreign => Err(io::Error::from(io::ErrorKind::PermissionDenied)),
    }
}

/// Starts the task now. Only a task verified as ours is started.
pub(crate) fn run(definition: &Definition) -> io::Result<()> {
    let name = ours(definition)?;
    if schtasks(&["/Run".as_ref(), "/TN".as_ref(), name.as_ref()])?.code != Some(0) {
        return Err(io::Error::other("scheduled task did not start"));
    }
    Ok(())
}

/// Ends the task's running action outright. The service's clean stop goes
/// through its supervisor; this is the fallback.
pub(crate) fn end(definition: &Definition) -> io::Result<()> {
    let name = ours(definition)?;
    if schtasks(&["/End".as_ref(), "/TN".as_ref(), name.as_ref()])?.code != Some(0) {
        return Err(io::Error::other("scheduled task did not end"));
    }
    Ok(())
}

/// Removes the registration. A foreign task of the same name is left alone;
/// an absent one is success.
pub(crate) fn unregister(definition: &Definition) -> io::Result<()> {
    let name = match registration(definition)? {
        Registration::Absent => return Ok(()),
        Registration::Foreign => return Err(io::Error::from(io::ErrorKind::PermissionDenied)),
        Registration::Ours => definition.name()?,
    };
    if schtasks(&["/Delete".as_ref(), "/TN".as_ref(), name.as_ref(), "/F".as_ref()])?.code
        != Some(0)
    {
        return Err(io::Error::other("scheduled task was not deleted"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const USER: &str = "S-1-5-21-1111111111-2222222222-3333333333-1001";
    fn definition() -> Definition {
        Definition {
            key: "0123456789abcdef0123456789abcdef".into(),
            command: PathBuf::from(r"C:\Users\A & B\AppData\Local\Blackcrab\issuer\blackcrab-issuer.exe"),
            arguments: r#"__blackcrab-service-run-v1 "quoted <value>""#.into(),
            directory: PathBuf::from(r"C:\Users\A & B\AppData\Local\Blackcrab"),
        }
    }

    fn same(xml: &str, definition: &Definition, user: &str) -> bool {
        // "HOST\\user" is how Windows records the trigger's account.
        matches_with(xml, definition, user, |name| (name == r"HOST\user").then(|| USER.to_string()))
    }

    #[test]
    fn a_rendered_definition_matches_itself_and_nothing_altered() {
        let definition = definition();
        let xml = render(&definition, USER).unwrap();
        assert!(xml.contains("<Command>C:\\Users\\A &amp; B\\AppData"));
        assert!(xml.contains("&quot;quoted &lt;value&gt;&quot;"));
        assert!(same(&xml, &definition, USER));
        // What Windows adds on registration does not make it foreign.
        let registered = xml.replace(
            "<RegistrationInfo>",
            "<RegistrationInfo>\r\n    <Date>2026-11-14T10:00:00</Date>\r\n    <Author>HOST\\user</Author>\r\n    <URI>\\Blackcrab Service 0123456789abcdef0123456789abcdef</URI>",
        );
        assert!(same(&registered, &definition, USER));

        let other_user = "S-1-5-21-1111111111-2222222222-3333333333-1002";
        assert!(!same(&xml, &definition, other_user));
        for (from, to) in [
            ("blackcrab-issuer.exe</Command>", "other.exe</Command>"),
            ("__blackcrab-service-run-v1", "__blackcrab-service-run-v1 --extra"),
            ("<RunLevel>LeastPrivilege</RunLevel>", "<RunLevel>HighestAvailable</RunLevel>"),
            ("<LogonType>InteractiveToken</LogonType>", "<LogonType>S4U</LogonType>"),
            ("<Hidden>false</Hidden>", "<Hidden>true</Hidden>"),
            ("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>", "<ExecutionTimeLimit>PT1H</ExecutionTimeLimit>"),
            // Absent means the 72-hour default, not ours.
            ("    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n", ""),
            ("    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n", ""),
            ("<Count>999</Count>", "<Count>1</Count>"),
            ("</LogonTrigger>", "</LogonTrigger>\r\n    <BootTrigger><Enabled>true</Enabled></BootTrigger>"),
            ("</LogonTrigger>", "</LogonTrigger>\r\n    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>"),
            ("</Exec>", "</Exec>\r\n    <Exec><Command>C:\\other.exe</Command></Exec>"),
            ("</Exec>", "</Exec>\r\n    <ComHandler><ClassId>{00000000-0000-0000-0000-000000000000}</ClassId></ComHandler>"),
            ("<Enabled>true</Enabled>\r\n      <UserId>", "<Enabled>true</Enabled>\r\n      <Delay>PT5M</Delay>\r\n      <UserId>"),
            ("    <Enabled>true</Enabled>\r\n    <Hidden>", "    <Enabled>false</Enabled>\r\n    <Hidden>"),
            ("<Enabled>true</Enabled>\r\n      <UserId>", "<Enabled>false</Enabled>\r\n      <UserId>"),
            ("</Principal>", "</Principal>\r\n    <Principal id=\"Other\"><UserId>S-1-5-18</UserId></Principal>"),
        ] {
            assert!(xml.contains(from), "{from}");
            assert!(!same(&xml.replacen(from, to, 1), &definition, USER), "{to}");
        }
    }

    #[test]
    fn the_form_windows_stores_matches_and_its_alterations_do_not() {
        // As exported by Windows Server 2022 after registering our definition:
        // defaults dropped, sections reordered, the trigger's user by name.
        let definition = definition();
        let stored = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n\
  <RegistrationInfo>\r\n    <Description>d</Description>\r\n    <URI>\\Blackcrab Service 0123456789abcdef0123456789abcdef</URI>\r\n  </RegistrationInfo>\r\n\
  <Principals>\r\n    <Principal id=\"Author\">\r\n      <UserId>{USER}</UserId>\r\n      <LogonType>InteractiveToken</LogonType>\r\n    </Principal>\r\n  </Principals>\r\n\
  <Settings>\r\n    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n\
    <RestartOnFailure>\r\n      <Count>999</Count>\r\n      <Interval>PT1M</Interval>\r\n    </RestartOnFailure>\r\n\
    <IdleSettings>\r\n      <StopOnIdleEnd>false</StopOnIdleEnd>\r\n      <RestartOnIdle>false</RestartOnIdle>\r\n    </IdleSettings>\r\n  </Settings>\r\n\
  <Triggers>\r\n    <LogonTrigger>\r\n      <UserId>HOST\\user</UserId>\r\n    </LogonTrigger>\r\n  </Triggers>\r\n\
  <Actions Context=\"Author\">\r\n    <Exec>\r\n      <Command>{}</Command>\r\n      <Arguments>{}</Arguments>\r\n      <WorkingDirectory>{}</WorkingDirectory>\r\n    </Exec>\r\n  </Actions>\r\n</Task>\r\n",
            escape(&definition.command.to_string_lossy()),
            // Windows leaves quotes unescaped in element text.
            escape(&definition.arguments).replace("&quot;", "\""),
            escape(&definition.directory.to_string_lossy()),
        );
        assert!(same(&stored, &definition, USER));
        for (from, to) in [
            ("<UserId>HOST\\user</UserId>", "<UserId>HOST\\other</UserId>"),
            ("<LogonType>InteractiveToken</LogonType>", "<LogonType>InteractiveToken</LogonType>\r\n      <RunLevel>HighestAvailable</RunLevel>"),
            ("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>", "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n    <Enabled>false</Enabled>"),
            ("    <LogonTrigger>\r\n", "    <LogonTrigger>\r\n      <Enabled>false</Enabled>\r\n"),
            ("<Count>999</Count>", "<Count>3</Count>"),
            ("<IdleSettings>", "<Hidden>true</Hidden>\r\n    <IdleSettings>"),
        ] {
            assert!(stored.contains(from), "{from}");
            assert!(!same(&stored.replacen(from, to, 1), &definition, USER), "{to}");
        }
    }

    #[test]
    fn unusable_definitions_and_users_are_refused() {
        let good = definition();
        for bad in [
            Definition { key: "short".into(), ..good.clone() },
            Definition { key: "0123456789ABCDEF0123456789abcdef".into(), ..good.clone() },
        ] {
            assert!(bad.name().is_err());
        }
        for bad in [
            Definition { command: PathBuf::from("relative.exe"), ..good.clone() },
            Definition { directory: PathBuf::from("relative"), ..good.clone() },
            Definition { arguments: "line\nbreak".into(), ..good.clone() },
        ] {
            assert!(render(&bad, USER).is_err());
        }
        assert!(render(&good, "Everyone").is_err());
        assert!(render(&good, "S-1-5-21-1</UserId>").is_err());
    }

    /// The real Task Scheduler, with `node.exe` standing in for the helper.
    #[test]
    fn the_real_scheduler_registers_verifies_runs_and_removes_our_task() {
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).unwrap();
        let key: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
        let temp = std::env::temp_dir().canonicalize().unwrap();
        let temp = PathBuf::from(temp.to_string_lossy().trim_start_matches(r"\\?\"));
        let directory = temp.join(format!("blackcrab task {key}"));
        std::fs::create_dir(&directory).unwrap();
        let script = directory.join("service & task.js");
        std::fs::write(
            &script,
            "const fs=require('fs'),path=require('path');\
             fs.writeFileSync(path.join(process.argv[2],'ran'),JSON.stringify({cwd:process.cwd(),argument:process.argv[3]}));\
             setInterval(()=>{},1000);",
        )
        .unwrap();
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|directory| directory.join("node.exe"))
            .find(|candidate| candidate.is_file())
            .expect("node.exe is required for this test");
        let definition = Definition {
            key,
            command: node,
            arguments: format!(
                "\"{}\" \"{}\" \"an argument with <angle> & ampersand\"",
                script.display(),
                directory.display()
            ),
            directory: directory.clone(),
        };
        struct Cleanup<'a>(&'a Definition, &'a Path);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                if let Ok(name) = self.0.name() {
                    let _ = schtasks(&["/End".as_ref(), "/TN".as_ref(), name.as_ref()]);
                    let _ = schtasks(&["/Delete".as_ref(), "/TN".as_ref(), name.as_ref(), "/F".as_ref()]);
                }
                let _ = std::fs::remove_dir_all(self.1);
            }
        }
        let _cleanup = Cleanup(&definition, &directory);

        assert_eq!(registration(&definition).unwrap(), Registration::Absent);
        assert_eq!(run(&definition).unwrap_err().kind(), io::ErrorKind::NotFound);
        unregister(&definition).unwrap();

        if let Err(error) = register(&definition, &directory) {
            // Show what Windows stored, to see which element differs.
            panic!(
                "register failed: {error}\nwritten:\n{}\nregistered:\n{}",
                render(&definition, &current_user_sid().unwrap()).unwrap(),
                export(&definition.name().unwrap()).unwrap_or_else(|e| format!("<no export: {e}>"))
            );
        }
        assert_eq!(registration(&definition).unwrap(), Registration::Ours);
        // The definition file did not outlive registration.
        assert!(!std::fs::read_dir(&directory)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with(".service-task-")));
        // Registering again changes nothing.
        register(&definition, &directory).unwrap();

        // The same name with any other content is foreign and untouchable.
        let altered = Definition { arguments: format!("{} --altered", definition.arguments), ..definition.clone() };
        assert_eq!(registration(&altered).unwrap(), Registration::Foreign);
        assert_eq!(register(&altered, &directory).unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(run(&altered).unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(unregister(&altered).unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(registration(&definition).unwrap(), Registration::Ours);

        run(&definition).unwrap();
        let deadline = Instant::now() + Duration::from_secs(60);
        let ran = loop {
            if let Ok(text) = std::fs::read_to_string(directory.join("ran")) {
                break text;
            }
            assert!(Instant::now() < deadline, "the task's action never ran");
            std::thread::sleep(Duration::from_millis(100));
        };
        let ran: serde_json::Value = serde_json::from_str(&ran).unwrap();
        assert_eq!(ran["argument"], "an argument with <angle> & ampersand");
        assert!(ran["cwd"].as_str().unwrap().eq_ignore_ascii_case(&directory.to_string_lossy()), "{ran}");

        end(&definition).unwrap();
        unregister(&definition).unwrap();
        assert_eq!(registration(&definition).unwrap(), Registration::Absent);
    }
}
