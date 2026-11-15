//! The real Windows service payload, helper and Task Scheduler, in CI only.
use super::*;

fn tail(path: &Path, limit: usize) -> String {
    match fs::read(path) {
        Ok(bytes) => String::from_utf8_lossy(&bytes[bytes.len().saturating_sub(limit)..]).into_owned(),
        Err(error) => format!("<{}: {error}>", path.display()),
    }
}
fn listing(root: &Path, depth: usize, found: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten().take(80) {
        let path = entry.path();
        found.push(path.display().to_string());
        if depth > 0 && path.is_dir() {
            listing(&path, depth - 1, found);
        }
    }
}

async fn running(host: &ManagedHost) -> Result<HostStatus, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    loop {
        let state = host.status().await;
        if state.state == "running" {
            return Ok(state);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "Actual Windows host did not become ready: {}",
                state.error.as_deref().unwrap_or(state.state)
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

#[tokio::test]
#[ignore = "requires an actual built Windows host and helper on a disposable CI runner; registers a real scheduled task"]
async fn actual_packaged_windows_service_lifecycle() {
    assert!(cfg!(windows) && cfg!(target_arch = "x86_64"));
    assert!(cfg!(blackcrab_bundled_service_issuer));
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    let temp = std::env::temp_dir().canonicalize().unwrap();
    let temp = PathBuf::from(temp.to_string_lossy().trim_start_matches(r"\\?\"));
    let root = temp.join(format!("Blackcrab packaged host {}", &random_secret().unwrap()[..16]));
    crate::managed_private_windows::create_private_directory(&root).unwrap();
    let payload = crate::managed_payload::EmbeddedPayload::new(
        crate::managed_payload::PayloadRole::Host,
        PathBuf::from(std::env::var_os("BLACKCRAB_TEST_HOST_ARCHIVE").expect("host archive")),
        option_env!("BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256")
            .expect("compiled archive pin")
            .into(),
        option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256")
            .expect("compiled manifest pin")
            .into(),
        root.join("payload-cache"),
    )
    .unwrap();
    let owner = root.join("owner");
    let host = ManagedHost::new(owner.clone()).with_bundled_payload(payload.clone());
    let fresh = host.control_service(ServiceAction::Status).await.unwrap();
    assert!(fresh.can_initialize && !fresh.installed && !fresh.loaded, "{}", fresh.state);
    assert_eq!(host.initialize_service().await.unwrap().state, "stopped");
    let configuration = fs::read(owner.join("configuration.json")).unwrap();
    let configured = host.read_config().unwrap().unwrap();
    // No private browser channel exists on Windows yet.
    assert!(configured.ownership == OwnershipMode::Service && configured.browser.is_none());
    let identity = configured.environment_id.unwrap();
    let retained = owner.join("host/userdata/retained-history-fixture");
    fs::write(&retained, b"retain workspace history\n").unwrap();

    // Cleanup stays outside the assertions so an ordinary failure still
    // removes exactly the scheduled task this test registered.
    let began = std::time::Instant::now();
    let result: Result<(), String> = async {
        let stage = |name: &str| println!("WINDOWS_SERVICE_STAGE {name} at {}s", began.elapsed().as_secs());
        macro_rules! ensure {
            ($condition:expr, $($message:tt)+) => {
                if !$condition {
                    return Err(format!($($message)+));
                }
            };
        }
        let installed = host.control_service(ServiceAction::Install).await?;
        stage("installed");
        ensure!(installed.installed && installed.loaded, "install left the service {}", installed.state);
        ensure!(running(&host).await?.environment_id.as_deref() == Some(identity.as_str()), "environment changed");
        let binding = host.desktop_binding().await?;
        ensure!(binding.browser.is_none() && binding.environment_id == identity, "binding differs");
        ensure!(!host.desktop_pair_grant(&binding).await?.credential.is_empty(), "no pair credential");
        let runtime = fs::read(owner.join("host/userdata/server-runtime.json")).map_err(io_error)?;
        stage("attached and paired");

        // A second launcher instance must attach to the SAME running service
        // and never replace its process, selection or environment.
        let reopened = ManagedHost::new(owner.clone()).with_bundled_payload(payload);
        ensure!(reopened.start(None).await?.environment_id.as_deref() == Some(identity.as_str()), "reopen changed the environment");
        let rebound = reopened.desktop_binding().await?;
        ensure!(rebound.origin == binding.origin, "reopen changed the origin");
        ensure!(fs::read(owner.join("host/userdata/server-runtime.json")).map_err(io_error)? == runtime, "reopen replaced the service");
        drop(reopened);
        stage("reopened");
        ensure!(host.status().await.state == "running", "not running after reopen");

        let stopped = host.control_service(ServiceAction::Stop).await?;
        stage("stopped");
        ensure!(stopped.installed && !stopped.loaded, "stop left the service {}", stopped.state);
        ensure!(host.status().await.state == "stopped", "host not stopped");
        ensure!(host.start(None).await.is_err(), "attachment must not restart a stopped service");
        host.control_service(ServiceAction::Start).await?;
        stage("started");
        ensure!(running(&host).await?.environment_id.as_deref() == Some(identity.as_str()), "environment changed after start");
        host.control_service(ServiceAction::Restart).await?;
        stage("restarted");
        ensure!(running(&host).await?.environment_id.as_deref() == Some(identity.as_str()), "environment changed after restart");
        Ok(())
    }
    .await;
    if let Err(error) = &result {
        let mut found = Vec::new();
        listing(&owner, 3, &mut found);
        println!(
            "WINDOWS_SERVICE_FAILURE {error}\n--- boot-service.log\n{}\n--- owner\n{}",
            tail(&owner.join("logs/boot-service.log"), 6000),
            found.join("\n")
        );
        for log in ["logs/service-supervisor.log", "host/userdata/logs/server.log", "logs/host.log"] {
            println!("--- {log}\n{}", tail(&owner.join(log), 3000));
        }
    }
    let removed = host.control_service(ServiceAction::Uninstall).await;
    println!(
        "WINDOWS_SERVICE_STAGE uninstalled at {}s\n--- service-supervisor.log\n{}",
        began.elapsed().as_secs(),
        tail(&owner.join("logs/service-supervisor.log"), 3000)
    );
    if let Ok(status) = &removed {
        assert!(!status.installed && !status.loaded);
    }
    assert!(removed.is_ok(), "actual service cleanup failed: {:?}", removed.as_ref().err());
    result.unwrap();
    assert_eq!(host.status().await.state, "stopped");
    assert!(fs::read(owner.join("configuration.json")).unwrap() == configuration);
    assert_eq!(fs::read(&retained).unwrap(), b"retain workspace history\n");
    let _ = fs::remove_dir_all(&root);
    println!("REAL_WINDOWS_HOST_HELPER_TASK_ATTACHMENT_PASSED; agent prompts sent: 0");
}
