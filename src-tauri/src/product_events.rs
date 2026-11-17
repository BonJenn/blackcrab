//! Anonymous product events: app launch and the update funnel.
//!
//! The signed outer application owns launching and updating, so it also sends
//! these events. Before 0.4.2 the webview did; that code went away with the
//! webview interface and the events stopped. Each event carries the platform,
//! the current version, an update target when there is one, and a random install
//! id that the server hashes. No prompts, paths, file contents or credentials.
//! Sending is best effort and never affects launching or updating.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

const EVENTS_URL: &str = "https://www.blackcrab.app/api/events";
const DISABLED_FILE: &str = "analytics-disabled";
const INSTALL_ID_FILE: &str = "analytics-install-id";
const PENDING_FILE: &str = "analytics-pending-update.json";

fn data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

fn env_disabled() -> bool {
    std::env::var("BLACKCRAB_ANALYTICS")
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "off" | "false" | "no"))
        .unwrap_or(false)
}

fn dir_enabled(dir: &Path) -> bool {
    !dir.join(DISABLED_FILE).exists()
}

/// Analytics are on unless the user turned them off or the environment does.
pub(crate) fn enabled(app: &tauri::AppHandle) -> bool {
    !env_disabled() && data_dir(app).is_some_and(|dir| dir_enabled(&dir))
}

pub(crate) fn set_enabled(app: &tauri::AppHandle, on: bool) -> Result<(), String> {
    let dir = data_dir(app).ok_or("Blackcrab's data folder is unavailable")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let marker = dir.join(DISABLED_FILE);
    if on {
        if marker.exists() {
            std::fs::remove_file(&marker).map_err(|e| e.to_string())?;
        }
    } else {
        std::fs::write(&marker, b"off\n").map_err(|e| e.to_string())?;
        // Turning analytics off also forgets any update waiting to be reported.
        let _ = std::fs::remove_file(dir.join(PENDING_FILE));
    }
    Ok(())
}

fn valid_install_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn install_id(dir: &Path) -> Option<String> {
    let path = dir.join(INSTALL_ID_FILE);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if valid_install_id(existing) {
            return Some(existing.to_string());
        }
    }
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).ok()?;
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(dir).ok()?;
    std::fs::write(&path, &id).ok()?;
    Some(id)
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

/// Keep error text short and free of the user's home folder.
fn clean_error(error: &str) -> String {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| home.to_string_lossy().to_string());
    clean_error_in(error, home.as_deref())
}

fn clean_error_in(error: &str, home: Option<&str>) -> String {
    let mut text = error.trim().to_string();
    if let Some(home) = home.filter(|home| home.len() > 1) {
        text = text.replace(home, "~");
    }
    text.chars().take(300).collect()
}

fn payload(
    event_type: &str,
    current_version: &str,
    install_id: &str,
    from_version: Option<&str>,
    to_version: Option<&str>,
    metadata: Value,
) -> Value {
    json!({
        "event_type": event_type,
        "platform": platform(),
        "current_version": current_version,
        "from_version": from_version,
        "to_version": to_version,
        "anonymous_install_id": install_id,
        "source": "desktop",
        "metadata": metadata,
    })
}

fn client() -> Result<reqwest::Client, String> {
    use rustls_platform_verifier::BuilderVerifierExt;
    // Explicit provider, like the other clients here, so the app's global
    // provider is untouched. Certificates are checked by the operating system.
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| e.to_string())?
    .with_platform_verifier()
    .map_err(|e| e.to_string())?
    .with_no_client_auth();
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

async fn send(
    app: &tauri::AppHandle,
    event_type: &str,
    from_version: Option<&str>,
    to_version: Option<&str>,
    metadata: Value,
) {
    // Development builds and tests never report.
    if cfg!(debug_assertions) || cfg!(test) || !enabled(app) {
        return;
    }
    let Some(dir) = data_dir(app) else { return };
    let Some(id) = install_id(&dir) else { return };
    let current = app.package_info().version.to_string();
    let body = payload(event_type, &current, &id, from_version, to_version, metadata);
    let Ok(client) = client() else { return };
    let _ = client.post(EVENTS_URL).json(&body).send().await;
}

fn pending_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    data_dir(app).map(|dir| dir.join(PENDING_FILE))
}

/// Report launches, and finish reporting an update that restarted the app.
pub(crate) fn launch(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let current = app.package_info().version.to_string();
        if let Some(path) = pending_path(&app) {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let _ = std::fs::remove_file(&path);
                if let Ok(pending) = serde_json::from_str::<Value>(&text) {
                    let from = pending.get("from").and_then(Value::as_str);
                    let to = pending.get("to").and_then(Value::as_str);
                    if to == Some(current.as_str()) {
                        send(&app, "update_completed", from, to, json!({})).await;
                    }
                }
            }
        }
        send(&app, "app_launch", None, None, json!({})).await;
    });
}

pub(crate) async fn update_check(
    app: &tauri::AppHandle,
    to_version: Option<&str>,
    manual: bool,
) {
    let current = app.package_info().version.to_string();
    send(
        app,
        "update_check",
        Some(&current),
        to_version,
        json!({ "manual": manual, "available": to_version.is_some() }),
    )
    .await;
}

/// An install is starting. The restart that follows a good install cannot
/// report success, so the next launch does, using this record.
pub(crate) async fn update_started(app: &tauri::AppHandle, to_version: &str) {
    let current = app.package_info().version.to_string();
    if enabled(app) {
        if let Some(path) = pending_path(app) {
            let _ = std::fs::write(
                path,
                json!({ "from": current, "to": to_version }).to_string(),
            );
        }
    }
    send(app, "update_started", Some(&current), Some(to_version), json!({})).await;
}

pub(crate) async fn update_failed(
    app: &tauri::AppHandle,
    stage: &str,
    error: &str,
    to_version: Option<&str>,
    manual: bool,
) {
    if stage == "install" {
        if let Some(path) = pending_path(app) {
            let _ = std::fs::remove_file(path);
        }
    }
    let current = app.package_info().version.to_string();
    send(
        app,
        "update_failed",
        Some(&current),
        to_version,
        json!({ "stage": stage, "manual": manual, "error": clean_error(error) }),
    )
    .await;
}

#[tauri::command]
pub(crate) fn product_analytics_enabled(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    crate::require_main_window(&window)?;
    Ok(enabled(&app))
}

#[tauri::command]
pub(crate) fn set_product_analytics_enabled(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    crate::require_main_window(&window)?;
    set_enabled(&app, enabled)?;
    Ok(self::enabled(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_matches_what_the_events_endpoint_reads() {
        let body = payload(
            "update_failed",
            "0.4.7",
            "0123456789abcdef0123456789abcdef",
            Some("0.4.7"),
            Some("0.4.8"),
            json!({ "stage": "install", "manual": false, "error": "x" }),
        );
        assert_eq!(body["event_type"], "update_failed");
        assert_eq!(body["current_version"], "0.4.7");
        assert_eq!(body["to_version"], "0.4.8");
        assert_eq!(body["anonymous_install_id"], "0123456789abcdef0123456789abcdef");
        assert_eq!(body["metadata"]["stage"], "install");
        assert!(["macos", "windows", "linux"].contains(&body["platform"].as_str().unwrap()));
    }

    #[test]
    fn the_install_id_is_created_once_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let first = install_id(dir.path()).unwrap();
        assert!(valid_install_id(&first));
        assert_eq!(install_id(dir.path()).unwrap(), first);
        std::fs::write(dir.path().join(INSTALL_ID_FILE), "not an id").unwrap();
        assert!(valid_install_id(&install_id(dir.path()).unwrap()));
    }

    #[test]
    fn a_marker_file_turns_analytics_off() {
        let dir = tempfile::tempdir().unwrap();
        assert!(dir_enabled(dir.path()));
        std::fs::write(dir.path().join(DISABLED_FILE), b"off").unwrap();
        assert!(!dir_enabled(dir.path()));
    }

    #[test]
    fn errors_are_short_and_do_not_include_the_home_folder() {
        let text = clean_error_in("failed at /Users/someone/Library/x", Some("/Users/someone"));
        assert_eq!(text, "failed at ~/Library/x");
        assert_eq!(clean_error_in(&"a".repeat(1000), None).len(), 300);
    }

    /// Needs the network: proves the TLS setup reaches the site over HTTPS.
    /// Run with `cargo test --lib product_events -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn the_client_can_reach_the_site_over_https() {
        let response = client().unwrap().get("https://www.blackcrab.app/").send().await.unwrap();
        assert!(response.status().is_success());
    }
}
