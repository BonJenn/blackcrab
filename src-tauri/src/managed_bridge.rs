//! Only macOS is enabled: wry's WKScriptMessage.frameInfo().request().URL()
//! supplies the invoking frame URI to Tauri's remote ACL (not renderer JSON).
//! A grant has a unique native window label; capabilities never reuse labels across origins.
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Grant {
    pub origin: String,
    pub environment_id: String,
    generation: String,
}
impl Grant {
    pub fn window_label(&self) -> String {
        format!("managed-workspace-{}", self.generation)
    }
    pub fn new(origin: &url::Url, environment_id: String) -> Result<Self, String> {
        if origin.scheme() != "http"
            || origin.host_str() != Some("127.0.0.1")
            || origin.port().is_none()
        {
            return Err("Invalid managed bridge origin".into());
        }
        let mut random = [0u8; 32];
        getrandom::getrandom(&mut random).map_err(|_| "Managed bridge entropy unavailable")?;
        Ok(Self {
            origin: origin.origin().ascii_serialization(),
            environment_id,
            generation: random.iter().map(|b| format!("{b:02x}")).collect(),
        })
    }
}

pub(crate) fn install_capability(app: &AppHandle, grant: &Grant) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Managed native bridge is not verified on this platform".into());
    }
    app.add_capability(capability(grant).to_string())
        .map_err(|_| "Could not authorize managed bridge".into())
}
fn capability(grant: &Grant) -> serde_json::Value {
    serde_json::json!({
        "identifier": format!("managed-native-{}", grant.generation),
        "local": false,
        "windows": [grant.window_label()],
        "remote": {"urls": [format!("{}/*", grant.origin)]},
        "permissions": ["managed-native"]
    })
}
pub(crate) fn initialization_script(grant: &Grant) -> Result<String, String> {
    let encoded =
        serde_json::to_string(grant).map_err(|_| "Could not initialize managed bridge")?;
    Ok(format!(
        r#"(() => {{
      const grant = {encoded};
      if (window !== window.top || location.origin !== grant.origin) return;
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== 'function') return;
      const generation = grant.generation;
      Object.defineProperty(window, 'blackcrabNative', {{ configurable: false, writable: false,
        value: Object.freeze({{
          apiVersion: 1,
          pickFolder: Object.freeze((options) => invoke('managed_native_pick_folder', {{ generation, options: options ?? null }})),
          openExternal: Object.freeze((url) => invoke('managed_native_open_external', {{ generation, url }})),
          pickProjectFavicon: Object.freeze((options) => invoke('managed_native_pick_project_favicon', {{ generation, options: options ?? null }}))
        }}) }});
    }})();"#
    ))
}
fn authorize(label: &str, url: &url::Url, generation: &str, current: &Grant) -> Result<(), String> {
    if !cfg!(target_os = "macos")
        || label != current.window_label()
        || url.origin().ascii_serialization() != current.origin
        || generation != current.generation
    {
        return Err("Managed native access denied".into());
    }
    Ok(())
}
async fn caller(
    window: &WebviewWindow,
    host: &crate::managed_host::ManagedHost,
    generation: &str,
) -> Result<Grant, String> {
    let grant = host.bridge_grant()?;
    authorize(
        window.label(),
        &window.url().map_err(|_| "Managed window unavailable")?,
        generation,
        &grant,
    )?;
    host.validate_bridge(&grant).await?;
    Ok(grant)
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PickOptions {
    initial_path: Option<String>,
    target_environment_id: Option<String>,
}
fn picker_path(options: &PickOptions, grant: &Grant) -> Result<Option<std::path::PathBuf>, String> {
    if options
        .target_environment_id
        .as_ref()
        .is_some_and(|id| id != &grant.environment_id)
    {
        return Err("Folder selection requires the local managed environment".into());
    }
    match &options.initial_path {
        None => Ok(None),
        Some(path)
            if path.len() <= 4096
                && !path.chars().any(char::is_control)
                && std::path::Path::new(path).is_absolute() =>
        {
            Ok(Some(path.into()))
        }
        _ => Err("Invalid initial folder path".into()),
    }
}
fn external_url(input: &str) -> Result<String, String> {
    if input.len() > 16384 || input.chars().any(char::is_control) {
        return Err("Invalid external URL".into());
    }
    let url = url::Url::parse(input).map_err(|_| "Invalid external URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("External URL must use HTTP or HTTPS without credentials".into());
    }
    Ok(url.into())
}
fn open_validated<T>(
    input: &str,
    open: impl FnOnce(String) -> Result<T, String>,
) -> Result<T, String> {
    open(external_url(input)?)
}
#[tauri::command]
pub(crate) async fn managed_native_open_external(
    window: WebviewWindow,
    host: State<'_, crate::managed_host::ManagedHost>,
    generation: String,
    url: String,
) -> Result<bool, String> {
    caller(&window, &host, &generation).await?;
    open_validated(&url, |url| {
        window
            .app_handle()
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|_| "Could not open external URL")?;
        Ok(true)
    })
}
#[tauri::command]
pub(crate) async fn managed_native_pick_folder(
    window: WebviewWindow,
    host: State<'_, crate::managed_host::ManagedHost>,
    generation: String,
    options: Option<PickOptions>,
) -> Result<Option<String>, String> {
    let grant = caller(&window, &host, &generation).await?;
    let path = picker_path(&options.unwrap_or_default(), &grant)?;
    let mut dialog = window.app_handle().dialog().file().set_parent(&window);
    if let Some(path) = path {
        dialog = dialog.set_directory(path);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_folder(move |selected| {
        let _ = tx.send(selected);
    });
    let selected = rx.await.map_err(|_| "Folder selection unavailable")?;
    // A dialog can outlive a host restart or a window reconnect.
    caller(&window, &host, &generation).await?;
    selected
        .map(|p| {
            p.into_path()
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|_| "Selected folder is not local".into())
        })
        .transpose()
}

// Pinned packages/shared/src/projectFavicon.ts plus mediaPreview.ts. The native
// filter is advisory: selected paths are validated independently before return.
const FAVICON_EXTENSIONS: &[&str] = &[
    "avif", "bmp", "gif", "ico", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff",
    "webp", "icns",
];
fn selected_favicon(path: std::path::PathBuf) -> Result<String, String> {
    let text = path
        .to_str()
        .ok_or("Selected image path is not valid UTF-8")?;
    if !path.is_absolute()
        || text.len() > 4096
        || text.chars().any(char::is_control)
        || !path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|extension| {
                FAVICON_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
            })
    {
        return Err("Selected image has an unsupported local path or extension".into());
    }
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| "Selected image is unavailable")?;
    if !metadata.file_type().is_file() {
        return Err("Select a regular local image file".into());
    }
    // This returns a user-selected path only. Existing authenticated project
    // update and asset handling perform their own validation and image decoding.
    Ok(text.into())
}
#[tauri::command]
pub(crate) async fn managed_native_pick_project_favicon(
    window: WebviewWindow,
    host: State<'_, crate::managed_host::ManagedHost>,
    generation: String,
    options: Option<PickOptions>,
) -> Result<Option<String>, String> {
    let grant = caller(&window, &host, &generation).await?;
    let path = picker_path(&options.unwrap_or_default(), &grant)?;
    let mut dialog = window
        .app_handle()
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Images", FAVICON_EXTENSIONS);
    if let Some(path) = path {
        dialog = dialog.set_directory(path);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |selected| {
        let _ = tx.send(selected);
    });
    let selected = rx.await.map_err(|_| "Image selection unavailable")?;
    caller(&window, &host, &generation).await?;
    selected
        .map(|p| {
            p.into_path()
                .map_err(|_| "Selected image is not local".to_string())
                .and_then(selected_favicon)
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn grant() -> Grant {
        Grant::new(
            &url::Url::parse("http://127.0.0.1:43123/").unwrap(),
            "env_fixture".into(),
        )
        .unwrap()
    }
    #[test]
    fn selected_icons_validate_extensions_and_file_type_independently_of_dialog() {
        let root = std::env::temp_dir().join(format!("blackcrab-icon-test-{}", grant().generation));
        std::fs::create_dir(&root).unwrap();
        for extension in FAVICON_EXTENSIONS {
            let path = root.join(format!("icon.{}", extension.to_uppercase()));
            std::fs::write(
                &path,
                b"fixture; decoding belongs to the existing asset server",
            )
            .unwrap();
            assert_eq!(
                selected_favicon(path.clone()).unwrap(),
                path.to_str().unwrap()
            );
        }
        let invalid = root.join("secret.txt");
        std::fs::write(&invalid, b"not an image").unwrap();
        assert!(selected_favicon(invalid.clone()).is_err());
        let directory = root.join("directory.png");
        std::fs::create_dir(&directory).unwrap();
        assert!(selected_favicon(directory).is_err());
        assert!(selected_favicon(root.join("missing.png")).is_err());
        assert!(selected_favicon(std::path::PathBuf::from("relative.png")).is_err());
        assert!(selected_favicon(root.join("bad\n.png")).is_err());
        #[cfg(unix)]
        {
            let link = root.join("linked.png");
            std::os::unix::fs::symlink(invalid, &link).unwrap();
            assert!(selected_favicon(link).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn urls_fail_closed_before_side_effects() {
        for url in [
            "file:///tmp/x",
            "javascript:alert(1)",
            "https://user:pass@example.com",
            "https://example.com\n",
            "//example.com",
            "data:text/plain,x",
        ] {
            let mut opened = false;
            assert!(open_validated(url, |_| {
                opened = true;
                Ok(())
            })
            .is_err());
            assert!(!opened, "{url}");
        }
        assert_eq!(
            external_url("https://example.com/a?b=c#d").unwrap(),
            "https://example.com/a?b=c#d"
        );
    }
    #[test]
    fn picker_is_local_and_bounded() {
        let g = grant();
        assert!(picker_path(&PickOptions::default(), &g).unwrap().is_none());
        for id in ["env_remote", "wsl:default", "__primary__"] {
            assert!(picker_path(
                &PickOptions {
                    target_environment_id: Some(id.into()),
                    initial_path: None
                },
                &g
            )
            .is_err());
        }
        assert!(picker_path(
            &PickOptions {
                target_environment_id: Some(g.environment_id.clone()),
                initial_path: Some("/tmp".into())
            },
            &g
        )
        .is_ok());
        assert!(picker_path(
            &PickOptions {
                initial_path: Some("relative".into()),
                ..Default::default()
            },
            &g
        )
        .is_err());
    }
    #[test]
    fn authorization_requires_current_unique_window_generation() {
        let g = grant();
        let url = url::Url::parse(&g.origin).unwrap();
        let label = g.window_label();
        assert!(authorize("main", &url, &g.generation, &g).is_err());
        assert!(authorize("managed-workspace", &url, &g.generation, &g).is_err());
        assert!(authorize(&label, &url, "old", &g).is_err());
        let old = grant();
        assert!(authorize(&old.window_label(), &url, &g.generation, &g).is_err());
        assert!(authorize(
            &label,
            &url::Url::parse("http://127.0.0.1:43124/").unwrap(),
            &g.generation,
            &g
        )
        .is_err());
        for origin in [
            "http://localhost:43123/",
            "https://127.0.0.1:43123/",
            "http://example.com:43123/",
        ] {
            assert!(
                authorize(&label, &url::Url::parse(origin).unwrap(), &g.generation, &g).is_err()
            );
        }
        assert_eq!(
            authorize(&label, &url, &g.generation, &g).is_ok(),
            cfg!(target_os = "macos")
        );
    }
    #[test]
    fn remote_capability_has_exact_unique_window_and_no_dynamic_scopes() {
        let g = grant();
        let cap = capability(&g);
        assert_eq!(cap["local"], false);
        assert_eq!(cap["windows"], serde_json::json!([g.window_label()]));
        assert_eq!(
            cap["remote"]["urls"],
            serde_json::json!([format!("{}/*", g.origin)])
        );
        assert_eq!(cap["permissions"], serde_json::json!(["managed-native"]));
        let other = grant();
        assert_ne!(cap["windows"], capability(&other)["windows"]);
        // Dynamic scopes are deliberately absent: installed Tauri reuses scope IDs
        // when adding capabilities and can merge scope data from other grants.
        assert!(cap["permissions"][0].is_string());
    }
    #[test]
    fn main_permission_keeps_all_existing_handlers_local() {
        let source = include_str!("lib.rs");
        let handlers = source
            .split(".invoke_handler(tauri::generate_handler![")
            .nth(1)
            .unwrap()
            .split("])")
            .next()
            .unwrap();
        let expected: Vec<_> = handlers
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.rsplit("::").next().unwrap())
            .collect();
        let permission = include_str!("../permissions/app.toml");
        let list = permission
            .lines()
            .find_map(|s| s.strip_prefix("commands.allow = "))
            .unwrap();
        let actual: Vec<String> = serde_json::from_str(list).unwrap();
        assert_eq!(actual, expected);
        let main: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert_eq!(main["windows"], serde_json::json!(["main"]));
        assert!(main.get("remote").is_none());
        assert!(main["permissions"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("main-app-commands")));
    }
    #[test]
    fn script_is_separate_frozen_and_main_frame_only() {
        let script = initialization_script(&grant()).unwrap();
        assert!(script.contains("Object.freeze"));
        assert!(script.contains("window !== window.top"));
        assert!(!script.contains("desktopBridge"));
        assert!(!script.contains("token="));
    }
}
