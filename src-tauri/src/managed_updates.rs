//! The signed outer application owns updates, including requests from its workspace.
//! No request can select a feed, path, signature, executable, or process.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub status: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub download_percent: Option<f64>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub message: Option<String>,
    pub installing: bool,
}
struct Inner {
    snapshot: Snapshot,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
pub(crate) struct Updates(Mutex<Inner>);
#[derive(Clone, Copy, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Action {
    Status,
    Check,
    Download,
    Install,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub action: Action,
    pub expected_version: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reply {
    pub accepted: bool,
    pub state: Snapshot,
}
fn busy(s: &Snapshot) -> bool {
    s.installing || matches!(s.status.as_str(), "checking" | "downloading")
}
fn lock(app: &tauri::AppHandle) -> tauri::State<'_, Updates> {
    app.state::<Updates>()
}
pub(crate) fn snapshot(app: &tauri::AppHandle) -> Snapshot {
    lock(app).0.lock().unwrap().snapshot.clone()
}
pub(crate) fn installing(app: &tauri::AppHandle) -> bool {
    snapshot(app).installing
}
fn change(app: &tauri::AppHandle, f: impl FnOnce(&mut Inner)) {
    let state = {
        let owner = lock(app);
        let mut inner = owner.0.lock().unwrap();
        f(&mut inner);
        inner.snapshot.clone()
    };
    let _ = app.emit_to("main", "blackcrab-update-state", state);
}
pub(crate) fn init(app: &tauri::AppHandle) {
    app.manage(Updates(Mutex::new(Inner {
        snapshot: Snapshot {
            status: "idle".into(),
            current_version: app.package_info().version.to_string(),
            available_version: None,
            download_percent: None,
            downloaded_bytes: 0,
            total_bytes: None,
            message: None,
            installing: false,
        },
        update: None,
        bytes: None,
    })));
    let _ = APP.set(app.clone());
    crate::product_events::launch(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            let _ = request_inner(
                &app,
                Request {
                    action: Action::Check,
                    expected_version: None,
                },
                false,
            );
            tokio::time::sleep(Duration::from_secs(4 * 60 * 60)).await;
        }
    });
}
pub(crate) fn bridge_app() -> Option<tauri::AppHandle> {
    APP.get().cloned()
}
fn allowed(inner: &Inner, request: &Request) -> bool {
    if request.action == Action::Status {
        return true;
    }
    if busy(&inner.snapshot) {
        return false;
    }
    match request.action {
        Action::Check => true,
        Action::Download => inner.update.is_some() && inner.bytes.is_none(),
        Action::Install => {
            inner.bytes.is_some()
                && request.expected_version.as_ref() == inner.snapshot.available_version.as_ref()
        }
        Action::Status => true,
    }
}
pub(crate) fn request(app: &tauri::AppHandle, request: Request) -> Reply {
    request_inner(app, request, true)
}
/// `manual` is false only for the background check the app schedules itself.
fn request_inner(app: &tauri::AppHandle, request: Request, manual: bool) -> Reply {
    let accepted = {
        let owner = lock(app);
        let mut inner = owner.0.lock().unwrap();
        // Join a startup check under the same lock as starting a manual one.
        // Accepted does not schedule a second network request.
        if request.action == Action::Check && inner.snapshot.status == "checking" {
            return Reply {
                accepted: true,
                state: inner.snapshot.clone(),
            };
        }
        if !allowed(&inner, &request) {
            false
        } else {
            match request.action {
                Action::Status => {}
                Action::Check => {
                    inner.snapshot.status = "checking".into();
                    inner.snapshot.message = None;
                }
                Action::Download => {
                    inner.snapshot.status = "downloading".into();
                    inner.snapshot.downloaded_bytes = 0;
                    inner.snapshot.total_bytes = None;
                    inner.snapshot.download_percent = None;
                    inner.snapshot.message = None;
                }
                Action::Install => {
                    inner.snapshot.installing = true;
                    inner.snapshot.message = Some("Installing update…".into());
                }
            }
            true
        }
    };
    let reply = Reply {
        accepted,
        state: snapshot(app),
    };
    if accepted && request.action != Action::Status {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            match request.action {
                Action::Check => check(&app, manual).await,
                Action::Download => download(&app, manual).await,
                Action::Install => install(&app, manual).await,
                Action::Status => {}
            }
        });
    }
    reply
}
async fn check(app: &tauri::AppHandle, manual: bool) {
    let result = async {
        app.updater_builder()
            .timeout(Duration::from_secs(30))
            .build()?
            .check()
            .await
    }
    .await;
    let reported = match &result {
        Ok(update) => Ok(update.as_ref().map(|u| u.version.clone())),
        Err(error) => Err(error.to_string()),
    };
    change(app, |inner| match result {
        Ok(update) => {
            // Keep a verified queued installer when the feed is unchanged or
            // temporarily has no newer version; do not strand the install button.
            let same =
                update.as_ref().map(|u| &u.version) == inner.snapshot.available_version.as_ref();
            if inner.bytes.is_some() && (same || update.is_none()) {
                inner.snapshot.status = "downloaded".into();
            } else {
                inner.bytes = None;
                inner.snapshot.download_percent = None;
                inner.snapshot.available_version = update.as_ref().map(|u| u.version.clone());
                inner.snapshot.status = if update.is_some() {
                    "available"
                } else {
                    "up-to-date"
                }
                .into();
                inner.update = update;
            }
            inner.snapshot.message = None;
        }
        Err(_) => {
            inner.snapshot.status = if inner.bytes.is_some() {
                "downloaded"
            } else {
                "error"
            }
            .into();
            inner.snapshot.message =
                Some("Could not check for updates. Check your connection and try again.".into());
        }
    });
    match reported {
        Ok(version) => crate::product_events::update_check(app, version.as_deref(), manual).await,
        Err(error) => {
            crate::product_events::update_failed(app, "check", &error, None, manual).await
        }
    }
}

async fn download(app: &tauri::AppHandle, manual: bool) {
    let mut update = lock(app).0.lock().unwrap().update.clone().unwrap();
    let target = update.version.clone();
    update.timeout = Some(Duration::from_secs(30 * 60));
    let progress_app = app.clone();
    // The updater verifies the downloaded bytes using the release signing key.
    // Never mark a download ready merely because its network transfer finished.
    let result = update
        .download(
            move |size, total| {
                change(&progress_app, |inner| {
                    inner.snapshot.downloaded_bytes =
                        inner.snapshot.downloaded_bytes.saturating_add(size as u64);
                    inner.snapshot.total_bytes = total;
                    inner.snapshot.download_percent = total.filter(|n| *n > 0).map(|n| {
                        ((inner.snapshot.downloaded_bytes as f64 / n as f64) * 100.0).min(99.0)
                    });
                });
            },
            || {},
        )
        .await;
    let failure = result.as_ref().err().map(|error| error.to_string());
    change(app, |inner| match result {
        Ok(bytes) => {
            inner.bytes = Some(bytes);
            inner.snapshot.status = "downloaded".into();
            inner.snapshot.download_percent = Some(100.0);
            inner.snapshot.message =
                Some("Update ready to install. Restart when you’re ready.".into());
        }
        Err(_) => {
            inner.snapshot.status = "available".into();
            inner.snapshot.download_percent = None;
            inner.snapshot.message =
                Some("Download or signature verification failed. Try downloading again.".into());
        }
    });
    if let Some(error) = failure {
        crate::product_events::update_failed(app, "download", &error, Some(&target), manual).await;
    }
}
async fn install(app: &tauri::AppHandle, manual: bool) {
    app.state::<crate::managed_launcher::LauncherState>()
        .pause_for_update();
    crate::managed_launcher::show(app, "blackcrab-open-settings");
    // Keep progress/recovery visible while the captured workspace closes normally.
    // The independent background service and its running agents are untouched.
    #[cfg(any(unix, windows))]
    let closed = app
        .state::<crate::managed_native_entry::ManagedNativeEntry>()
        .close_for_update()
        .await
        .is_ok();
    #[cfg(not(any(unix, windows)))]
    let closed = true;
    if !closed {
        change(app, |inner| {
            inner.snapshot.installing = false;
            inner.snapshot.message =
                Some("The workspace is still closing. Try installing again shortly.".into());
        });
        return;
    }
    let (update, bytes) = {
        let owner = lock(app);
        let mut inner = owner.0.lock().unwrap();
        (inner.update.clone().unwrap(), inner.bytes.take().unwrap())
    };
    let target = update.version.clone();
    // Bounded, so a slow network cannot hold the install back.
    let _ = tokio::time::timeout(
        Duration::from_secs(3),
        crate::product_events::update_started(app, &target),
    )
    .await;
    let result = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let result = crate::macos_updater::install(&bytes, &update.version);
        #[cfg(not(target_os = "macos"))]
        let result = update.install(&bytes).map_err(|error| error.to_string());
        (result, bytes)
    })
    .await;
    match result {
        Ok((Ok(()), _)) => {
            app.restart();
        }
        failure => {
            let reason = match &failure {
                Ok((Err(error), _)) => error.clone(),
                _ => "The install task did not finish".to_string(),
            };
            change(app, |inner| {
                inner.snapshot.installing = false;
                let detail = match failure {
                    Ok((Err(error), bytes)) => {
                        inner.bytes = Some(bytes);
                        Some(error)
                    }
                    _ => None,
                };
                inner.snapshot.status = if inner.bytes.is_some() {
                    "downloaded"
                } else {
                    "available"
                }
                .into();
                inner.snapshot.message = Some(detail.unwrap_or_else(|| "Could not install the update. Your projects are kept. Try again or download Blackcrab from blackcrab.app.".into()));
            });
            crate::product_events::update_failed(app, "install", &reason, Some(&target), manual)
                .await;
        }
    }
}
#[tauri::command]
pub(crate) fn managed_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request: Request,
) -> Result<Reply, String> {
    crate::require_main_window(&window)?;
    Ok(self::request(&app, request))
}

/// This stream is inherited only by the captured workspace, never exposed over HTTP.
#[cfg(unix)]
pub(crate) fn serve(mut stream: std::os::unix::net::UnixStream, app: tauri::AppHandle) {
    use std::io::{Read, Write};
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    std::thread::spawn(move || {
        let mut frame = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            match stream.read(&mut byte) {
                Ok(0) => break,
                Ok(_) => {
                    if byte[0] != b'\n' {
                        frame.push(byte[0]);
                        if frame.len() > 1024 {
                            break;
                        }
                        continue;
                    }
                    let Ok(request) = serde_json::from_slice::<Request>(&frame) else {
                        break;
                    };
                    frame.clear();
                    let Ok(mut reply) = serde_json::to_vec(&self::request(&app, request)) else {
                        break;
                    };
                    reply.push(b'\n');
                    if stream.write_all(&reply).is_err() {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    if !frame.is_empty() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

/// The same exchange over the private pipe a Windows workspace inherits as
/// descriptor 5: one JSON request per line, one reply per request.
#[cfg(all(windows, not(test)))]
pub(crate) fn serve_pipe(pipe: crate::managed_spawn_windows::Pipe, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let (mut frame, mut chunk, mut waited) = (Vec::new(), [0u8; 256], 0u32);
        loop {
            let read = match pipe.read(&mut chunk, Some(Duration::from_secs(1))) {
                Ok(0) => break,
                Ok(read) => read,
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
                    // An idle channel waits; half a request must finish within five seconds.
                    if !frame.is_empty() {
                        waited += 1;
                        if waited >= 5 {
                            break;
                        }
                    }
                    continue;
                }
                Err(_) => break,
            };
            waited = 0;
            for byte in &chunk[..read] {
                if *byte != b'\n' {
                    frame.push(*byte);
                    if frame.len() > 1024 {
                        return;
                    }
                    continue;
                }
                let Ok(request) = serde_json::from_slice::<Request>(&frame) else { return };
                frame.clear();
                let Ok(mut reply) = serde_json::to_vec(&self::request(&app, request)) else { return };
                reply.push(b'\n');
                if pipe.write_all(&reply, Some(Duration::from_secs(5))).is_err() {
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requests_cannot_choose_a_feed_or_installer() {
        assert!(serde_json::from_str::<Request>(
            r#"{"action":"install","expectedVersion":"0.4.4","url":"https://other.test"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Request>(r#"{"action":"launch"}"#).is_err());
    }
    #[test]
    fn progress_actions_and_wrong_versions_do_not_start_installation() {
        let mut inner = Inner {
            snapshot: Snapshot {
                status: "downloading".into(),
                current_version: "0.4.3".into(),
                available_version: Some("0.4.4".into()),
                download_percent: None,
                downloaded_bytes: 0,
                total_bytes: None,
                message: None,
                installing: false,
            },
            update: None,
            bytes: Some(vec![1]),
        };
        let request = Request {
            action: Action::Install,
            expected_version: Some("0.4.4".into()),
        };
        assert!(!allowed(&inner, &request));
        inner.snapshot.status = "downloaded".into();
        assert!(!allowed(
            &inner,
            &Request {
                action: Action::Install,
                expected_version: Some("0.4.3".into())
            }
        ));
        assert!(allowed(&inner, &request));
        inner.snapshot.installing = true;
        assert!(!allowed(&inner, &request));
        assert!(allowed(
            &inner,
            &Request {
                action: Action::Status,
                expected_version: None
            }
        ));
    }
}
