//! Root owns startup/recovery only; the managed client is the desktop UI.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub(crate) struct LauncherState {
    monitoring: AtomicBool,
    view_epoch: AtomicU64,
    monitor_epoch: AtomicU64,
}
impl LauncherState {
    pub(crate) fn pause_for_update(&self) {
        self.monitor_epoch.fetch_add(1, Ordering::SeqCst);
        self.monitoring.store(false, Ordering::SeqCst);
    }
    pub(crate) fn has_workspace(&self) -> bool { self.monitoring.load(Ordering::SeqCst) }
}

pub(crate) fn show(app: &tauri::AppHandle, event: &str) {
    if event != "blackcrab-open-workspace" {
        app.state::<LauncherState>().view_epoch.fetch_add(1, Ordering::SeqCst);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit(event, ());
    }
}

#[tauri::command]
pub(crate) async fn managed_launcher_handoff(
    window: tauri::WebviewWindow, app: tauri::AppHandle,
) -> Result<(), String> {
    crate::require_main_window(&window)?;
    #[cfg(target_os = "macos")]
    {
        let view_epoch = app.state::<LauncherState>().view_epoch.load(Ordering::SeqCst);
        let entry = app.state::<crate::managed_native_entry::ManagedNativeEntry>();
        // A live process is not yet a window. Give AppKit time to register it;
        // keep recovery visible if activation never becomes possible.
        let mut activated = false;
        for _ in 0..60 {
            if entry.activate(&app).await? { activated = true; break; }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        if !activated { return Err("The workspace window is not ready. Try again.".into()); }
        if app.state::<LauncherState>().view_epoch.load(Ordering::SeqCst) != view_epoch {
            return Err("Workspace settings are open.".into());
        }
        window.hide().map_err(|_| "Could not finish opening the workspace")?;
        if !app.state::<LauncherState>().monitoring.swap(true, Ordering::SeqCst) {
            let monitor_epoch = app.state::<LauncherState>().monitor_epoch.load(Ordering::SeqCst);
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    if handle.state::<LauncherState>().monitor_epoch.load(Ordering::SeqCst) != monitor_epoch { return; }
                    let result = handle.state::<crate::managed_native_entry::ManagedNativeEntry>()
                        .client_exit().await;
                    // An install may pause this monitor while the child lock
                    // is awaited, including an install that already failed.
                    if handle.state::<LauncherState>().monitor_epoch.load(Ordering::SeqCst) != monitor_epoch { return; }
                    match result {
                        Ok(None) => continue,
                        // Quit in the workspace also quits its hidden launcher.
                        // The independently owned background service is retained.
                        Ok(Some(true)) if !crate::managed_updates::installing(&handle) => { handle.exit(0); return; }
                        Ok(Some(_)) if crate::managed_updates::installing(&handle) => {
                            handle.state::<LauncherState>().monitoring.store(false, Ordering::SeqCst);
                            return;
                        }
                        _ => {
                            handle.state::<LauncherState>().monitoring.store(false, Ordering::SeqCst);
                            show(&handle, "blackcrab-workspace-failed");
                            return;
                        }
                    }
                }
            });
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Err("This workspace is currently available on Apple-silicon Macs.".into()) }
}
