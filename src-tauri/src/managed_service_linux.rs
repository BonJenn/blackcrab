//! Per-user systemd lifecycle for the existing native service owner.
//! No system service, shell, discovered PID, renderer path or second host.
use super::*;
use std::collections::BTreeMap;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt};
#[path = "managed_service_manager_io.rs"]
mod manager_io;
use super::ServiceAction as Action;

const UNIT: &str = "blackcrab.service";
const OBJECT: &str = "/org/freedesktop/systemd1/unit/blackcrab_2eservice";
const LIMIT: usize = 64 * 1024;
fn invalid() -> String {
    "The Linux background service is unavailable or belongs to a different owner".into()
}
fn text(path: &Path) -> Result<&str, String> {
    path.to_str()
        .filter(|s| !s.chars().any(char::is_control))
        .ok_or_else(invalid)
}

// systemd expands % specifiers in these fields. Quote complete words, never
// construct a shell command. The first ExecStart word is a literal executable
// path (not environment-expanded); subsequent arguments are fixed literals.
fn quote(value: &str, executable: bool) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err(invalid());
    }
    let value = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('%', "%%");
    Ok(format!(
        "\"{}\"",
        if executable {
            value.replace('$', "$$")
        } else {
            value
        }
    ))
}
// WorkingDirectory and StandardOutput paths are not word-unquoted by systemd.
// Quotes would become literal filename characters. Newlines/continuations and
// trimming-sensitive trailing characters are refused instead of misparsed.
fn path_setting(path: &Path) -> Result<String, String> {
    let value = text(path)?;
    if !path.is_absolute() || value.ends_with('\\') || value.trim_end() != value {
        return Err(invalid());
    }
    Ok(value.replace('%', "%%"))
}

struct ServiceUnitPlan {
    root: PathBuf,
    configuration: Configuration,
    generation: u64,
    home: PathBuf,
    runtime: PathBuf,
    unit_path: PathBuf,
    environment: BTreeMap<String, String>,
    program: Vec<String>,
}
#[derive(Debug, PartialEq, Eq)]
struct Registration {
    installed: bool,
    loaded: bool,
}

async fn control_lease(root: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root.join("service-control.lock"))
        .map_err(|_| invalid())?;
    let m = file.metadata().map_err(|_| invalid())?;
    if !m.is_file()
        || m.uid() != unsafe { libc::geteuid() }
        || m.nlink() != 1
        || m.mode() & 0o777 != 0o600
        || m.len() != 0
    {
        return Err(invalid());
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(150);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await
            }
            Err(_) => {
                return Err(
                    "Another background-service operation is active; refresh after it completes"
                        .into(),
                )
            }
        }
    }
}

impl ServiceUnitPlan {
    async fn from_host(host: &ManagedHost) -> Result<Self, String> {
        let _operation = host.operation.lock().await;
        host.prepare()?;
        let _lease = host.lease().await?;
        host.initialize_locked()?;
        let configuration = host.read_config()?.ok_or_else(invalid)?;
        if configuration.ownership != OwnershipMode::Service {
            return Err(invalid());
        }
        let generation = service_issuer::control_generation(host, &configuration)?;
        let home = crate::managed_desktop::native_account_home()?;
        let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
            .into_iter()
            .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
            .filter(|p| p.is_absolute() && text(p).is_ok())
            .collect();
        for path in [
            configuration.artifact_path.clone(),
            home.join(".local/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ] {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
        let path = std::env::join_paths(paths)
            .map_err(|_| invalid())?
            .into_string()
            .map_err(|_| invalid())?;
        Self::build(
            &host.root,
            configuration,
            generation,
            home,
            unsafe { libc::geteuid() },
            path,
        )
    }
    fn build(
        root: &Path,
        configuration: Configuration,
        generation: u64,
        home: PathBuf,
        uid: u32,
        path: String,
    ) -> Result<Self, String> {
        if !root.is_absolute()
            || !home.is_absolute()
            || !configuration.artifact_path.is_absolute()
            || path.is_empty()
        {
            return Err(invalid());
        }
        let owner = json!({"schema":1,"root":text(root)?,"manifestSha256":configuration.manifest_digest,
            "generation":generation,"environmentId":configuration.environment_id.as_ref().ok_or_else(invalid)?});
        let program = vec![
            text(&configuration.artifact_path.join("t3"))?.into(),
            "__service-launcher".into(),
        ];
        let environment = BTreeMap::from([
            ("PATH".into(), path),
            ("HOME".into(), text(&home)?.into()),
            ("T3CODE_HOME".into(), text(&root.join("host"))?.into()),
            (
                "XDG_CONFIG_HOME".into(),
                text(&home.join(".config"))?.into(),
            ),
            ("XDG_RUNTIME_DIR".into(), format!("/run/user/{uid}")),
            (
                "DBUS_SESSION_BUS_ADDRESS".into(),
                format!("unix:path=/run/user/{uid}/bus"),
            ),
            ("T3_BOOT_SERVICE_UNIT".into(), UNIT.into()),
            ("BLACKCRAB_NATIVE_SERVICE_OWNER".into(), owner.to_string()),
        ]);
        let plan = Self {
            root: root.into(),
            configuration,
            generation,
            unit_path: home.join(".config/systemd/user").join(UNIT),
            home,
            runtime: PathBuf::from(format!("/run/user/{uid}")),
            environment,
            program,
        };
        plan.render_with_path(&plan.environment["PATH"])?;
        Ok(plan)
    }
    fn render_with_path(&self, path: &str) -> Result<Vec<u8>, String> {
        if path.is_empty() {
            return Err(invalid());
        }
        let mut lines = vec![
            "# Blackcrab native user service v1".into(),
            format!(
                "# Installed PATH: {}",
                serde_json::to_string(path).map_err(|_| invalid())?
            ),
            "[Unit]".into(),
            "Description=Blackcrab background service".into(),
            "StartLimitIntervalSec=300".into(),
            "StartLimitBurst=5".into(),
            "".into(),
            "[Service]".into(),
            "Type=simple".into(),
            format!("WorkingDirectory={}", path_setting(&self.home)?),
            "UMask=0077".into(),
        ];
        for (key, value) in &self.environment {
            let value = if key == "PATH" { path } else { value.as_str() };
            // Keep KEY= outside the quotes: original host service discovery
            // recognizes Environment=T3CODE_HOME= and unquotes its value.
            lines.push(format!("Environment={key}={}", quote(value, false)?));
        }
        lines.push(format!(
            "ExecStart={} {}",
            quote(&self.program[0], false)?,
            quote(&self.program[1], true)?
        ));
        lines.extend(
            [
                "KillMode=mixed",
                "OOMPolicy=continue",
                "Restart=always",
                "RestartSec=5",
                "TimeoutStopSec=90",
            ]
            .map(str::to_owned),
        );
        let log = path_setting(&self.root.join("logs/boot-service.log"))?;
        lines.extend([
            format!("StandardOutput=append:{log}"),
            format!("StandardError=append:{log}"),
            String::new(),
            "[Install]".into(),
            "WantedBy=default.target".into(),
            String::new(),
        ]);
        let bytes = lines.join("\n").into_bytes();
        if bytes.len() > LIMIT {
            return Err(invalid());
        }
        Ok(bytes)
    }
    fn installed_path(&self, bytes: &[u8]) -> Result<String, String> {
        if bytes.len() > LIMIT {
            return Err(invalid());
        }
        let source = std::str::from_utf8(bytes).map_err(|_| invalid())?;
        let line = source
            .lines()
            .nth(1)
            .and_then(|l| l.strip_prefix("# Installed PATH: "))
            .ok_or_else(invalid)?;
        let path: String = serde_json::from_str(line).map_err(|_| invalid())?;
        if self.render_with_path(&path)? != bytes {
            return Err(invalid());
        }
        Ok(path)
    }
    fn directories(&self) -> [PathBuf; 3] {
        [
            self.home.join(".config"),
            self.home.join(".config/systemd"),
            self.home.join(".config/systemd/user"),
        ]
    }
    fn check_directory(path: &Path) -> Result<(), String> {
        let m = fs::symlink_metadata(path).map_err(|_| invalid())?;
        if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o022 != 0 {
            return Err(invalid());
        }
        Ok(())
    }
    fn directory_ready(&self) -> Result<bool, String> {
        Self::check_directory(&self.home)?;
        for dir in self.directories() {
            match fs::symlink_metadata(&dir) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                _ => Self::check_directory(&dir)?,
            }
        }
        Ok(true)
    }
    fn read_owned_unit(&self) -> Result<Option<Vec<u8>>, String> {
        if !self.directory_ready()? {
            return Ok(None);
        }
        let mut file = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&self.unit_path)
        {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(invalid()),
        };
        let m = file.metadata().map_err(|_| invalid())?;
        if !m.is_file()
            || m.uid() != unsafe { libc::geteuid() }
            || m.nlink() != 1
            || m.mode() & 0o777 != 0o600
            || m.len() > LIMIT as u64
        {
            return Err(invalid());
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid())?;
        self.installed_path(&bytes)?;
        Ok(Some(bytes))
    }
    fn wanted_path(&self) -> PathBuf {
        self.unit_path
            .parent()
            .unwrap()
            .join("default.target.wants")
            .join(UNIT)
    }
    fn wanted(&self) -> Result<bool, String> {
        if !self.directory_ready()? {
            return Ok(false);
        }
        let path = self.wanted_path();
        match fs::symlink_metadata(path.parent().unwrap()) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            _ => Self::check_directory(path.parent().unwrap())?,
        }
        let m = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(invalid()),
        };
        if !m.file_type().is_symlink()
            || m.uid() != unsafe { libc::geteuid() }
            || fs::read_link(&path).map_err(|_| invalid())? != self.unit_path
        {
            return Err(invalid());
        }
        Ok(true)
    }
    fn publish_unit(&self) -> Result<(), String> {
        if self.read_owned_unit()?.is_some() {
            return Ok(());
        }
        for dir in self.directories() {
            match fs::DirBuilder::new().mode(0o700).create(&dir) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(invalid()),
            }
            Self::check_directory(&dir)?;
        }
        let temp = self
            .unit_path
            .with_file_name(format!(".blackcrab-service-{}", random_secret()?));
        write_new(&temp, &self.render_with_path(&self.environment["PATH"])?)?;
        let result = crate::managed_payload::publish_no_replace(&temp, &self.unit_path);
        if fs::symlink_metadata(&temp).is_ok() {
            let _ = fs::remove_file(&temp);
        }
        result?;
        self.sync_directory()
    }
    fn sync_directory(&self) -> Result<(), String> {
        File::open(self.unit_path.parent().ok_or_else(invalid)?)
            .and_then(|f| f.sync_all())
            .map_err(io_error)
    }
    fn enable_owned(&self) -> Result<(), String> {
        if self.read_owned_unit()?.is_none() {
            return Err(invalid());
        }
        if self.wanted()? {
            return Ok(());
        }
        let path = self.wanted_path();
        match fs::DirBuilder::new()
            .mode(0o700)
            .create(path.parent().unwrap())
        {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(invalid()),
        }
        Self::check_directory(path.parent().unwrap())?;
        std::os::unix::fs::symlink(&self.unit_path, &path).map_err(|_| invalid())?;
        File::open(path.parent().unwrap())
            .and_then(|f| f.sync_all())
            .map_err(io_error)
    }
    fn verify_bus(&self) -> Result<(), String> {
        // The standard logind user bus only. Never use an inherited address or
        // start a manager/linger session as a side effect of a status request.
        if self.runtime != PathBuf::from(format!("/run/user/{}", unsafe { libc::geteuid() })) {
            return Err(invalid());
        }
        for dir in [Path::new("/run"), Path::new("/run/user")] {
            let m = fs::symlink_metadata(dir).map_err(|_| invalid())?;
            if !m.is_dir() || m.uid() != 0 || m.mode() & 0o022 != 0 {
                return Err(invalid());
            }
        }
        let m = fs::symlink_metadata(&self.runtime).map_err(|_| {
            "Sign in to a Linux desktop session with a systemd user manager first".to_owned()
        })?;
        if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o777 != 0o700 {
            return Err(invalid());
        }
        let m = fs::symlink_metadata(self.runtime.join("bus"))
            .map_err(|_| "The systemd user session bus is unavailable".to_owned())?;
        if !m.file_type().is_socket() || m.uid() != unsafe { libc::geteuid() } {
            return Err(invalid());
        }
        Ok(())
    }
    async fn manager(
        &self,
        bus: bool,
        args: &[String],
        timeout: Duration,
    ) -> Result<manager_io::Output, String> {
        self.verify_bus()?;
        manager_io::linux_manager(bus, args, &self.home, &self.runtime, timeout).await
    }
    async fn command(&self, verb: &str, unit: bool, timeout: Duration) -> Result<(), String> {
        if unit && self.read_owned_unit()?.is_none() {
            return Err(invalid());
        }
        let mut args = vec![
            "--user".into(),
            "--no-pager".into(),
            "--no-ask-password".into(),
            verb.into(),
        ];
        if unit {
            args.push(UNIT.into());
        }
        let output = self.manager(false, &args, timeout).await?;
        if !output.status.success() {
            return Err(
                "The systemd user manager did not complete the background-service operation".into(),
            );
        }
        Ok(())
    }
    async fn properties(&self, interface: &str) -> Result<Value, String> {
        let args = [
            "--user",
            "--no-pager",
            "--json=short",
            "call",
            "org.freedesktop.systemd1",
            OBJECT,
            "org.freedesktop.DBus.Properties",
            "GetAll",
            "s",
            interface,
        ]
        .map(str::to_owned);
        let output = self.manager(true, &args, Duration::from_secs(5)).await?;
        if !output.status.success() {
            return Err("The systemd service configuration could not be verified".into());
        }
        let response: Value = serde_json::from_slice(&output.stdout).map_err(|_| invalid())?;
        if response["type"] != "a{sv}"
            || response["data"].as_array().map(Vec::len) != Some(1)
            || !response["data"][0].is_object()
        {
            return Err(invalid());
        }
        Ok(response["data"][0].clone())
    }
    fn verified_properties(
        &self,
        unit: &Value,
        service: Option<&Value>,
        bytes: Option<&[u8]>,
    ) -> Result<Registration, String> {
        let property = |name: &str| -> Result<&Value, String> {
            unit.get(name)
                .and_then(|v| v.get("data"))
                .ok_or_else(invalid)
        };
        let active = property("ActiveState")?.as_str().ok_or_else(invalid)?;
        let loaded = match active {
            "active" | "activating" | "reloading" | "deactivating" => true,
            "inactive" | "failed" => false,
            _ => return Err(invalid()),
        };
        if property("Job")?.get(0).and_then(Value::as_u64) != Some(0) {
            return Err(
                "A systemd background-service operation is pending; refresh after it completes"
                    .into(),
            );
        }
        let load = property("LoadState")?.as_str().ok_or_else(invalid)?;
        if load == "not-found"
            && !loaded
            && property("FragmentPath")? == ""
            && property("DropInPaths")? == &json!([])
        {
            return Ok(Registration {
                installed: bytes.is_some(),
                loaded: false,
            });
        }
        let bytes = bytes.ok_or_else(invalid)?;
        if load != "loaded"
            || property("FragmentPath")? != text(&self.unit_path)?
            || property("DropInPaths")? != &json!([])
            || property("SourcePath")? != ""
            || property("Transient")? != false
            || property("NeedDaemonReload")? != false
        {
            return Err(invalid());
        }
        let service = service.ok_or_else(invalid)?;
        let get = |name: &str| -> Result<&Value, String> {
            service
                .get(name)
                .and_then(|v| v.get("data"))
                .ok_or_else(invalid)
        };
        let mut environment = self.environment.clone();
        environment.insert("PATH".into(), self.installed_path(bytes)?);
        let expected: Vec<String> = environment
            .into_iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        let actual: Vec<String> =
            serde_json::from_value(get("Environment")?.clone()).map_err(|_| invalid())?;
        let mut sorted = actual.clone();
        sorted.sort();
        if sorted != expected
            || get("WorkingDirectory")? != text(&self.home)?
            || get("Type")? != "simple"
            || get("Restart")? != "always"
            || get("KillMode")? != "mixed"
            || get("TimeoutStopUSec")? != 90_000_000u64
            || get("RestartUSec")? != 5_000_000u64
            || get("UMask")? != 0o077u64
            || get("StandardOutput")? != "append"
            || get("StandardError")? != "append"
        {
            return Err(invalid());
        }
        let exec = get("ExecStart")?.as_array().ok_or_else(invalid)?;
        if exec.len() != 1
            || exec[0][0] != self.program[0]
            || exec[0][1] != json!(self.program)
            || exec[0][2] != false
        {
            return Err(invalid());
        }
        for key in [
            "ExecStartPre",
            "ExecStartPost",
            "ExecStop",
            "ExecStopPost",
            "ExecReload",
            "EnvironmentFiles",
            "PassEnvironment",
            "UnsetEnvironment",
        ] {
            if get(key)? != &json!([]) {
                return Err(invalid());
            }
        }
        Ok(Registration {
            installed: true,
            loaded,
        })
    }
    async fn registration(&self) -> Result<Registration, String> {
        let bytes = self.read_owned_unit()?;
        let wanted = self.wanted()?;
        if wanted && bytes.is_none() {
            return Err(invalid());
        }
        // Load the unit by its fixed name; this never starts it. busctl then
        // gives typed properties, avoiding shell-like parsing of argv/env output.
        let args = [
            "--user",
            "--no-pager",
            "--no-ask-password",
            "show",
            "--all",
            "--property=LoadState,ActiveState,FragmentPath,DropInPaths,Job",
            UNIT,
        ]
        .map(str::to_owned);
        let output = self.manager(false, &args, Duration::from_secs(5)).await?;
        if Self::not_found_reply(output.status.code(), &output.stdout) {
            return Ok(Registration {
                installed: bytes.is_some(),
                loaded: false,
            });
        }
        if !output.status.success() {
            return Err("The systemd user manager is unavailable".into());
        }
        let unit = self.properties("org.freedesktop.systemd1.Unit").await?;
        let service = if unit["LoadState"]["data"] == "loaded" {
            Some(self.properties("org.freedesktop.systemd1.Service").await?)
        } else {
            None
        };
        self.verified_properties(&unit, service.as_ref(), bytes.as_deref())
    }
    fn not_found_reply(code: Option<i32>, bytes: &[u8]) -> bool {
        if !matches!(code, Some(0 | 4)) {
            return false;
        }
        let Ok(source) = std::str::from_utf8(bytes) else {
            return false;
        };
        let mut fields = BTreeMap::new();
        for line in source.lines() {
            let Some((key, value)) = line.split_once('=') else {
                return false;
            };
            if fields.insert(key, value).is_some() {
                return false;
            }
        }
        fields.len() == 5
            && fields.get("LoadState") == Some(&"not-found")
            && fields.get("ActiveState") == Some(&"inactive")
            && fields.get("FragmentPath") == Some(&"")
            && fields.get("DropInPaths") == Some(&"")
            && matches!(fields.get("Job"), Some(&"" | &"0"))
    }
    async fn apply(&self, action: Action) -> Result<Registration, String> {
        let _control = control_lease(&self.root).await?;
        let host = ManagedHost::new(self.root.clone());
        {
            let _lease = host.lease().await?;
            let current = host.read_config()?.ok_or_else(invalid)?;
            if serde_json::to_value(&current).map_err(io_error)?
                != serde_json::to_value(&self.configuration).map_err(io_error)?
                || service_issuer::control_generation(&host, &current)? != self.generation
            {
                return Err(invalid());
            }
        }
        let mut registration = self.registration().await?;
        if action == Action::Status {
            return Ok(registration);
        }
        if matches!(action, Action::Stop | Action::Restart | Action::Uninstall) {
            if registration.loaded {
                self.command("stop", true, Duration::from_secs(130)).await?;
                registration = self.registration().await?;
                if registration.loaded {
                    return Err("The systemd user manager has not confirmed shutdown".into());
                }
            }
            service_issuer::require_stopped_for_control(&host, &self.configuration)?;
            if action == Action::Uninstall {
                if self.wanted()? {
                    fs::remove_file(self.wanted_path()).map_err(io_error)?;
                }
                if registration.installed {
                    if self.read_owned_unit()?.is_none() {
                        return Err(invalid());
                    }
                    fs::remove_file(&self.unit_path).map_err(io_error)?;
                    self.sync_directory()?;
                    self.command("daemon-reload", false, Duration::from_secs(30))
                        .await?;
                }
                // Deliberately retain configuration, issuer, native journal,
                // host database, conversations, credentials and pairings.
                return self.registration().await;
            }
            if action == Action::Stop {
                return Ok(registration);
            }
        }
        if !registration.installed {
            if action != Action::Install {
                return Err("Install the background service before starting it".into());
            }
            service_issuer::require_stopped_for_control(&host, &self.configuration)?;
            self.publish_unit()?;
        }
        if registration.loaded {
            return Ok(registration);
        }
        service_issuer::require_stopped_for_control(&host, &self.configuration)?;
        service_issuer::refresh_bundled_issuer(&host, &self.configuration)?;
        self.enable_owned()?;
        self.command("daemon-reload", false, Duration::from_secs(30))
            .await?;
        // Re-read manager-resolved argv, owner and policy after reload, before
        // activation. A foreign/drop-in/raced configuration is never started.
        self.registration().await?;
        self.command("reset-failed", true, Duration::from_secs(5))
            .await?;
        self.command("start", true, Duration::from_secs(30)).await?;
        self.registration().await
    }
}

pub(super) async fn control(
    host: &ManagedHost,
    action: Action,
) -> Result<super::ServiceStatus, String> {
    {
        let _operation = host.operation.lock().await;
        host.prepare()?;
        let _lease = host.lease().await?;
        host.initialize_locked()?;
        match host.read_config()? {
            None => {
                if action != Action::Status {
                    return Err("Set up the background service first".into());
                }
                let profile = option_env!("BLACKCRAB_EMBEDDED_HOST_SERVICE_PROFILE")
                    == Some("blackcrab-local-service-layout-v1");
                let expected = option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256");
                let bundled = expected.is_some()
                    && host
                        .bundled_payload
                        .as_ref()
                        .is_some_and(|payload| payload.expected_host_manifest_sha256() == expected);
                let available = profile && bundled;
                let fresh = super::service_initialization::fresh_owner(host).is_ok();
                return Ok(super::ServiceStatus {
                    state: if available {
                        "notConfigured"
                    } else {
                        "notAvailable"
                    },
                    can_initialize: available && fresh,
                    installed: false,
                    loaded: false,
                    permission_identity_restart_required: false,
                    error: None,
                });
            }
            Some(config) if config.ownership == OwnershipMode::Direct => {
                if action != Action::Status {
                    return Err("This workspace uses direct startup; background-service setup cannot replace it".into());
                }
                return Ok(super::ServiceStatus {
                    state: "direct",
                    can_initialize: false,
                    installed: false,
                    loaded: false,
                    permission_identity_restart_required: false,
                    error: None,
                });
            }
            Some(_) => {}
        }
    }
    let plan = ServiceUnitPlan::from_host(host).await?;
    let registration = plan.apply(action).await?;
    let (state, error) = if !registration.installed {
        ("notInstalled", None)
    } else if !registration.loaded {
        ("stopped", None)
    } else {
        let _operation = host.operation.lock().await;
        match host.probe(&plan.configuration).await {
            Ok(Probe::Attached(_)) => ("running", None),
            Ok(Probe::Stopped) => ("starting", None),
            Err(error) => ("unavailable", Some(error)),
        }
    };
    let permission_identity_restart_required = false;
    Ok(super::ServiceStatus {
        state,
        can_initialize: false,
        installed: registration.installed,
        loaded: registration.loaded,
        permission_identity_restart_required,
        error,
    })
}

#[cfg(test)]
#[path = "managed_service_linux_tests.rs"]
mod tests;
