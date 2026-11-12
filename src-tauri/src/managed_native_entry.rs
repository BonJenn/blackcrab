//! Main-window product entry. All package locations and trust come from native bundle config.
use crate::{
    managed_host::ManagedHost,
    managed_payload::{EmbeddedPayload, PayloadRole},
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeDesktopStatus {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
fn status(state: &'static str, error: Option<String>) -> NativeDesktopStatus {
    NativeDesktopStatus { state, error }
}
fn unavailable() -> String {
    "Full desktop is unavailable in this installation.".into()
}
#[derive(Clone, Copy, Default)]
struct Pins<'a> {
    host_manifest: Option<&'a str>,
    host_archive: Option<&'a str>,
    desktop_manifest: Option<&'a str>,
    desktop_archive: Option<&'a str>,
}
pub(crate) struct ManagedNativeEntry {
    host: Option<EmbeddedPayload>,
    desktop: Option<EmbeddedPayload>,
    error: Option<String>,
    desktop_manifest: Option<String>,
    desktop_archive_path: Option<PathBuf>,
    desktop_configured: bool,
    #[cfg(target_os = "macos")]
    owner: crate::managed_desktop::NativeDesktopOwner,
}
fn payload(
    role: PayloadRole,
    resources: &Path,
    cache: &Path,
    manifest: Option<&str>,
    archive: Option<&str>,
) -> Result<Option<EmbeddedPayload>, String> {
    match (manifest, archive) {
        (None, None) => Ok(None),
        (Some(manifest), Some(archive)) => {
            let name = match role {
                PayloadRole::Host => "managed-host-payload.tar.gz",
                PayloadRole::Desktop => "managed-desktop-payload.tar.gz",
            };
            let path = resources.join(name);
            let metadata = fs::symlink_metadata(&path).map_err(|_| unavailable())?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(unavailable());
            }
            EmbeddedPayload::new(
                role,
                path,
                archive.into(),
                manifest.into(),
                cache.to_path_buf(),
            )
            .map(Some)
        }
        _ => Err(unavailable()),
    }
}
impl ManagedNativeEntry {
    pub(crate) fn from_bundled_paths(resources: &Path, app_data: &Path) -> Self {
        Self::from_inputs(
            resources,
            app_data,
            Pins {
                host_manifest: option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256"),
                host_archive: option_env!("BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256"),
                desktop_manifest: option_env!("BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256"),
                desktop_archive: option_env!("BLACKCRAB_EMBEDDED_DESKTOP_ARCHIVE_SHA256"),
            },
        )
    }
    fn from_inputs(resources: &Path, app_data: &Path, pins: Pins<'_>) -> Self {
        let configured = pins.host_manifest.is_some()
            || pins.host_archive.is_some()
            || pins.desktop_manifest.is_some()
            || pins.desktop_archive.is_some();
        let mut entry = Self {
            host: None,
            desktop: None,
            error: None,
            desktop_manifest: pins.desktop_manifest.map(str::to_owned),
            desktop_archive_path: None,
            desktop_configured: pins.desktop_manifest.is_some() || pins.desktop_archive.is_some(),
            #[cfg(target_os = "macos")]
            owner: Default::default(),
        };
        if !configured || !cfg!(unix) {
            return entry;
        }
        let cache = app_data.join("managed-payloads-v1");
        if fs::create_dir_all(app_data).is_err() {
            entry.error = Some(unavailable());
            return entry;
        }
        // Host packaging is independent: a missing bundled default never overrides a selected runtime.
        entry.host = payload(
            PayloadRole::Host,
            resources,
            &cache,
            pins.host_manifest,
            pins.host_archive,
        )
        .ok()
        .flatten();
        match payload(
            PayloadRole::Desktop,
            resources,
            &cache,
            pins.desktop_manifest,
            pins.desktop_archive,
        ) {
            Ok(value) => {
                if value.is_some() {
                    entry.desktop_archive_path =
                        Some(resources.join("managed-desktop-payload.tar.gz"));
                }
                entry.desktop = value;
            }
            Err(_) => entry.error = Some(unavailable()),
        }
        entry
    }
    pub(crate) fn bundled_host(&self) -> Option<EmbeddedPayload> {
        self.host.clone()
    }
    fn metadata_status(&self) -> NativeDesktopStatus {
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            return status("unsupported", None);
        }
        if !self.desktop_configured {
            return status("notBundled", None);
        }
        if let Some(error) = &self.error {
            return status("unavailable", Some(error.clone()));
        }
        if self.desktop_archive_path.as_ref().is_some_and(|path| {
            fs::symlink_metadata(path)
                .map(|m| !m.is_file() || m.file_type().is_symlink())
                .unwrap_or(true)
        }) {
            return status("unavailable", Some(unavailable()));
        }
        match &self.desktop {
            Some(_) => status("ready", None),
            None => status("unavailable", Some(unavailable())),
        }
    }

    pub(crate) async fn status(&self) -> NativeDesktopStatus {
        let current = self.metadata_status();
        if current.state != "ready" {
            return current;
        }
        #[cfg(target_os = "macos")]
        {
            match self.owner.running().await {
                Ok(true) => return status("running", None),
                Ok(false) => {}
                Err(_) => return status("unavailable", Some(unavailable())),
            }
        }
        current
    }
    pub(crate) async fn open(&self, host: ManagedHost) -> NativeDesktopStatus {
        let current = self.metadata_status();
        if current.state != "ready" {
            return current;
        }
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            let payload = self.desktop.as_ref().unwrap().clone();
            let manifest = self.desktop_manifest.as_ref().unwrap().clone();
            let verified = tokio::task::spawn_blocking(move || payload.ensure_verified()).await;
            let root = match verified {
                Ok(Ok(root)) => root,
                _ => return status("unavailable", Some(unavailable())),
            };
            if self.owner.open(host, root, manifest).await.is_err() {
                return status("unavailable", Some(unavailable()));
            }
            return self.status().await;
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            let _ = host;
            status("unsupported", None)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absent_and_partial_trust_do_not_invent_runtime() {
        let root = std::env::temp_dir().join("blackcrab-unconfigured-entry-never-created");
        let empty = ManagedNativeEntry::from_inputs(&root, &root, Pins::default());
        assert!(empty.bundled_host().is_none());
        assert!(!root.exists());
        let partial = payload(PayloadRole::Host, &root, &root, Some(&"a".repeat(64)), None);
        assert!(partial.is_err());
    }
    #[tokio::test]
    async fn unsupported_or_absent_status_does_not_launch() {
        let root = std::env::temp_dir().join("blackcrab-unconfigured-entry-no-launch");
        let entry = ManagedNativeEntry::from_inputs(&root, &root, Pins::default());
        let expected = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "notBundled"
        } else {
            "unsupported"
        };
        assert_eq!(entry.status().await.state, expected);
        assert_eq!(
            entry.open(ManagedHost::new(root.clone())).await.state,
            expected
        );
        assert!(!root.exists());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn fixed_resources_and_all_pins_produce_metadata_only_ready_state() {
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let base = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "blackcrab-native-entry-{}",
            u64::from_le_bytes(nonce)
        ));
        fs::create_dir(&base).unwrap();
        let resources = base.join("resources");
        fs::create_dir(&resources).unwrap();
        for name in [
            "managed-host-payload.tar.gz",
            "managed-desktop-payload.tar.gz",
        ] {
            fs::write(resources.join(name), b"unparsed during status").unwrap();
        }
        let digest = "a".repeat(64);
        let entry = ManagedNativeEntry::from_inputs(
            &resources,
            &base.join("app-data"),
            Pins {
                host_manifest: Some(&digest),
                host_archive: Some(&digest),
                desktop_manifest: Some(&digest),
                desktop_archive: Some(&digest),
            },
        );
        assert!(entry.bundled_host().is_some());
        assert!(!entry.host.as_ref().unwrap().target_directory().exists());
        assert!(!entry.desktop.as_ref().unwrap().target_directory().exists());
        let expected = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "ready"
        } else {
            "unsupported"
        };
        assert_eq!(entry.status().await.state, expected);
        fs::remove_file(resources.join("managed-desktop-payload.tar.gz")).unwrap();
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            assert_eq!(entry.status().await.state, "unavailable");
        }
        assert!(!entry.host.as_ref().unwrap().target_directory().exists());
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn desktop_and_host_bundle_flags_are_independent() {
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let base = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "blackcrab-independent-payloads-{}",
            u64::from_le_bytes(nonce)
        ));
        fs::create_dir(&base).unwrap();
        for file in [
            "managed-desktop-payload.tar.gz",
            "managed-host-payload.tar.gz",
        ] {
            fs::write(base.join(file), b"metadata only").unwrap();
        }
        let digest = "a".repeat(64);
        let host_only = ManagedNativeEntry::from_inputs(
            &base,
            &base.join("host-app"),
            Pins {
                host_manifest: Some(&digest),
                host_archive: Some(&digest),
                ..Pins::default()
            },
        );
        assert!(host_only.bundled_host().is_some());
        let desktop_only = ManagedNativeEntry::from_inputs(
            &base,
            &base.join("desktop-app"),
            Pins {
                desktop_manifest: Some(&digest),
                desktop_archive: Some(&digest),
                ..Pins::default()
            },
        );
        assert!(desktop_only.bundled_host().is_none());
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            assert_eq!(host_only.status().await.state, "notBundled");
            assert_eq!(desktop_only.status().await.state, "ready");
        }
        fs::remove_dir_all(base).unwrap();
    }
}
