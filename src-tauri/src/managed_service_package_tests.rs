//! Actual archive/helper/systemd integration, confined to CI's new OS account.
use super::*;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

async fn running(host: &ManagedHost) -> Result<HostStatus, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    loop {
        let state = host.status().await;
        if state.state == "running" {
            return Ok(state);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "Actual Linux host did not become ready: {}",
                state.error.as_deref().unwrap_or(state.state)
            ));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[tokio::test]
#[ignore = "requires an actual built Linux host/helper and the disposable systemd QA account"]
async fn actual_packaged_linux_service_lifecycle() {
    assert!(cfg!(target_os = "linux") && cfg!(target_arch = "x86_64"));
    assert!(cfg!(blackcrab_bundled_service_issuer));
    let home = crate::managed_desktop::native_account_home().unwrap();
    assert_eq!(home, PathBuf::from("/home/blackcrab-systemd-qa"));
    assert_eq!(unsafe { libc::geteuid() }, 1999);
    assert_eq!(
        fs::read_to_string(home.join(".blackcrab-disposable-systemd-qa")).unwrap(),
        "isolated-ci-only\n"
    );
    let root = home.join("Blackcrab packaged host");
    fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
    let payload = crate::managed_payload::EmbeddedPayload::new(
        crate::managed_payload::PayloadRole::Host,
        home.join("managed-host-payload.tar.gz"),
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
    assert!(fresh.can_initialize && !fresh.installed && !fresh.loaded);
    assert_eq!(host.initialize_service().await.unwrap().state, "stopped");
    let configuration = fs::read(owner.join("configuration.json")).unwrap();
    let configured = host.read_config().unwrap().unwrap();
    assert!(configured.ownership == OwnershipMode::Service && configured.browser.is_some());
    let browser_root = configured
        .browser
        .as_ref()
        .unwrap()
        .path
        .parent()
        .unwrap()
        .to_owned();
    let identity = configured.environment_id.unwrap();
    let retained = owner.join("host/userdata/retained-history-fixture");
    fs::write(&retained, b"retain workspace history\n").unwrap();
    fs::set_permissions(&retained, fs::Permissions::from_mode(0o600)).unwrap();

    // Keep cleanup outside assertions so ordinary errors still remove the exact
    // owned registration; the outer controller also retires this new OS account.
    let result: Result<(), String> = async {
        host.control_service(ServiceAction::Install).await?;
        assert_eq!(
            running(&host).await?.environment_id.as_deref(),
            Some(identity.as_str())
        );
        let binding = host.desktop_binding().await?;
        assert!(binding.browser.is_some() && binding.environment_id == identity);
        assert!(!host
            .desktop_pair_grant(&binding)
            .await?
            .credential
            .is_empty());
        let runtime =
            fs::read(owner.join("host/userdata/server-runtime.json")).map_err(io_error)?;

        // Recreate the desktop supervisor: it must authenticate the SAME running
        // service and never replace its process, selection or environment ID.
        let reopened = ManagedHost::new(owner.clone()).with_bundled_payload(payload);
        assert_eq!(
            reopened.start(None).await?.environment_id.as_deref(),
            Some(identity.as_str())
        );
        let rebound = reopened.desktop_binding().await?;
        assert!(rebound.origin == binding.origin && rebound.browser == binding.browser);
        assert!(
            fs::read(owner.join("host/userdata/server-runtime.json")).map_err(io_error)? == runtime
        );
        drop(reopened);
        assert_eq!(host.status().await.state, "running");

        host.control_service(ServiceAction::Stop).await?;
        assert_eq!(host.status().await.state, "stopped");
        assert!(
            host.start(None).await.is_err(),
            "attachment must not restart a stopped service"
        );
        host.control_service(ServiceAction::Start).await?;
        assert_eq!(
            running(&host).await?.environment_id.as_deref(),
            Some(identity.as_str())
        );
        host.control_service(ServiceAction::Restart).await?;
        assert_eq!(
            running(&host).await?.environment_id.as_deref(),
            Some(identity.as_str())
        );
        assert!(host.desktop_binding().await?.browser.is_some());
        Ok(())
    }
    .await;
    let removed = host.control_service(ServiceAction::Uninstall).await;
    if let Ok(status) = &removed {
        assert!(!status.installed && !status.loaded);
    }
    assert!(removed.is_ok(), "actual service cleanup failed");
    assert_eq!(host.status().await.state, "stopped");
    assert!(fs::read(owner.join("configuration.json")).unwrap() == configuration);
    assert_eq!(fs::read(&retained).unwrap(), b"retain workspace history\n");
    assert!(!home.join(".config/systemd/user/blackcrab.service").exists());
    fs::remove_dir_all(browser_root).unwrap();
    result.unwrap();
    println!("REAL_LINUX_HOST_HELPER_SYSTEMD_ATTACHMENT_PASSED; agent prompts sent: 0; GUI acceptance: pending");
}
