//! The Windows workspace owner and launch. The same order of checks as the
//! macOS and Linux launch in `managed_desktop.rs`; the process, profile,
//! environment and channels come from `managed_workspace_windows.rs`.
//!
//! Not yet on Windows: the update channel (descriptor 5) and the private
//! browser channel. A binding that carries a browser capability is refused.
use super::*;
use crate::{
    managed_spawn_windows::{Pipe, Process},
    managed_workspace_windows as workspace,
};
use std::sync::atomic::{AtomicBool, Ordering};

fn alive(process: &Process) -> Result<bool, String> {
    Ok(process.wait(Duration::ZERO).map_err(|_| error())?.is_none())
}
/// `fs::canonicalize` answers with a `\\?\` path, which a process cannot have
/// as its working directory.
fn plain(path: &Path) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(text) => PathBuf::from(text),
        None => path.to_path_buf(),
    }
}

pub(in crate) struct NativeDesktop {
    process: Arc<Process>,
    detached: Arc<AtomicBool>,
    lifecycle: Arc<Mutex<workspace::Lifecycle>>,
    pub(in crate) package_digest: String,
    identity: DesktopIdentity,
}
impl NativeDesktop {
    /// Closes this client's owner channels; never a host or process signal.
    pub(in crate) fn detach(&self) {
        self.detached.store(true, Ordering::SeqCst);
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            lifecycle.close();
        }
    }
    pub(in crate) fn is_running(&self) -> Result<bool, String> {
        alive(&self.process)
    }
}
impl Drop for NativeDesktop {
    fn drop(&mut self) {
        self.detach();
    }
}

/// Root may hold exactly one of these in native state.
/// Repeated explicit opens reuse the captured client; no automatic restart.
#[derive(Default)]
pub(in crate) struct NativeDesktopOwner {
    active: tokio::sync::Mutex<Option<NativeDesktop>>,
}
impl NativeDesktopOwner {
    pub(in crate) async fn activate(&self, _app: &tauri::AppHandle) -> Result<bool, String> {
        self.activate_window().await
    }
    /// Asks our captured workspace, over its own channel, to show its window.
    pub(in crate) async fn activate_window(&self) -> Result<bool, String> {
        let active = self.active.lock().await;
        let native = active.as_ref().ok_or_else(error)?;
        let (process, lifecycle) = (native.process.clone(), native.lifecycle.clone());
        tokio::task::spawn_blocking(move || {
            if !alive(&process)? {
                return Err(error());
            }
            let visible = lifecycle
                .lock()
                .map_err(|_| error())?
                .activate()
                .map_err(|_| "The workspace window did not respond. Close it and try again.".to_string())?;
            if !alive(&process)? {
                return Err(error());
            }
            Ok(visible)
        })
        .await
        .map_err(|_| error())?
    }
    pub(in crate) async fn client_exit(&self) -> Result<Option<bool>, String> {
        let active = self.active.lock().await;
        let process = &active.as_ref().ok_or_else(error)?.process;
        Ok(process.wait(Duration::ZERO).map_err(|_| error())?.map(|code| code == 0))
    }
    pub(in crate) async fn running(&self) -> Result<bool, String> {
        self.running_for_identity(DesktopIdentity::Production, None).await
    }
    pub(in crate) async fn running_for_identity(
        &self,
        identity: DesktopIdentity,
        expected_digest: Option<&str>,
    ) -> Result<bool, String> {
        match self.active.lock().await.as_ref() {
            Some(client) => {
                let alive = client.is_running()?;
                if alive
                    && (client.identity != identity
                        || expected_digest.is_some_and(|digest| client.package_digest.as_str() != digest))
                {
                    return Err(error());
                }
                Ok(alive)
            }
            None => Ok(false),
        }
    }
    pub(in crate) async fn open(
        &self,
        host: ManagedHost,
        selected: PathBuf,
        expected_digest: String,
    ) -> Result<bool, String> {
        self.open_for_identity(host, selected, expected_digest, DesktopIdentity::Production).await
    }
    /// Only the production identity exists on Windows.
    pub(in crate) async fn open_for_identity(
        &self,
        host: ManagedHost,
        selected: PathBuf,
        expected_digest: String,
        identity: DesktopIdentity,
    ) -> Result<bool, String> {
        if identity != DesktopIdentity::Production {
            return Err(error());
        }
        identity.check_digest(&expected_digest)?;
        let mut active = self.active.lock().await;
        if let Some(client) = active.as_ref() {
            if client.is_running()? {
                if !same_verified_client(client.identity, &client.package_digest, identity, &expected_digest) {
                    return Err("Close the existing native client before changing its package".into());
                }
                return Ok(false);
            }
        }
        *active = Some(launch(host, selected, expected_digest).await?);
        Ok(true)
    }
    pub(in crate) async fn detach(&self) {
        if let Some(client) = self.active.lock().await.as_ref() {
            client.detach();
        }
    }
}

/// Backend-only launch. No app entrypoint, adoption persistence or arbitrary CLI exists here.
pub(in crate) async fn launch(
    host: ManagedHost,
    selected: PathBuf,
    expected_digest: String,
) -> Result<NativeDesktop, String> {
    if Target::native().is_err() {
        return Err("This workspace platform is not supported".into());
    }
    let package = tokio::task::spawn_blocking(move || {
        verify_package_for_identity(&selected, &expected_digest, DesktopIdentity::Production)
    })
    .await
    .map_err(|_| error())??;
    launch_verified(host, package).await
}

async fn launch_verified(host: ManagedHost, package: VerifiedDesktop) -> Result<NativeDesktop, String> {
    let identity = package.identity;
    let binding = host.desktop_binding().await?;
    if binding.browser.is_some() {
        return Err(error());
    }
    let profile_root = host.desktop_profile_root();
    let (executable, package_root) = (plain(&package.executable), plain(&package.root));
    let (profile, started) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let home = workspace::account_home().map_err(|_| "Native OS account home is unavailable".to_string())?;
        let profile = workspace::prepare_profile(&profile_root, PROFILE_MARKER).map_err(|_| error())?;
        let started = workspace::start(&executable, &package_root, &home, &profile)
            .map_err(|_| "Managed native client could not start".to_string())?;
        Ok((profile, started))
    })
    .await
    .map_err(|_| error())??;
    let workspace::Started { process, bootstrap, renewal, lifecycle } = started;
    let process = Arc::new(process);
    let detached = Arc::new(AtomicBool::new(false));
    let owner = NativeDesktop {
        process: process.clone(),
        detached: detached.clone(),
        lifecycle: Arc::new(Mutex::new(workspace::Lifecycle::new(lifecycle))),
        package_digest: package.manifest_digest,
        identity,
    };
    if !alive(&process)? {
        return Err(error());
    }
    let grant = tokio::time::timeout(Duration::from_secs(8), host.desktop_pair_grant(&binding))
        .await
        .map_err(|_| "Native pairing deadline exceeded")??;
    if !alive(&process)? {
        return Err(error());
    }
    host.desktop_binding_current(&binding)?;
    let mut descriptor: Value =
        serde_json::from_slice(&descriptor_for_identity(&binding, &profile, &grant, identity)?)
            .map_err(|_| error())?;
    descriptor["lifecycle"] = json!({"kind":"launcher-lifecycle-fd-v1","fd":6});
    let bytes = serde_json::to_vec(&descriptor).map_err(|_| error())?;
    // Written once and closed: the workspace reads its descriptor to the end.
    tokio::task::spawn_blocking(move || bootstrap.write_all(&bytes, Some(Duration::from_secs(2))))
        .await
        .map_err(|_| error())?
        .map_err(|_| error())?;
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || serve_broker(renewal, process, detached, host, binding, runtime));
    Ok(owner)
}

/// Credential renewal for exactly our captured workspace, one request at a
/// time, for as long as it runs and the host binding stays the same.
fn serve_broker(
    pipe: Pipe,
    process: Arc<Process>,
    detached: Arc<AtomicBool>,
    host: ManagedHost,
    binding: DesktopHostBinding,
    runtime: tokio::runtime::Handle,
) {
    let second = Some(Duration::from_secs(1));
    let mut frames = Frames::default();
    let mut seen = HashSet::new();
    let mut chunk = [0u8; 2048];
    let _ = (|| -> Result<(), String> {
        loop {
            if detached.load(Ordering::SeqCst) {
                return Ok(());
            }
            host.desktop_binding_current(&binding)?;
            frames.check(Instant::now()).map_err(|_| error())?;
            if !alive(&process)? {
                return Ok(());
            }
            let n = match pipe.read(&mut chunk, second) {
                Ok(0) => return Ok(()),
                Ok(n) => n,
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    frames.check(Instant::now()).map_err(|_| error())?;
                    continue;
                }
                Err(_) => return Err(error()),
            };
            frames.check(Instant::now()).map_err(|_| error())?;
            let Some(frame) = frames.push(&chunk[..n], Instant::now()).map_err(|_| error())? else {
                continue;
            };
            let request = authorize_renewal(&frame, &binding, &mut seen)?;
            if !alive(&process)? {
                return Err(error());
            }
            let grant = runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(8), host.desktop_pair_grant(&binding))
                    .await
                    .map_err(|_| error())?
            })?;
            if !alive(&process)? || detached.load(Ordering::SeqCst) {
                return Err(error());
            }
            host.desktop_binding_current(&binding)?;
            // One request at a time: anything already queued behind this one
            // ends the channel instead of being answered out of turn.
            if pipe.pending().map_err(|_| error())? != 0 {
                return Err(error());
            }
            let mut reply = serde_json::to_vec(&json!({"version":1,"kind":"paired-credential","requestId":request.request_id,"generation":binding.generation,"environmentId":binding.environment_id,"credential":grant.credential,"expiresAt":grant.expires_at})).map_err(|_| error())?;
            if reply.len() + 1 > MAX_FRAME {
                return Err(error());
            }
            reply.push(b'\n');
            pipe.write_all(&reply, second).map_err(|_| error())?;
        }
    })();
}

/// CI only: opens the real built workspace against the real running service
/// through the same owner Root will use, and requires its window to show.
#[cfg(test)]
pub(crate) async fn open_built_workspace_for_test(host: ManagedHost, package: PathBuf) -> Result<(), String> {
    let digest = std::env::var("BLACKCRAB_NATIVE_PACKAGE_SHA256").map_err(|_| "no package digest".to_string())?;
    let owner = NativeDesktopOwner::default();
    let host_profile = host.desktop_profile_root();
    if !owner.open(host.clone(), package.clone(), digest.clone()).await? {
        return Err("the first open did not start a workspace".into());
    }
    let outcome: Result<(), String> = async {
        // A live process is not yet a window: Root's launcher asks up to
        // sixty times, a quarter of a second apart, and so does this.
        let mut asked = 0;
        let visible = loop {
            asked += 1;
            if owner.activate_window().await? {
                break true;
            }
            if asked == 60 {
                break false;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        };
        println!("WINDOWS_WORKSPACE visible={visible} after {asked} requests");
        if !visible {
            return Err("the workspace did not show its window".into());
        }
        // The attached workspace stays up; one that could not reach its
        // service shows an error dialog and exits.
        tokio::time::sleep(Duration::from_secs(20)).await;
        if !owner.running().await? {
            return Err(format!("the workspace exited: {:?}", owner.client_exit().await));
        }
        if owner.open(host, package, digest).await? {
            return Err("a second open started another workspace".into());
        }
        if !owner.activate_window().await? {
            return Err("the running workspace did not show its window again".into());
        }
        Ok(())
    }
    .await;
    let screenshot = |name: &str| {
        if let Ok(root) = std::env::var("BLACKCRAB_BOOT_EVIDENCE") {
            let file = Path::new(&root).join(name);
            let script = format!(
                "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
                 $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \
                 $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; \
                 $g=[System.Drawing.Graphics]::FromImage($i); \
                 $g.CopyFromScreen($b.Left,$b.Top,0,0,$i.Size); \
                 $i.Save('{}')",
                file.display()
            );
            let _ = Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &script]).output();
        }
    };
    screenshot("workspace-attached.png");
    // The first screenshot showed an empty window. A second, a minute later,
    // tells a slow first load from an interface that never loads.
    if outcome.is_ok() {
        tokio::time::sleep(Duration::from_secs(60)).await;
        screenshot("workspace-attached-later.png");
        println!("WINDOWS_WORKSPACE still running a minute later: {:?}", owner.running().await);
    }
    // What the workspace itself recorded while starting: the screenshots
    // alone cannot say whether its interface loaded.
    fn walk(root: &Path, depth: usize, found: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(root) else { return };
        for entry in entries.flatten().take(200) {
            let path = entry.path();
            if path.is_dir() {
                if depth > 0 {
                    walk(&path, depth - 1, found);
                }
            } else {
                found.push(path);
            }
        }
    }
    let profile = host_profile.clone();
    let mut files = Vec::new();
    walk(&profile, 4, &mut files);
    files.sort();
    println!("WINDOWS_WORKSPACE profile holds {} files", files.len());
    for file in &files {
        let size = fs::metadata(file).map(|m| m.len()).unwrap_or(0);
        println!("  {} ({size} bytes)", file.strip_prefix(&profile).unwrap_or(file).display());
    }
    for file in files.iter().filter(|file| {
        file.extension().is_some_and(|e| e == "log" || e == "ndjson")
            || file.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().contains("log"))
    }).take(8) {
        let bytes = fs::read(file).unwrap_or_default();
        let tail = String::from_utf8_lossy(&bytes[bytes.len().saturating_sub(5000)..]).into_owned();
        println!("--- {} ({} bytes)\n{tail}", file.display(), bytes.len());
    }
    // The workspace's whole trace and renderer history, kept as evidence.
    if let Ok(root) = std::env::var("BLACKCRAB_BOOT_EVIDENCE") {
        let kept = Path::new(&root).join("workspace-logs");
        let _ = fs::create_dir_all(&kept);
        if let Some(output) = std::env::var_os("BLACKCRAB_TEST_WORKSPACE_OUTPUT") {
            let bytes = fs::read(&output).unwrap_or_default();
            // Long token-like strings are removed before anything is printed.
            let mut text = String::new();
            let mut run = String::new();
            for character in String::from_utf8_lossy(&bytes).chars() {
                if character.is_ascii_alphanumeric() || "_-=".contains(character) {
                    run.push(character);
                    continue;
                }
                text.push_str(if run.len() >= 32 { "[redacted]" } else { &run });
                run.clear();
                text.push(character);
            }
            text.push_str(if run.len() >= 32 { "[redacted]" } else { &run });
            let tail: String = text.chars().rev().take(12000).collect::<Vec<_>>().into_iter().rev().collect();
            println!("WINDOWS_WORKSPACE output ({} bytes):\n{tail}", bytes.len());
            let _ = fs::write(kept.join("workspace-output.txt"), text);
        }
        for file in files.iter().filter(|file| file.starts_with(profile.join("userdata"))) {
            if let Some(name) = file.file_name() {
                let _ = fs::copy(file, kept.join(name));
            }
        }
    }
    if let Some(client) = owner.active.lock().await.as_ref() {
        client.detach();
        let _ = client.process.terminate();
        let _ = client.process.wait(Duration::from_secs(10));
    }
    outcome
}
