//! Isolated managed workspaces. Legacy execution/pairing data is never opened here.
use crate::managed_artifact::{self, VerifiedArtifact};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

#[path = "managed_desktop_policy.rs"]
pub(super) mod desktop_policy;
use self::desktop_policy::{native_pair_expiry, valid_native_pair};

const MARKER: &str = "blackcrab-managed-host-v1\n";
const MAX_JSON: u64 = 1024 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostStatus {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    artifact_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    environment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Configuration {
    schema: u32,
    artifact_path: PathBuf,
    manifest_digest: String,
    bootstrap_secret: String,
    environment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    browser: Option<crate::managed_browser::Capability>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeRecord {
    version: u32,
    origin: String,
    port: u16,
}
struct ReapChild(Option<std::process::Child>);
impl ReapChild {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.0.as_mut().unwrap().try_wait()
    }
}
impl Drop for ReapChild {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
    }
}
struct Attached {
    origin: url::Url,
    environment_id: String,
}
enum Probe {
    Stopped,
    Attached(Attached),
}

/// Internal native-client authority. Never serialized with owner credentials.
#[allow(dead_code)]
#[derive(Clone, PartialEq, Eq)]
pub(super) struct DesktopHostBinding {
    pub(super) generation: u64,
    pub(super) environment_id: String,
    pub(super) origin: String,
    pub(super) browser: Option<crate::managed_browser::Capability>,
}
#[allow(dead_code)]
pub(super) struct DesktopPairGrant {
    pub(super) credential: String,
    pub(super) expires_at: u64,
}
#[derive(Default)]
struct DesktopEpoch {
    generation: u64,
    binding: Option<DesktopHostBinding>,
}
impl DesktopEpoch {
    fn invalidate(&mut self) -> Result<(), String> {
        let mut bytes = [0u8; 8];
        getrandom::getrandom(&mut bytes).map_err(|_| "Native owner entropy unavailable")?;
        let next = (u64::from_le_bytes(bytes) & 9_007_199_254_740_991).max(1);
        self.generation = if next == self.generation {
            next % 9_007_199_254_740_991 + 1
        } else {
            next
        };
        self.binding = None;
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct ManagedHost {
    root: PathBuf,
    bundled_payload: Option<crate::managed_payload::EmbeddedPayload>,
    operation: Arc<Mutex<()>>,
    desktop: Arc<StdMutex<DesktopEpoch>>,
    navigation: Arc<StdMutex<Option<url::Origin>>>,
    bridge: Arc<StdMutex<Option<crate::managed_bridge::Grant>>>,
}
impl ManagedHost {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            bundled_payload: None,
            operation: Arc::new(Mutex::new(())),
            desktop: Arc::new(StdMutex::new(DesktopEpoch::default())),
            navigation: Arc::new(StdMutex::new(None)),
            bridge: Arc::new(StdMutex::new(None)),
        }
    }

    pub(crate) fn with_bundled_payload(
        mut self,
        payload: crate::managed_payload::EmbeddedPayload,
    ) -> Self {
        self.bundled_payload = Some(payload);
        self
    }

    pub(crate) async fn status(&self) -> HostStatus {
        let _operation = self.operation.lock().await;
        let result = self.status_inner().await;
        match result {
            Ok(status) => status,
            Err(error) => HostStatus {
                state: "unavailable",
                artifact_path: None,
                environment_id: None,
                error: Some(error),
            },
        }
    }
    async fn status_inner(&self) -> Result<HostStatus, String> {
        self.prepare()?;
        let _lease = self.lease().await?;
        self.initialize_locked()?;
        let Some(config) = self.read_config()? else {
            return Ok(match &self.bundled_payload {
                Some(payload) => HostStatus {
                    state: "stopped",
                    artifact_path: Some(payload.target_directory().to_string_lossy().into_owned()),
                    environment_id: None,
                    error: None,
                },
                None => status("notConfigured", None),
            });
        };
        self.verify_configured(&config).await?;
        match self.probe(&config).await? {
            Probe::Stopped => Ok(status("stopped", Some(&config))),
            Probe::Attached(_) => Ok(status("running", Some(&config))),
        }
    }
    pub(crate) async fn start(&self, artifact: Option<PathBuf>) -> Result<HostStatus, String> {
        let _operation = self.operation.lock().await;
        let _attached = self.ensure_started(artifact).await?;
        let config = self
            .read_config()?
            .ok_or("Managed host configuration disappeared")?;
        Ok(status("running", Some(&config)))
    }
    /// Credentials stay in Rust; only this native command constructs a window URL.
    pub(crate) async fn window_url(&self) -> Result<url::Url, String> {
        let _operation = self.operation.lock().await;
        let attached = self.ensure_started(None).await?;
        let config = self
            .read_config()?
            .ok_or("Managed host configuration disappeared")?;
        let mut bridge = self
            .bridge
            .lock()
            .map_err(|_| "Managed bridge unavailable")?;
        if !bridge.as_ref().is_some_and(|g| {
            g.origin == attached.origin.origin().ascii_serialization()
                && g.environment_id == attached.environment_id
        }) {
            *bridge = Some(crate::managed_bridge::Grant::new(
                &attached.origin,
                attached.environment_id,
            )?);
        }
        drop(bridge);
        let mut url = attached.origin;
        *self
            .navigation
            .lock()
            .map_err(|_| "Managed window navigation state is unavailable")? = Some(url.origin());
        url.set_fragment(Some(&format!(
            "token={}",
            bootstrap_token(&config.bootstrap_secret, now_ms()?)?
        )));
        Ok(url)
    }
    pub(crate) fn bridge_grant(&self) -> Result<crate::managed_bridge::Grant, String> {
        self.bridge
            .lock()
            .map_err(|_| "Managed bridge unavailable")?
            .clone()
            .ok_or_else(|| "Managed bridge unavailable".into())
    }
    pub(crate) async fn validate_bridge(
        &self,
        expected: &crate::managed_bridge::Grant,
    ) -> Result<(), String> {
        let _operation = self.operation.lock().await;
        if self.bridge_grant()? != *expected {
            return Err("Expired managed bridge".into());
        }
        let config = self.read_config()?.ok_or("Managed host unavailable")?;
        // window_url verified the artifact before issuing this grant. Rehashing
        // its entire payload for each click is unnecessary; authenticate the live
        // host and exact environment again, without starting/replacing a host.
        match self.probe(&config).await? {
            Probe::Attached(attached)
                if attached.origin.origin().ascii_serialization() == expected.origin
                    && attached.environment_id == expected.environment_id =>
            {
                Ok(())
            }
            _ => Err("Managed host identity changed".into()),
        }
    }
    /// Native launcher only: initial explicit launch may ensure an owned host is running.
    #[allow(dead_code)]
    pub(super) async fn desktop_binding(&self) -> Result<DesktopHostBinding, String> {
        let _operation = self.operation.lock().await;
        let attached = self.ensure_started(None).await?;
        if attached.origin.port().is_none() || !desktop_policy::uuid(&attached.environment_id) {
            return Err("Native host needs an explicit loopback port".into());
        }
        let browser = self
            .read_config()?
            .ok_or("Managed host unavailable")?
            .browser;
        #[cfg(unix)]
        if let Some(capability) = &browser {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
            loop {
                capability.validate(&self.root)?;
                if fs::symlink_metadata(&capability.path).is_ok() {
                    break;
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err(
                        "The managed host's private native browser listener is not ready".into(),
                    );
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
        let mut epoch = self
            .desktop
            .lock()
            .map_err(|_| "Native owner unavailable")?;
        let origin = attached.origin.as_str().to_owned();
        if !epoch.binding.as_ref().is_some_and(|b| {
            b.origin == origin
                && b.environment_id == attached.environment_id
                && b.browser == browser
        }) {
            epoch.invalidate()?;
            epoch.binding = Some(DesktopHostBinding {
                generation: browser
                    .as_ref()
                    .map_or(epoch.generation, |cap| cap.generation),
                environment_id: attached.environment_id,
                origin,
                browser,
            });
        }
        epoch
            .binding
            .clone()
            .ok_or_else(|| "Native owner unavailable".into())
    }
    #[allow(dead_code)]
    pub(super) fn desktop_profile_root(&self) -> PathBuf {
        self.root.join("native-desktop-profile-v1")
    }
    /// Renewal never starts/replaces a host and never returns the controller bearer/seed.
    #[allow(dead_code)]
    pub(super) async fn desktop_pair_grant(
        &self,
        expected: &DesktopHostBinding,
    ) -> Result<DesktopPairGrant, String> {
        let _operation = self.operation.lock().await;
        self.desktop_binding_current(expected)?;
        let config = self.read_config()?.ok_or("Managed host unavailable")?;
        match self.probe(&config).await? {
            Probe::Attached(a)
                if a.environment_id == expected.environment_id
                    && a.origin.as_str() == expected.origin => {}
            _ => return Err("Native host identity changed".into()),
        }
        let origin =
            url::Url::parse(&expected.origin).map_err(|_| "Invalid native owner origin")?;
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(io_error)?
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth();
        let http = reqwest::Client::builder()
            .tls_backend_preconfigured(tls)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| "Native owner HTTP unavailable")?;
        // Pinned AuthStandardClientScopes; no scope field is accepted from the client.
        let scopes = [
            "orchestration:read",
            "orchestration:operate",
            "settings:write",
            "providers:manage",
            "environment:maintain",
            "preview:operate",
            "diagnostics:read",
            "terminal:read",
            "terminal:operate",
            "source-control:write",
            "filesystem:read",
            "filesystem:write",
            "relay:read",
            "access:read",
            "access:write",
            "relay:write",
        ];
        let credential = bootstrap_token(&config.bootstrap_secret, now_ms()?)?;
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair(
                "grant_type",
                "urn:ietf:params:oauth:grant-type:token-exchange",
            )
            .append_pair("subject_token", &credential)
            .append_pair(
                "subject_token_type",
                "urn:t3:params:oauth:token-type:environment-bootstrap",
            )
            .append_pair(
                "requested_token_type",
                "urn:ietf:params:oauth:token-type:access_token",
            )
            .append_pair("scope", &scopes.join(" "))
            .append_pair("client_label", "Blackcrab native owner controller")
            .finish();
        let token = bounded_json(
            http.post(origin.join("oauth/token").map_err(io_error)?)
                .header("content-type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await
                .map_err(|_| "Native owner authentication failed")?,
        )
        .await
        .map_err(|_| "Native owner authentication refused")?;
        let bearer = token
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("Invalid owner session")?;
        let session = bounded_json(
            http.get(origin.join("api/auth/session").map_err(io_error)?)
                .bearer_auth(bearer)
                .send()
                .await
                .map_err(|_| "Owner session check failed")?,
        )
        .await
        .map_err(|_| "Owner session check refused")?;
        if session.get("authenticated") != Some(&Value::Bool(true)) {
            return Err("Owner session is not authenticated".into());
        }
        self.desktop_binding_current(expected)?;
        let paired = bounded_json(
            http.post(origin.join("api/auth/pairing-token").map_err(io_error)?)
                .bearer_auth(bearer)
                .json(&json!({"label":"Blackcrab Desktop","scopes":scopes}))
                .send()
                .await
                .map_err(|_| "Native pairing request failed")?,
        )
        .await
        .map_err(|_| "Native pairing request refused")?;
        self.desktop_binding_current(expected)?;
        let credential = paired
            .get("credential")
            .and_then(Value::as_str)
            .filter(|s| valid_native_pair(s))
            .ok_or("Invalid native pairing response")?
            .to_owned();
        let expires_at = paired
            .get("expiresAt")
            .and_then(Value::as_str)
            .and_then(native_pair_expiry)
            .ok_or("Invalid native pairing expiry")?;
        let now = now_ms()?;
        if expires_at <= now || expires_at > now.saturating_add(86_400_000) {
            return Err("Invalid native pairing lifetime".into());
        }
        Ok(DesktopPairGrant {
            credential,
            expires_at,
        })
    }
    pub(super) fn desktop_binding_current(
        &self,
        expected: &DesktopHostBinding,
    ) -> Result<(), String> {
        if self
            .desktop
            .lock()
            .map_err(|_| "Native owner unavailable")?
            .binding
            .as_ref()
            != Some(expected)
        {
            return Err("Expired native owner generation".into());
        }
        Ok(())
    }
    pub(crate) fn navigation_guard(&self) -> Arc<StdMutex<Option<url::Origin>>> {
        self.navigation.clone()
    }
    fn prepare(&self) -> Result<(), String> {
        let parent = self
            .root
            .parent()
            .ok_or("Managed host path has no parent")?;
        fs::create_dir_all(parent).map_err(io_error)?;
        real_directory(parent)?;
        if !self.root.exists() {
            fs::create_dir_all(&self.root).map_err(io_error)?;
            private_directory(&self.root)?;
        }
        real_directory(&self.root)?;
        if fs::symlink_metadata(self.root.join(".blackcrab-managed-host")).is_err()
            && fs::read_dir(&self.root).map_err(io_error)?.any(|entry| {
                entry
                    .map(|e| e.file_name() != "launcher.lock")
                    .unwrap_or(true)
            })
        {
            return Err("Managed host directory is not marked; refusing existing data".into());
        }
        Ok(())
    }
    fn initialize_locked(&self) -> Result<(), String> {
        let marker = self.root.join(".blackcrab-managed-host");
        if !marker.exists() {
            if fs::read_dir(&self.root).map_err(io_error)?.any(|entry| {
                entry
                    .map(|e| e.file_name() != "launcher.lock")
                    .unwrap_or(true)
            }) {
                return Err("Managed host directory is not marked; refusing existing data".into());
            }
            write_new(&marker, MARKER.as_bytes())?;
        }
        if read_small(&marker)? != MARKER.as_bytes() {
            return Err("Managed host directory marker differs".into());
        }
        private_directory(&self.root)?;
        let userdata = self.root.join("host/userdata");
        match fs::symlink_metadata(&userdata) {
            Ok(_) => real_directory(&userdata)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        for name in ["host", "logs"] {
            let directory = self.root.join(name);
            if !directory.exists() {
                fs::create_dir(&directory).map_err(io_error)?;
                private_directory(&directory)?;
            }
            real_directory(&directory)?;
        }
        Ok(())
    }
    async fn lease(&self) -> Result<File, String> {
        let path = self.root.join("launcher.lock");
        if path.exists() && !fs::symlink_metadata(&path).map_err(io_error)?.is_file() {
            return Err("Managed launcher lock is not a regular file".into());
        }
        let file = private_options()
            .read(true)
            .write(true)
            .create(true)
            .open(path)
            .map_err(io_error)?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
        loop {
            match file.try_lock() {
                Ok(()) => break,
                Err(std::fs::TryLockError::WouldBlock)
                    if tokio::time::Instant::now() < deadline =>
                {
                    tokio::time::sleep(Duration::from_millis(100)).await
                }
                Err(_) => {
                    return Err(
                        "Another Blackcrab client is configuring the managed host; retry shortly"
                            .into(),
                    )
                }
            }
        }
        Ok(file)
    }
    fn read_config(&self) -> Result<Option<Configuration>, String> {
        let file = self.root.join("configuration.json");
        if !file.exists() {
            return Ok(None);
        }
        let config: Configuration = serde_json::from_slice(&read_small(&file)?)
            .map_err(|_| "Managed host configuration is invalid")?;
        if ![1, 2].contains(&config.schema)
            || config.bootstrap_secret.len() != 64
            || !config
                .bootstrap_secret
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
            || config.manifest_digest.len() != 64
        {
            return Err("Managed host configuration is incompatible".into());
        }
        if let Some(capability) = &config.browser {
            if config.schema != 2 {
                return Err("Incompatible native browser configuration".into());
            }
            #[cfg(unix)]
            {
                if !native_browser_supported() {
                    return Err(
                        "The verified managed runtime does not support the native browser channel"
                            .into(),
                    );
                }
                capability.validate(&self.root)?;
            }
            #[cfg(not(unix))]
            return Err("Private native browser transport is unavailable on this platform".into());
        }
        Ok(Some(config))
    }
    fn save_config(&self, config: &Configuration) -> Result<(), String> {
        let temporary = self
            .root
            .join(format!(".configuration-{}", random_secret()?));
        write_new(&temporary, &serde_json::to_vec(config).map_err(io_error)?)?;
        let result = fs::rename(&temporary, self.root.join("configuration.json")).map_err(io_error);
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
    async fn verify_configured(&self, config: &Configuration) -> Result<VerifiedArtifact, String> {
        let path = config.artifact_path.clone();
        let artifact = tokio::task::spawn_blocking(move || managed_artifact::verify(&path))
            .await
            .map_err(io_error)??;
        if artifact.manifest_digest != config.manifest_digest {
            return Err("Managed runtime changed; choose and verify its package again while the host is stopped".into());
        }
        Ok(artifact)
    }
    async fn ensure_started(&self, selected: Option<PathBuf>) -> Result<Attached, String> {
        self.prepare()?;
        let _lease = self.lease().await?;
        self.initialize_locked()?;
        let mut config = self.read_config()?;
        if let Some(existing) = &mut config {
            match self.probe(existing).await? {
                Probe::Attached(attached) => {
                    self.verify_configured(existing).await?;
                    if selected.as_ref().is_some_and(|path| {
                        fs::canonicalize(path).ok().as_ref() != Some(&existing.artifact_path)
                    }) {
                        return Err(
                            "A managed host is already running; its runtime cannot be replaced"
                                .into(),
                        );
                    }
                    if existing.environment_id.is_none() {
                        existing.environment_id = Some(attached.environment_id.clone());
                        self.save_config(existing)?;
                    }
                    return Ok(attached);
                }
                Probe::Stopped => {}
            }
        }
        let artifact = if let Some(path) = selected {
            tokio::task::spawn_blocking(move || managed_artifact::verify(&path))
                .await
                .map_err(io_error)??
        } else if let Some(existing) = config.as_ref() {
            self.verify_configured(existing).await?
        } else if let Some(payload) = self.bundled_payload.clone() {
            tokio::task::spawn_blocking(move || {
                let root = payload.ensure_verified()?;
                managed_artifact::verify(&root)
            })
            .await
            .map_err(io_error)??
        } else {
            return Err("Choose a managed runtime package first".into());
        };
        if let Some(existing) = &mut config {
            existing.artifact_path = artifact.root.clone();
            existing.manifest_digest = artifact.manifest_digest.clone();
        } else {
            config = Some(Configuration {
                schema: 1,
                artifact_path: artifact.root.clone(),
                manifest_digest: artifact.manifest_digest.clone(),
                bootstrap_secret: random_secret()?,
                environment_id: None,
                browser: None,
            });
        }
        let mut config = config.unwrap();
        #[cfg(unix)]
        if native_browser_supported() {
            config.browser = Some(crate::managed_browser::Capability::allocate(&self.root)?);
            config.schema = 2;
        }
        self.save_config(&config)?;
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(io_error)?;
        let port = listener.local_addr().map_err(io_error)?.port();
        drop(listener);
        // A newly spawned host must never inherit a prior native window grant,
        // even if the OS reuses its old port and the environment ID is stable.
        *self
            .bridge
            .lock()
            .map_err(|_| "Managed bridge unavailable")? = None;
        self.desktop
            .lock()
            .map_err(|_| "Native owner unavailable")?
            .invalidate()?;
        let launched = self.spawn(&artifact, &config, port)?;
        #[cfg(feature = "managed-bridge-qa")]
        crate::managed_bridge_qa::record_captured_host(launched.id(), &self.root);
        let mut child = ReapChild(Some(launched));
        let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
        let result = loop {
            if let Some(exit) = child.try_wait().map_err(io_error)? {
                break Err(format!("Managed host exited ({exit}); inspect the managed host logs. It was not restarted automatically"));
            }
            match self.probe_at(&config, loopback_origin(port)?, true).await {
                Ok(Some(attached)) => {
                    if config.environment_id.is_none() {
                        config.environment_id = Some(attached.environment_id.clone());
                        self.save_config(&config)?;
                    }
                    break Ok(attached);
                }
                Ok(None) => {}
                Err(error) => break Err(error),
            }
            if tokio::time::Instant::now() >= deadline {
                break Err("Managed host did not become ready; its process was left intact for diagnosis and reconnect".into());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        };
        // Waiters reap only the exact child they created; no shutdown hook owns its lifetime.
        drop(child);
        result
    }
    fn spawn(
        &self,
        artifact: &VerifiedArtifact,
        config: &Configuration,
        port: u16,
    ) -> Result<std::process::Child, String> {
        if artifact.version != "0.1.7" {
            return Err("Managed runtime version is incompatible".into());
        }
        let log = self.root.join("logs/host.log");
        if log.exists() && !fs::symlink_metadata(&log).map_err(io_error)?.is_file() {
            return Err("Managed host log is not a regular file".into());
        }
        let stdout = private_options()
            .create(true)
            .append(true)
            .open(log)
            .map_err(io_error)?;
        let mut command = Command::new(&artifact.entry);
        command
            .args([
                "serve",
                "--mode",
                "web",
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--base-dir",
            ])
            .arg(self.root.join("host"))
            .args(["--no-browser", "--bootstrap-fd", "0"])
            .current_dir(&self.root)
            .stdin(Stdio::piped())
            .stdout(stdout.try_clone().map_err(io_error)?)
            .stderr(stdout);
        for (key, _) in std::env::vars_os() {
            let text = key.to_string_lossy();
            if ["T3CODE_", "VITE_", "OTEL_"]
                .iter()
                .any(|prefix| text.starts_with(prefix))
                || ["NODE_OPTIONS", "NODE_PATH"].contains(&text.as_ref())
            {
                command.env_remove(key);
            }
        }
        command
            .env("OTEL_SDK_DISABLED", "true")
            .env("T3CODE_DEV_SEED", "0");
        detach(&mut command);
        let mut child = command
            .spawn()
            .map_err(|_| "Could not launch the verified managed runtime".to_string())?;
        #[cfg(test)]
        eprintln!("BLACKCRAB_TEST_CHILD_PID={}", child.id());
        let mut bootstrap = json!({"mode":"desktop","noBrowser":true,"port":port,"t3Home":self.root.join("host"),"host":"127.0.0.1","desktopBootstrapToken":bootstrap_token(&config.bootstrap_secret, now_ms()?)?,"desktopBootstrapSecret":config.bootstrap_secret,"shellEnvironmentPrepared":false,"tailscaleServeEnabled":false,"tailscaleServePort":443});
        if let Some(capability) = &config.browser {
            bootstrap["desktopBrowserSocket"] =
                serde_json::to_value(capability).map_err(io_error)?;
        }
        if let Some(mut input) = child.stdin.take() {
            let mut bytes = serde_json::to_vec(&bootstrap).map_err(io_error)?;
            bytes.push(b'\n');
            if input.write_all(&bytes).is_err() {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Err("Managed host did not accept its private bootstrap pipe".into());
            }
        }
        Ok(child)
    }
    async fn probe(&self, config: &Configuration) -> Result<Probe, String> {
        let file = self.root.join("host/userdata/server-runtime.json");
        if !file.exists() {
            return Ok(Probe::Stopped);
        }
        let record: RuntimeRecord = serde_json::from_slice(&read_small(&file)?)
            .map_err(|_| "Managed host runtime record is invalid")?;
        let origin = validate_origin(&record.origin, record.port)?;
        if record.version != 1 {
            return Err("Managed host runtime record is incompatible".into());
        }
        Ok(match self.probe_at(config, origin, false).await? {
            Some(attached) => Probe::Attached(attached),
            None => Probe::Stopped,
        })
    }
    async fn probe_at(
        &self,
        config: &Configuration,
        origin: url::Url,
        starting: bool,
    ) -> Result<Option<Attached>, String> {
        // Use reqwest's explicitly selected provider-free rustls backend.
        // Configure this client explicitly, without changing the app's global provider.
        // Its URLs are validated HTTP loopback endpoints; no TLS roots are needed.
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(io_error)?
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth();
        let http = reqwest::Client::builder()
            .tls_backend_preconfigured(tls)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(io_error)?;
        let response = match http
            .get(
                origin
                    .join(".well-known/t3/environment")
                    .map_err(io_error)?,
            )
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) if error.is_connect() && !error.is_timeout() => return Ok(None),
            Err(_) => {
                return Err("Managed host is not responding; no replacement was started".into())
            }
        };
        // The pinned host serves 503 while initializing. Only our captured startup
        // may retry this response; an existing host is never replaced for it.
        if starting && response.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE {
            return Ok(None);
        }
        let descriptor = bounded_json(response).await?;
        let environment_id = validate_descriptor(&descriptor, config.environment_id.as_deref())?;
        // No bootstrap-derived credential is sent until this exact live endpoint
        // proves possession of the protected owner secret with a fresh challenge.
        let nonce = random_secret()?;
        let mut challenge = origin
            .join(".well-known/blackcrab/managed-host-proof")
            .map_err(io_error)?;
        challenge.query_pairs_mut().append_pair("nonce", &nonce);
        let proof = http
            .get(challenge)
            .send()
            .await
            .map_err(|_| HOST_PROOF_ERROR)?;
        let proof = bounded_json(proof).await.map_err(|_| HOST_PROOF_ERROR)?;
        verify_host_proof(
            &proof,
            &nonce,
            &environment_id,
            origin.as_str(),
            &config.bootstrap_secret,
        )?;
        let credential = bootstrap_token(&config.bootstrap_secret, now_ms()?)?;
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair(
                "grant_type",
                "urn:ietf:params:oauth:grant-type:token-exchange",
            )
            .append_pair("subject_token", &credential)
            .append_pair(
                "subject_token_type",
                "urn:t3:params:oauth:token-type:environment-bootstrap",
            )
            .append_pair(
                "requested_token_type",
                "urn:ietf:params:oauth:token-type:access_token",
            )
            .append_pair("scope", "orchestration:read")
            .append_pair("client_label", "Blackcrab host attachment")
            .finish();
        let response = http
            .post(origin.join("oauth/token").map_err(io_error)?)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| "Managed host authentication request failed")?;
        let grant = bounded_json(response).await.map_err(|_| {
            "Managed host rejected Blackcrab's attachment credential; no replacement was started"
        })?;
        let bearer = grant
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or("Managed host returned an invalid attachment grant")?;
        let session = http
            .get(origin.join("api/auth/session").map_err(io_error)?)
            .bearer_auth(bearer)
            .send()
            .await
            .map_err(|_| "Managed host session verification failed")?;
        if bounded_json(session).await?.get("authenticated") != Some(&Value::Bool(true)) {
            return Err("Managed host attachment session is not authenticated".into());
        }
        Ok(Some(Attached {
            origin,
            environment_id,
        }))
    }
}
#[cfg(unix)]
fn native_browser_supported() -> bool {
    // Only a fully verified artifact with every reviewed host delta may receive
    // the private capability. A proof9-only host never advertises this transport.
    let Ok(records) = serde_json::from_str::<Vec<Value>>(include_str!(
        "../../managed-host/patches/registry.json"
    )) else {
        return false;
    };
    (1..=10).all(|index| {
        records
            .iter()
            .any(|record| record["id"] == format!("native-browser-host-{index}"))
    })
}
fn status(state: &'static str, config: Option<&Configuration>) -> HostStatus {
    HostStatus {
        state,
        artifact_path: config.map(|c| c.artifact_path.to_string_lossy().into_owned()),
        environment_id: config.and_then(|c| c.environment_id.clone()),
        error: None,
    }
}
fn io_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io_error)?
        .as_millis() as u64)
}
fn random_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(io_error)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
const HOST_PROOF_ERROR: &str = "Managed host identity proof failed or is unavailable; rebuild the managed host package with identity-proof support. No attachment credential was sent and no replacement was started";
fn host_proof_mac(
    secret: &str,
    nonce: &str,
    environment: &str,
    origin: &str,
) -> Result<Hmac<Sha256>, String> {
    let message = serde_json::to_vec(&json!([
        "blackcrab-managed-host-proof-v1",
        nonce,
        environment,
        origin,
        "0.1.7",
        2
    ]))
    .map_err(|_| HOST_PROOF_ERROR)?;
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|_| HOST_PROOF_ERROR)?;
    mac.update(&message);
    Ok(mac)
}
fn verify_host_proof(
    value: &Value,
    nonce: &str,
    environment: &str,
    origin: &str,
    secret: &str,
) -> Result<(), String> {
    let fail = || HOST_PROOF_ERROR.to_owned();
    if value.as_object().map(|v| v.len()) != Some(7)
        || value["version"] != 1
        || value["nonce"] != nonce
        || value["environmentId"] != environment
        || value["origin"] != origin
        || value["serverVersion"] != "0.1.7"
        || value["orchestrationProtocolVersion"] != 2
    {
        return Err(fail());
    }
    let hex = value["proof"].as_str().ok_or_else(fail)?;
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(fail());
    }
    let bytes: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect();
    // Mac::verify_slice compares tags in constant time.
    host_proof_mac(secret, nonce, environment, origin)?
        .verify_slice(&bytes)
        .map_err(|_| fail())
}
fn bootstrap_token(secret: &str, now: u64) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(io_error)?;
    mac.update(format!("t3-desktop-bootstrap:{}", now / 43_200_000).as_bytes());
    Ok(mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
fn loopback_origin(port: u16) -> Result<url::Url, String> {
    validate_origin(&format!("http://127.0.0.1:{port}/"), port)
}
fn validate_origin(origin: &str, port: u16) -> Result<url::Url, String> {
    let url = url::Url::parse(origin).map_err(|_| "Invalid managed host origin")?;
    if port == 0
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port_or_known_default() != Some(port)
        || url.path() != "/"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Managed host origin must be its exact loopback endpoint".into());
    }
    Ok(url)
}
fn validate_descriptor(value: &Value, expected: Option<&str>) -> Result<String, String> {
    let id = value
        .get("environmentId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or("Managed host has no environment identity")?;
    if expected.is_some_and(|expected| expected != id) {
        return Err("Managed host environment identity changed; refusing attachment".into());
    }
    if value.get("serverVersion").and_then(Value::as_str) != Some("0.1.7")
        || value
            .get("orchestrationProtocolVersion")
            .and_then(Value::as_u64)
            != Some(2)
        || !value.get("capabilities").is_some_and(Value::is_object)
    {
        return Err("Managed host protocol or version is incompatible".into());
    }
    Ok(id.to_string())
}
async fn bounded_json(mut response: reqwest::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(format!(
            "Managed host request rejected ({})",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Managed host response failed")?
    {
        if bytes.len() + chunk.len() > MAX_JSON as usize {
            return Err("Managed host response exceeds limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Managed host response is invalid".into())
}
fn read_small(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if !meta.is_file() || meta.len() > MAX_JSON {
        return Err("Managed host metadata is not a bounded regular file".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(io_error)?
        .take(MAX_JSON + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > MAX_JSON as usize {
        return Err("Managed host metadata exceeds limit".into());
    }
    Ok(bytes)
}
fn real_directory(path: &Path) -> Result<(), String> {
    if !fs::symlink_metadata(path).map_err(io_error)?.is_dir() {
        return Err("Managed host path is not a real directory".into());
    }
    Ok(())
}
fn private_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    options
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = private_options()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}
fn private_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    let _ = path;
    Ok(())
}
#[cfg(unix)]
fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}
#[cfg(windows)]
fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x00000008 | 0x00000200);
}
#[cfg(not(any(unix, windows)))]
fn detach(_: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "blackcrab-managed-test-{}",
            random_secret().unwrap()
        ));
        fs::create_dir(&root).unwrap();
        root
    }
    fn signed_proof(secret: &str, nonce: &str, env: &str, origin: &str) -> Value {
        let tag = host_proof_mac(secret, nonce, env, origin)
            .unwrap()
            .finalize()
            .into_bytes();
        let proof: String = tag.iter().map(|b| format!("{b:02x}")).collect();
        json!({"version":1,"nonce":nonce,"environmentId":env,"origin":origin,"serverVersion":"0.1.7","orchestrationProtocolVersion":2,"proof":proof})
    }
    #[test]
    fn host_identity_proof_binds_fresh_nonce_identity_origin_and_secret() {
        let nonce = "a".repeat(64);
        let origin = "http://127.0.0.1:32145/";
        let proof = signed_proof("owner", &nonce, "env_fixture", origin);
        assert_eq!(
            proof["proof"],
            "a19ecfaa35c45cdbf2901b3823936cc64c3f6ede9b91966e4ac603e55ceb5f02"
        );
        assert!(verify_host_proof(&proof, &nonce, "env_fixture", origin, "owner").is_ok());
        for (key, value) in [
            ("nonce", json!("c".repeat(64))),
            ("environmentId", json!("other")),
            ("origin", json!("http://127.0.0.1:32146/")),
            ("proof", json!("0".repeat(64))),
        ] {
            let mut altered = proof.clone();
            altered[key] = value;
            assert!(verify_host_proof(&altered, &nonce, "env_fixture", origin, "owner").is_err());
        }
        assert!(verify_host_proof(&proof, &nonce, "env_fixture", origin, "impostor").is_err());
    }
    #[tokio::test]
    async fn fake_host_receives_no_bootstrap_credential_when_identity_proof_fails() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let origin = loopback_origin(listener.local_addr().unwrap().port()).unwrap();
        let server = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            for index in 0..2 {
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(c) => break c,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(std::time::Instant::now() < deadline);
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(e) => panic!("fixture: {e}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let mut b = [0u8; 1024];
                    let n = stream.read(&mut b).unwrap();
                    assert!(n > 0);
                    request.extend_from_slice(&b[..n]);
                    assert!(request.len() < 8192);
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with("GET /.well-known/"));
                assert!(!request.to_ascii_lowercase().contains("authorization:"));
                assert!(!request.contains("subject_token"));
                let body = if index == 0 {
                    descriptor()
                } else {
                    // Even a correctly signed proof for another port must not
                    // authorize sending a credential to this listener.
                    let target = request
                        .lines()
                        .next()
                        .unwrap()
                        .split_whitespace()
                        .nth(1)
                        .unwrap();
                    let challenge = url::Url::parse(&format!("http://127.0.0.1{target}")).unwrap();
                    let nonce = challenge
                        .query_pairs()
                        .find(|(key, _)| key == "nonce")
                        .unwrap()
                        .1
                        .into_owned();
                    signed_proof(
                        &"b".repeat(64),
                        &nonce,
                        "env_fixture",
                        "http://127.0.0.1:1/",
                    )
                }
                .to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
            std::thread::sleep(Duration::from_millis(150));
            assert_eq!(
                listener.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock,
                "no OAuth request may follow failed proof"
            );
        });
        let host = ManagedHost::new(PathBuf::from("unused-forged-host-root"));
        let error = host.probe_at(&config(), origin, false).await.err().unwrap();
        assert!(error.contains("identity proof"));
        server.join().unwrap();
    }
    fn config() -> Configuration {
        Configuration {
            schema: 1,
            artifact_path: PathBuf::from("/fixture"),
            manifest_digest: "a".repeat(64),
            bootstrap_secret: "b".repeat(64),
            environment_id: Some("env_fixture".into()),
            browser: None,
        }
    }
    fn descriptor() -> Value {
        json!({"environmentId":"env_fixture","serverVersion":"0.1.7","orchestrationProtocolVersion":2,"capabilities":{}})
    }
    #[tokio::test]
    async fn stopped_host_probe_builds_its_own_http_backend() {
        let reserved = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let origin = loopback_origin(reserved.local_addr().unwrap().port()).unwrap();
        drop(reserved);
        let host = ManagedHost::new(PathBuf::from("unused-probe-root"));
        assert!(matches!(
            host.probe_at(&config(), origin, false).await.unwrap(),
            None
        ));
    }
    #[tokio::test]
    async fn readiness_503_is_retryable_only_for_a_captured_startup() {
        for starting in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let origin = loopback_origin(listener.local_addr().unwrap().port()).unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0u8; 4096];
                let count = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..count]);
                assert!(request.starts_with("GET /.well-known/t3/environment "));
                assert!(!request.to_ascii_lowercase().contains("authorization:"));
                stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
            });
            let host = ManagedHost::new(PathBuf::from("unused-probe-root"));
            let result = host.probe_at(&config(), origin, starting).await;
            if starting {
                assert!(matches!(result.unwrap(), None));
            } else {
                assert!(result.is_err());
            }
            server.join().unwrap();
        }
    }
    #[test]
    fn bootstrap_tokens_match_the_pinned_windowed_hmac_contract() {
        assert_eq!(
            bootstrap_token("fixture secret", 43_200_000).unwrap(),
            "4b0e56ad858f2ff90b62e905225beab7f4d8b98bd9ecd02c5fffabe740ac1e7f"
        );
        assert_eq!(
            bootstrap_token("fixture secret", 43_200_001).unwrap(),
            bootstrap_token("fixture secret", 86_399_999).unwrap()
        );
        assert_ne!(
            bootstrap_token("fixture secret", 43_199_999).unwrap(),
            bootstrap_token("fixture secret", 43_200_000).unwrap()
        );
    }
    #[test]
    fn descriptor_and_origin_mismatch_fail_before_authentication() {
        assert!(validate_descriptor(&descriptor(), Some("other")).is_err());
        for field in [
            "serverVersion",
            "orchestrationProtocolVersion",
            "capabilities",
            "environmentId",
        ] {
            let mut value = descriptor();
            value.as_object_mut().unwrap().remove(field);
            assert!(validate_descriptor(&value, None).is_err());
        }
        for origin in [
            "https://127.0.0.1:4321/",
            "http://localhost:4321/",
            "http://127.0.0.1:4321/path",
            "http://user@127.0.0.1:4321/",
            "http://127.0.0.1:4321/?token=x",
            "http://127.0.0.1:4322/",
            "http://example.com:4321/",
        ] {
            assert!(validate_origin(origin, 4321).is_err(), "{origin}");
        }
        assert!(validate_origin("http://127.0.0.1:4321", 4321).is_ok());
    }
    #[tokio::test]
    async fn unmarked_data_is_never_adopted_and_metadata_is_private() {
        let base = fixture();
        let root = base.join("managed-host/v1");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("existing"), b"leave intact").unwrap();
        let host = ManagedHost::new(root.clone());
        assert_eq!(host.status().await.state, "unavailable");
        assert_eq!(fs::read(root.join("existing")).unwrap(), b"leave intact");
        assert!(!root.join("configuration.json").exists());
        assert!(!root.join("launcher.lock").exists());
        fs::remove_file(root.join("existing")).unwrap();
        assert_eq!(host.status().await.state, "notConfigured");
        host.save_config(&config()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join("configuration.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(&root).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        fs::remove_dir_all(base).unwrap();
    }
    #[tokio::test]
    async fn launch_leases_wait_for_the_exact_other_owner() {
        let base = fixture();
        let host = ManagedHost::new(base.join("v1"));
        host.prepare().unwrap();
        let first = host.lease().await.unwrap();
        host.initialize_locked().unwrap();
        let other = ManagedHost::new(host.root.clone());
        let waiter = tokio::spawn(async move { other.lease().await });
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(!waiter.is_finished());
        drop(first);
        let second = tokio::time::timeout(Duration::from_secs(2), waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        drop(second);
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn linked_managed_paths_are_rejected_without_touching_the_target() {
        use std::os::unix::fs::symlink;
        let base = fixture();
        let target = base.join("legacy");
        fs::create_dir(&target).unwrap();
        symlink(&target, base.join("managed-host")).unwrap();
        let host = ManagedHost::new(base.join("managed-host/v1"));
        assert_eq!(host.status().await.state, "unavailable");
        assert!(!target.join("v1").exists());
        fs::remove_dir_all(base).unwrap();
    }
    /// Run manually with BLACKCRAB_MANAGED_ARTIFACT after building a native package.
    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "requires an explicitly selected native managed runtime artifact"]
    async fn native_packaged_host_survives_launcher_exit_and_reconnects() {
        let artifact =
            std::env::var("BLACKCRAB_MANAGED_ARTIFACT").expect("select a packaged fixture runtime");
        let base = fixture();
        let root = base.join("managed-host/v1");
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "managed_host::tests::native_launcher_fixture",
                "--ignored",
                "--exact",
                "--nocapture",
            ])
            .env("BLACKCRAB_MANAGED_TEST_ROOT", &root)
            .env("BLACKCRAB_MANAGED_ARTIFACT", &artifact)
            .output()
            .unwrap();
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let pid = text
            .lines()
            .find_map(|line| line.strip_prefix("BLACKCRAB_TEST_CHILD_PID="))
            .and_then(|s| s.parse::<i32>().ok())
            .expect("launcher did not capture its own child");
        struct OwnedFixture(i32);
        impl Drop for OwnedFixture {
            fn drop(&mut self) {
                unsafe {
                    libc::kill(-self.0, libc::SIGTERM);
                }
            }
        }
        let cleanup = OwnedFixture(pid);
        assert!(output.status.success(), "launcher failed: {text}");
        let host = ManagedHost::new(root.clone());
        let before = host.status().await;
        assert_eq!(before.state, "running", "{:?}", before);
        let identity = before.environment_id.clone().unwrap();
        let attached = host.start(None).await.unwrap();
        assert_eq!(attached.environment_id, Some(identity));
        let url = host.window_url().await.unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert!(url.fragment().unwrap().starts_with("token="));
        let mut wrong = host.read_config().unwrap().unwrap();
        wrong.bootstrap_secret = "c".repeat(64);
        assert!(host.probe(&wrong).await.is_err());
        wrong.bootstrap_secret = host.read_config().unwrap().unwrap().bootstrap_secret;
        wrong.environment_id = Some("changed".into());
        assert!(host.probe(&wrong).await.is_err());
        let record: Value = serde_json::from_slice(
            &read_small(&root.join("host/userdata/server-runtime.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(record["pid"].as_i64(), Some(pid as i64));
        drop(cleanup);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        while unsafe { libc::kill(pid, 0) } == 0 && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "owned host did not stop");
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "subprocess fixture invoked only by its parent test"]
    async fn native_launcher_fixture() {
        let Ok(root) = std::env::var("BLACKCRAB_MANAGED_TEST_ROOT") else {
            return;
        };
        let artifact = std::env::var("BLACKCRAB_MANAGED_ARTIFACT").unwrap();
        let host = ManagedHost::new(PathBuf::from(root));
        let state = host.start(Some(PathBuf::from(artifact))).await.unwrap();
        assert_eq!(state.state, "running");
        // Dropping the supervisor and exiting the launcher must not close host output pipes.
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn native_pairing_uses_fresh_private_controller_and_fixed_http_delegation() {
        let base = fixture();
        let host = ManagedHost::new(base.clone());
        host.prepare().unwrap();
        host.initialize_locked().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let origin = format!("http://127.0.0.1:{port}/");
        let env = "12345678-1234-1234-1234-123456789abc".to_owned();
        let mut config = config();
        config.environment_id = Some(env.clone());
        host.save_config(&config).unwrap();
        fs::create_dir_all(base.join("host/userdata")).unwrap();
        write_new(
            &base.join("host/userdata/server-runtime.json"),
            serde_json::to_string(&json!({"version":1,"origin":origin,"port":port}))
                .unwrap()
                .as_bytes(),
        )
        .unwrap();
        let binding = DesktopHostBinding {
            generation: 1,
            environment_id: env.clone(),
            origin,
            browser: None,
        };
        host.desktop.lock().unwrap().binding = Some(binding.clone());
        host.desktop.lock().unwrap().generation = 1;
        let expiry = now_ms().unwrap() + 60_000;
        let seconds = (expiry / 1000) as libc::time_t;
        let mut tm = std::mem::MaybeUninit::<libc::tm>::uninit();
        assert!(!unsafe { libc::gmtime_r(&seconds, tm.as_mut_ptr()) }.is_null());
        let tm = unsafe { tm.assume_init() };
        let iso = format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec,
            expiry % 1000
        );
        let binding_origin = binding.origin.clone();
        let server = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(8);
            for index in 0..7 {
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(c) => break c,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(std::time::Instant::now() < deadline);
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(e) => panic!("fixture accept: {e}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0u8; 1024];
                let (header_end, length) = loop {
                    let n = stream.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                    assert!(bytes.len() < 16_384);
                    if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                        let header = std::str::from_utf8(&bytes[..end]).unwrap();
                        let length = header
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        break (end + 4, length);
                    }
                };
                while bytes.len() < header_end + length {
                    let n = stream.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                }
                let header = std::str::from_utf8(&bytes[..header_end]).unwrap();
                let body = &bytes[header_end..header_end + length];
                let reply = match index {
                    0 => {
                        assert!(header.starts_with("GET /.well-known/t3/environment "));
                        json!({"environmentId":env,"serverVersion":"0.1.7","orchestrationProtocolVersion":2,"capabilities":{}})
                    }
                    1 => {
                        assert!(header
                            .starts_with("GET /.well-known/blackcrab/managed-host-proof?nonce="));
                        let request_path = header
                            .lines()
                            .next()
                            .unwrap()
                            .split_whitespace()
                            .nth(1)
                            .unwrap();
                        let challenge =
                            url::Url::parse(&format!("{}{}", binding_origin, &request_path[1..]))
                                .unwrap();
                        let nonce = challenge
                            .query_pairs()
                            .find(|(k, _)| k == "nonce")
                            .unwrap()
                            .1
                            .into_owned();
                        signed_proof(&"b".repeat(64), &nonce, &env, &binding_origin)
                    }
                    2 | 4 => {
                        assert!(header.starts_with("POST /oauth/token "));
                        let form: std::collections::HashMap<_, _> =
                            url::form_urlencoded::parse(body).into_owned().collect();
                        assert_eq!(
                            form.get("subject_token_type").unwrap(),
                            "urn:t3:params:oauth:token-type:environment-bootstrap"
                        );
                        assert_ne!(form.get("subject_token").unwrap(), &"b".repeat(64));
                        if index == 4 {
                            assert!(form
                                .get("scope")
                                .unwrap()
                                .split(' ')
                                .any(|s| s == "access:write"));
                            json!({"access_token":"private-controller"})
                        } else {
                            json!({"access_token":"private-probe"})
                        }
                    }
                    3 | 5 => {
                        assert!(header.starts_with("GET /api/auth/session "));
                        assert!(header.to_ascii_lowercase().contains(if index == 3 {
                            "authorization: bearer private-probe"
                        } else {
                            "authorization: bearer private-controller"
                        }));
                        json!({"authenticated":true})
                    }
                    6 => {
                        assert!(header.starts_with("POST /api/auth/pairing-token "));
                        assert!(header
                            .to_ascii_lowercase()
                            .contains("authorization: bearer private-controller"));
                        let body: Value = serde_json::from_slice(body).unwrap();
                        assert_eq!(body.as_object().unwrap().len(), 2);
                        assert_eq!(body["label"], "Blackcrab Desktop");
                        assert_eq!(body["scopes"].as_array().unwrap().len(), 16);
                        json!({"id":"87654321-1234-1234-1234-123456789abc","credential":"23456789ABCD","label":"Blackcrab Desktop","expiresAt":iso})
                    }
                    _ => unreachable!(),
                };
                let body = serde_json::to_vec(&reply).unwrap();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let mut stale = binding.clone();
        stale.generation = 2;
        assert!(host.desktop_pair_grant(&stale).await.is_err());
        let grant = host.desktop_pair_grant(&binding).await.unwrap();
        assert_eq!(grant.credential, "23456789ABCD");
        assert_eq!(grant.expires_at, expiry);
        server.join().unwrap();
        let clone = host.clone();
        assert!(clone.desktop_binding_current(&binding).is_ok());
        host.desktop.lock().unwrap().invalidate().unwrap();
        assert!(clone.desktop_binding_current(&binding).is_err());
        assert!(host.desktop_pair_grant(&binding).await.is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn bundled_default_is_lazy_and_never_replaces_stored_or_explicit_selection() {
        let base = fixture().canonicalize().unwrap();
        let archive = base.join("bundled.tar.gz");
        fs::write(
            &archive,
            b"must not be parsed during metadata or explicit selection",
        )
        .unwrap();
        let payload = crate::managed_payload::EmbeddedPayload::new(
            crate::managed_payload::PayloadRole::Host,
            archive,
            "a".repeat(64),
            "b".repeat(64),
            base.join("payload-cache"),
        )
        .unwrap();
        let target = payload.target_directory();
        let host = ManagedHost::new(base.join("managed-host/v1")).with_bundled_payload(payload);
        let initial = host.status().await;
        assert_eq!(initial.state, "stopped");
        assert_eq!(
            initial.artifact_path,
            Some(target.to_string_lossy().into_owned())
        );
        assert!(!target.exists());
        assert!(!host.root.join("configuration.json").exists());
        assert!(host
            .start(Some(base.join("explicit-invalid-selection")))
            .await
            .is_err());
        assert!(!target.exists());
        assert!(!host.root.join("configuration.json").exists());
        let stored = config();
        host.save_config(&stored).unwrap();
        let bytes = fs::read(host.root.join("configuration.json")).unwrap();
        assert!(host.start(None).await.is_err());
        assert_eq!(
            fs::read(host.root.join("configuration.json")).unwrap(),
            bytes
        );
        assert!(!target.exists());
        fs::remove_dir_all(base).unwrap();
    }
}
