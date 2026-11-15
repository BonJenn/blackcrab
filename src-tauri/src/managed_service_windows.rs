//! Windows background-service control: a verified per-user scheduled task
//! whose action is Blackcrab's own helper, which supervises the service.
//!
//! The order of checks follows the launchd and systemd controls. Only what is
//! Windows-specific differs: the service is "installed" when our scheduled
//! task is registered exactly as written, and "loaded" when its supervisor is
//! running in this session. A clean stop is asked of the supervisor; ending
//! the task is only the fallback.
use super::ServiceAction as Action;
use super::*;
use crate::{
    managed_private_windows::{self as private, Access},
    managed_service_run_windows as supervisor, managed_service_task_windows as task,
};

fn invalid() -> String {
    "Background service configuration is unavailable or changed".into()
}

#[derive(Debug, PartialEq, Eq)]
struct Registration {
    installed: bool,
    loaded: bool,
}

async fn control_lease(root: &Path) -> Result<File, String> {
    let file = private::open_file(
        &root.join("service-control.lock"),
        OpenOptions::new().read(true).write(true).create(true),
    )
    .map_err(|_| invalid())?;
    if private::security(&file, Access::Private).is_err()
        || file.metadata().map_err(|_| invalid())?.len() != 0
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

/// Verifying a registration exports the task through PowerShell, which takes
/// seconds. A status poll may reuse a recent verification of the very same
/// definition; every operation that changes or acts on the task verifies anew.
static VERIFIED: StdMutex<Option<(task::Definition, std::time::Instant)>> = StdMutex::new(None);
const VERIFIED_FOR: Duration = Duration::from_secs(30);

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> std::io::Result<T> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(io_error)?
        .map_err(|error| format!("Windows could not complete the background-service operation ({})", error.kind()))
}

struct ServiceTaskPlan {
    root: PathBuf,
    configuration: Configuration,
    generation: u64,
    definition: task::Definition,
}

impl ServiceTaskPlan {
    fn from_host(host: &ManagedHost) -> Result<Self, String> {
        let configuration = host.read_config()?.ok_or_else(invalid)?;
        if configuration.ownership != OwnershipMode::Service {
            return Err(invalid());
        }
        let (helper, generation) = service_issuer::service_helper(host, &configuration)?;
        let environment = configuration.environment_id.as_deref().ok_or_else(invalid)?;
        Ok(Self {
            root: host.root.clone(),
            definition: task::Definition {
                key: service_issuer::service_key(&host.root, generation, environment),
                command: helper,
                arguments: "__blackcrab-service-run-v1".into(),
                directory: host.root.clone(),
            },
            configuration,
            generation,
        })
    }
    async fn registration(&self, fresh: bool) -> Result<Registration, String> {
        let recent = !fresh
            && VERIFIED.lock().map_err(io_error)?.as_ref().is_some_and(|(definition, at)| {
                *definition == self.definition && at.elapsed() < VERIFIED_FOR
            });
        let installed = if recent {
            true
        } else {
            let definition = self.definition.clone();
            match blocking(move || task::registration(&definition)).await? {
                task::Registration::Absent => false,
                task::Registration::Ours => true,
                task::Registration::Foreign => {
                    return Err("A different scheduled task has this service's name; it was left untouched".into())
                }
            }
        };
        *VERIFIED.lock().map_err(io_error)? =
            installed.then(|| (self.definition.clone(), std::time::Instant::now()));
        let key = self.definition.key.clone();
        let loaded = blocking(move || supervisor::is_running(&key)).await?;
        Ok(Registration { installed, loaded })
    }
    async fn wait_running(&self, running: bool, limit: Duration) -> Result<bool, String> {
        let deadline = tokio::time::Instant::now() + limit;
        loop {
            let key = self.definition.key.clone();
            if blocking(move || supervisor::is_running(&key)).await? == running {
                return Ok(true);
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(false);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    /// Asks the supervisor to stop the service cleanly and waits for it to
    /// finish; ends the task outright only if it does not.
    async fn stop(&self) -> Result<(), String> {
        let key = self.definition.key.clone();
        blocking(move || supervisor::request_stop(&key)).await?;
        if self.wait_running(false, Duration::from_secs(130)).await? {
            return Ok(());
        }
        let definition = self.definition.clone();
        blocking(move || task::end(&definition)).await?;
        self.wait_running(false, Duration::from_secs(15)).await?;
        Ok(())
    }
    async fn apply(mut self, action: Action) -> Result<(Self, Registration), String> {
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
        let mut registration = self.registration(action != Action::Status).await?;
        if action == Action::Status {
            return Ok((self, registration));
        }
        if matches!(action, Action::Stop | Action::Restart | Action::Uninstall) {
            if registration.loaded {
                self.stop().await?;
                registration = self.registration(true).await?;
                if registration.loaded {
                    return Err("Windows has not confirmed that the background service stopped".into());
                }
            }
            service_issuer::require_stopped_for_control(&host, &self.configuration)?;
            if action == Action::Uninstall {
                if registration.installed {
                    let definition = self.definition.clone();
                    blocking(move || task::unregister(&definition)).await?;
                }
                // Deliberately retain configuration, issuer, native journal,
                // host database, conversations, credentials and pairings.
                let registration = self.registration(true).await?;
                return Ok((self, registration));
            }
            if action == Action::Stop {
                return Ok((self, registration));
            }
        }
        if !registration.installed {
            if action != Action::Install {
                return Err("Install the background service before starting it".into());
            }
            service_issuer::require_stopped_for_control(&host, &self.configuration)?;
            let (definition, scratch) = (self.definition.clone(), self.root.clone());
            blocking(move || task::register(&definition, &scratch)).await?;
        }
        if registration.loaded {
            return Ok((self, registration));
        }
        service_issuer::require_stopped_for_control(&host, &self.configuration)?;
        service_issuer::refresh_bundled_issuer(&host, &self.configuration)?;
        // The task runs the helper by its digest path. If this build carries a
        // newer helper, the task is registered again for it.
        let (helper, _) = service_issuer::service_helper(&host, &self.configuration)?;
        if helper != self.definition.command {
            let (old, scratch) = (self.definition.clone(), self.root.clone());
            self.definition.command = helper;
            let new = self.definition.clone();
            blocking(move || {
                task::unregister(&old)?;
                task::register(&new, &scratch)
            })
            .await?;
        }
        // Verified once more immediately before it is started.
        let definition = self.definition.clone();
        blocking(move || task::run(&definition)).await?;
        if !self.wait_running(true, Duration::from_secs(30)).await? {
            return Err("Windows did not start the background service".into());
        }
        let registration = self.registration(true).await?;
        Ok((self, registration))
    }
}

pub(super) async fn control(host: &ManagedHost, action: Action) -> Result<super::ServiceStatus, String> {
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
                    state: if available { "notConfigured" } else { "notAvailable" },
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
    let (plan, registration) = ServiceTaskPlan::from_host(host)?.apply(action).await?;
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
    Ok(super::ServiceStatus {
        state,
        can_initialize: false,
        installed: registration.installed,
        loaded: registration.loaded,
        permission_identity_restart_required: false,
        error,
    })
}
