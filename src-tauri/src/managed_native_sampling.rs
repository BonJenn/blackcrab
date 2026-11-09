//! Test-only process-instance sampling. No persisted PID authorizes any action.
use super::*;
use std::collections::HashSet;
use std::process::{Command, Stdio};

// Root actual CLI evidence: valid1s sample needs~5.95s including analysis/output.
const HELPER_BOUND_SECONDS: u64 = 10;
const PAIR_BUDGET_SECONDS: u64 = 24;
const FINAL_MARGIN_SECONDS: u64 = 4;
const RENDERER: &str = "Blackcrab.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)";
const RENDERER_SHA256: &str = "3088e33cd48e655e54c420798c06426b58d5d0a80a63eb450cdc15d0fe261ae3";
#[link(name = "proc")]
extern "C" {
    fn proc_listchildpids(parent: i32, buffer: *mut c_void, bytes: i32) -> i32;
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum SampleStatus {
    Completed,
    SkippedIdentity,
    SkippedBudget,
    Failed,
}
pub(super) fn due(
    elapsed: Duration,
    requested: bool,
    responses: &HashSet<u64>,
    decided: bool,
) -> bool {
    elapsed >= Duration::from_secs(15)
        && requested
        && !responses.contains(&100)
        && !responses.contains(&101)
        && !decided
}
fn native_live(child: &Arc<Mutex<Child>>, identity: &Identity) -> bool {
    identity.current()
        && child.lock().is_ok_and(|mut child| {
            child.id() == identity.pid && child.try_wait().is_ok_and(|exit| exit.is_none())
        })
}
fn pinned_renderer(native: &Identity) -> Result<PathBuf, ()> {
    let root = native.executable.ancestors().nth(4).ok_or(())?;
    if native.executable != root.join("Blackcrab.app/Contents/MacOS/Blackcrab") {
        return Err(());
    }
    let manifest = bounded_owned_input(
        &root.join("blackcrab-managed-desktop.json"),
        16 * 1024 * 1024,
    )
    .map_err(|_| ())?;
    if format!("{:x}", Sha256::digest(&manifest)) != DESKTOP_MANIFEST {
        return Err(());
    }
    let value: Value = serde_json::from_slice(&manifest).map_err(|_| ())?;
    let entries = value["files"].as_array().ok_or(())?;
    if entries
        .iter()
        .filter(|entry| {
            entry["path"] == RENDERER
                && entry["type"] == "file"
                && entry["executable"] == true
                && entry["bytes"] == 202576
                && entry["sha256"] == RENDERER_SHA256
        })
        .count()
        != 1
    {
        return Err(());
    }
    let path = root.join(RENDERER);
    if path.canonicalize().map_err(|_| ())? != path {
        return Err(());
    }
    let bytes = bounded_owned_input(&path, 202576).map_err(|_| ())?;
    if bytes.len() != 202576 || format!("{:x}", Sha256::digest(&bytes)) != RENDERER_SHA256 {
        return Err(());
    }
    Ok(path)
}
fn children(pid: u32) -> Result<Vec<u32>, ()> {
    let mut buffer = [0u32; 256];
    // libproc convenience wrappers return a PID COUNT (unlike proc_listpids' bytes).
    let count = unsafe {
        proc_listchildpids(
            pid as i32,
            buffer.as_mut_ptr().cast(),
            std::mem::size_of_val(&buffer) as i32,
        )
    };
    if count < 0 || count as usize >= buffer.len() {
        return Err(());
    }
    Ok(buffer[..count as usize]
        .iter()
        .copied()
        .filter(|pid| *pid > 0)
        .collect())
}

fn chain_matches(native: &Identity, chain: &[Identity], renderer: &Path) -> bool {
    !chain.is_empty()
        && chain.len() <= 8
        && chain.last().is_some_and(|last| last.executable == renderer)
        && chain.iter().enumerate().all(|(index, item)| {
            item.uid == native.uid
                && item.parent
                    == if index == 0 {
                        native.pid
                    } else {
                        chain[index - 1].pid
                    }
        })
        && chain
            .iter()
            .map(|item| item.pid)
            .collect::<HashSet<_>>()
            .len()
            == chain.len()
}
fn chain_current(native: &Identity, chain: &[Identity], renderer: &Path) -> bool {
    native.current()
        && chain_matches(native, chain, renderer)
        && chain.iter().all(Identity::current)
}
fn find_renderer(native: &Identity, renderer: &Path) -> Result<Vec<Identity>, ()> {
    let mut pending = vec![(native.pid, Vec::<Identity>::new())];
    let mut visited = HashSet::new();
    while let Some((parent, chain)) = pending.pop() {
        if !visited.insert(parent) || visited.len() > 128 {
            return Err(());
        }
        for pid in children(parent)? {
            let identity = match Identity::read(pid) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if identity.uid != native.uid || identity.parent != parent || !identity.current() {
                continue;
            }
            let mut next = chain.clone();
            next.push(identity);
            if chain_current(native, &next, renderer) {
                return Ok(next);
            }
            if next.len() < 8 {
                pending.push((pid, next));
            }
        }
    }
    Err(())
}
struct CapturedSampler(Option<Child>);
impl Drop for CapturedSampler {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
    }
}
fn private_output(path: &Path) -> Result<fs::File, ()> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| ())
}
fn stderr_category(bytes: &[u8]) -> &'static str {
    let lower = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    if bytes.is_empty() {
        "empty"
    } else if lower.contains("permission")
        || lower.contains("not permitted")
        || lower.contains("unable to access task")
    {
        "permission-denied"
    } else if lower.contains("usage:") || lower.contains("invalid usage") {
        "usage"
    } else {
        "other"
    }
}
fn report_helper(
    profile: &Path,
    role: &str,
    reason: &'static str,
    status: Option<ExitStatus>,
    started: Instant,
) {
    use std::os::unix::process::ExitStatusExt;
    let stderr = bounded_owned_input(
        &profile.join(format!("native-thread-sample-{role}.stderr")),
        256 * 1024,
    );
    let (stderr_bytes, stderr_hash, category) = match stderr {
        Ok(bytes) => (
            Some(bytes.len()),
            Some(format!("{:x}", Sha256::digest(&bytes))),
            stderr_category(&bytes),
        ),
        Err(_) => (None, None, "unavailable-or-overbound"),
    };
    let event = json!({"reason":reason,"elapsedMs":started.elapsed().as_millis(),"timing":if started.elapsed()<=Duration::from_secs(HELPER_BOUND_SECONDS){"within-helper-bound"}else{"over-helper-bound"},"exitKind":match status {Some(s) if s.success()=>"zero",Some(s) if s.signal().is_some()=>"signal",Some(_)=>"nonzero",None=>"unavailable"},"exitCode":status.and_then(|s|s.code()),"stderrBytes":stderr_bytes,"stderrHash":stderr_hash,"stderrCategory":category});
    if let Ok(mut output) =
        private_output(&profile.join(format!("native-thread-sample-{role}.result.json")))
    {
        let _ = writeln!(output, "{event}");
    }
}
fn one_sample(
    target: &Identity,
    profile: &Path,
    role: &str,
    valid: impl Fn() -> bool,
) -> SampleStatus {
    if !valid() || protected_pid(target.pid) {
        return SampleStatus::SkippedIdentity;
    }
    let path = profile.join(format!("native-thread-sample-{role}.txt"));
    if private_output(&path).is_err() {
        return SampleStatus::Failed;
    }
    let stderr_path = profile.join(format!("native-thread-sample-{role}.stderr"));
    let stderr = match private_output(&stderr_path) {
        Ok(file) => file,
        Err(_) => return SampleStatus::Failed,
    };
    if !valid() {
        return SampleStatus::SkippedIdentity;
    }
    let mut command = Command::new("/usr/bin/sample");
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            libc::umask(0o077);
            Ok(())
        });
    }
    let started = Instant::now();
    let spawned = command
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", profile.join("home"))
        .env("TMPDIR", profile.join("tmp"))
        .args([
            target.pid.to_string(),
            "1".into(),
            "1".into(),
            "-file".into(),
            path.to_string_lossy().into_owned(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr))
        .spawn();
    let mut sampler = match spawned {
        Ok(child) => CapturedSampler(Some(child)),
        Err(_) => {
            report_helper(profile, role, "spawn-failed", None, started);
            return SampleStatus::Failed;
        }
    };
    let deadline = started + Duration::from_secs(HELPER_BOUND_SECONDS);
    let (reason, status) = loop {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => break ("output-unavailable", None),
        };
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::getuid() }
            || metadata.nlink() != 1
            || metadata.mode() & 0o777 != 0o600
        {
            break ("output-permission", None);
        }
        if metadata.len() > 16 * 1024 * 1024 {
            break ("output-overbound", None);
        }
        match fs::symlink_metadata(&stderr_path) {
            Ok(m)
                if m.is_file()
                    && m.uid() == unsafe { libc::getuid() }
                    && m.nlink() == 1
                    && m.mode() & 0o777 == 0o600
                    && m.len() <= 256 * 1024 => {}
            _ => break ("stderr-permission-or-overbound", None),
        }
        if !valid() {
            break ("target-changed", None);
        }
        match sampler.0.as_mut().unwrap().try_wait() {
            Ok(Some(status)) => {
                // sample writes its report at exit; the pre-wait metadata can
                // still describe the empty placeholder. Recheck the final file.
                let completed = match fs::symlink_metadata(&path) {
                    Ok(value) => value,
                    Err(_) => break ("output-unavailable", Some(status)),
                };
                if !completed.is_file()
                    || completed.uid() != unsafe { libc::getuid() }
                    || completed.nlink() != 1
                    || completed.mode() & 0o777 != 0o600
                {
                    break ("output-permission", Some(status));
                }
                if completed.len() > 16 * 1024 * 1024 {
                    break ("output-overbound", Some(status));
                }
                break (
                    if !status.success() {
                        "exit-nonzero"
                    } else if completed.len() == 0 {
                        "empty-output"
                    } else {
                        "completed"
                    },
                    Some(status),
                );
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => break ("helper-timeout", None),
            Err(_) => break ("wait-failed", None),
        }
    };
    // Reap actual captured helper BEFORE reporting final timing/status. No target signals.
    let final_status = if let Some(status) = status {
        Some(status)
    } else if let Some(child) = sampler.0.as_mut() {
        let _ = child.kill();
        child.wait().ok()
    } else {
        None
    };
    sampler.0.take();
    report_helper(profile, role, reason, final_status, started);
    if reason == "completed" && valid() {
        SampleStatus::Completed
    } else if reason == "target-changed" {
        SampleStatus::SkippedIdentity
    } else {
        SampleStatus::Failed
    }
}

pub(super) async fn run(
    child: Arc<Mutex<Child>>,
    native: Identity,
    profile: PathBuf,
    remaining: Duration,
) -> SampleStatus {
    if remaining < Duration::from_secs(PAIR_BUDGET_SECONDS) {
        return SampleStatus::SkippedBudget;
    }
    let deadline = Instant::now() + remaining;
    tokio::task::spawn_blocking(move || {
        if !native_live(&child, &native) {
            return SampleStatus::SkippedIdentity;
        }
        let renderer = match pinned_renderer(&native) {
            Ok(value) => value,
            Err(_) => return SampleStatus::SkippedIdentity,
        };
        let chain = match find_renderer(&native, &renderer) {
            Ok(value) => value,
            Err(_) => return SampleStatus::SkippedIdentity,
        };
        let current = || native_live(&child, &native) && chain_current(&native, &chain, &renderer);
        if !current() {
            return SampleStatus::SkippedIdentity;
        }
        // Recheck after filesystem/identity work; only the original outer budget is usable.
        if deadline.saturating_duration_since(Instant::now())
            < Duration::from_secs(PAIR_BUDGET_SECONDS)
        {
            return SampleStatus::SkippedBudget;
        }
        // Sequential1s observations,10s each including tool analysis/output,4s margin.
        let main = one_sample(&native, &profile, "main", &current);
        if deadline.saturating_duration_since(Instant::now())
            < Duration::from_secs(HELPER_BOUND_SECONDS + FINAL_MARGIN_SECONDS)
        {
            return SampleStatus::SkippedBudget;
        }
        let renderer_status = one_sample(chain.last().unwrap(), &profile, "renderer", &current);
        if main == SampleStatus::Completed && renderer_status == SampleStatus::Completed {
            SampleStatus::Completed
        } else if main == SampleStatus::SkippedIdentity
            || renderer_status == SampleStatus::SkippedIdentity
        {
            SampleStatus::SkippedIdentity
        } else {
            SampleStatus::Failed
        }
    })
    .await
    .unwrap_or(SampleStatus::Failed)
}
#[test]
fn sample_trigger_is_once_and_requires_missing_both_first_snapshots() {
    let mut responses = HashSet::new();
    assert!(!due(Duration::from_secs(14), true, &responses, false));
    assert!(due(Duration::from_secs(15), true, &responses, false));
    assert!(!due(Duration::from_secs(15), false, &responses, false));
    assert!(!due(Duration::from_secs(15), true, &responses, true));
    responses.insert(100);
    assert!(!due(Duration::from_secs(15), true, &responses, false));
    responses.clear();
    responses.insert(101);
    assert!(!due(Duration::from_secs(15), true, &responses, false));
}
#[test]
fn sample_identity_refuses_wrong_parent_uid_and_birth_on_real_captured_child() {
    let mut child = Command::new("/bin/sleep")
        .arg("2")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    assert!(children(std::process::id()).unwrap().contains(&child.id()));
    let identity = Identity::read(child.id()).unwrap();
    let mut fake = identity.clone();
    fake.birth_micros ^= 1;
    assert!(!fake.current());
    assert!(identity.current());
    let native = Identity::read(std::process::id()).unwrap();
    assert!(chain_matches(
        &native,
        &[identity.clone()],
        &identity.executable
    ));
    let mut wrong = identity.clone();
    wrong.parent = 1;
    assert!(!chain_matches(&native, &[wrong], &identity.executable));
    let mut wrong = identity.clone();
    wrong.uid ^= 1;
    assert!(!chain_matches(&native, &[wrong], &identity.executable));
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(!identity.current());
}

#[test]
fn sample_helper_error_categories_never_return_tool_payload() {
    assert_eq!(stderr_category(b""), "empty");
    assert_eq!(
        stderr_category(b"Operation not permitted for private-pid"),
        "permission-denied"
    );
    assert_eq!(stderr_category(b"invalid usage: private-value"), "usage");
    assert_eq!(stderr_category(b"secret URL token"), "other");
}
#[test]
#[ignore = "opt-in actual /usr/bin/sample1s preflight on a captured own /bin/sleep child; no Native/host"]
fn actual_sample_tool_preflight_on_captured_own_sleep() {
    let profile = PathBuf::from(
        std::env::var_os("BLACKCRAB_SAMPLE_PREFLIGHT_ROOT")
            .expect("explicit private preflight root"),
    );
    assert!(private_ancestors(&profile).unwrap());
    for name in ["home", "tmp"] {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(profile.join(name))
            .unwrap();
    }
    let child = Command::new("/bin/sleep")
        .arg("15")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let child = Arc::new(Mutex::new(child));
    struct OwnPreflightChild(Arc<Mutex<Child>>);
    impl Drop for OwnPreflightChild {
        fn drop(&mut self) {
            if let Ok(mut child) = self.0.lock() {
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }
    let _cleanup = OwnPreflightChild(child.clone());
    let identity = Identity::read(child.lock().unwrap().id()).unwrap();
    let result = one_sample(&identity, &profile, "preflight", || {
        native_live(&child, &identity)
    });
    {
        let mut child = child.lock().unwrap();
        if child.try_wait().unwrap().is_none() {
            child.kill().unwrap();
        }
        child.wait().unwrap();
    }
    assert_eq!(
        result,
        SampleStatus::Completed,
        "actualtool preflight failed; inspect private enum/result+stderr before any Native attempt"
    );
}

#[tokio::test]
async fn insufficient_sample_budget_creates_no_helper_output() {
    let profile = std::env::temp_dir().join(format!(
        "blackcrab-sample-budget-test-{}",
        std::process::id()
    ));
    fs::DirBuilder::new().mode(0o700).create(&profile).unwrap();
    let child = Arc::new(Mutex::new(
        Command::new("/bin/sleep")
            .arg("2")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    ));
    struct OwnChild(Arc<Mutex<Child>>);
    impl Drop for OwnChild {
        fn drop(&mut self) {
            if let Ok(mut child) = self.0.lock() {
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }
    let cleanup = OwnChild(child.clone());
    let identity = Identity::read(child.lock().unwrap().id()).unwrap();
    let before = children(std::process::id())
        .unwrap()
        .into_iter()
        .collect::<HashSet<_>>();
    let status = run(
        child.clone(),
        identity.clone(),
        profile.clone(),
        Duration::from_secs(23),
    )
    .await;
    assert_eq!(status, SampleStatus::SkippedBudget);
    assert!(fs::read_dir(&profile).unwrap().next().is_none());
    assert!(native_live(&child, &identity));
    assert_eq!(
        children(std::process::id())
            .unwrap()
            .into_iter()
            .collect::<HashSet<_>>(),
        before
    );
    drop(cleanup);
    fs::remove_dir(profile).unwrap();
}
