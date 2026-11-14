use super::*;
use std::os::unix::fs::PermissionsExt;

fn plan(home: &Path) -> ServiceUnitPlan {
    let root = home.join("Blackcrab % $ workspace");
    let configuration = Configuration {
        schema: 1,
        ownership: OwnershipMode::Service,
        artifact_path: root.join("runtime"),
        manifest_digest: "a".repeat(64),
        bootstrap_secret: "DO-NOT-RENDER".into(),
        environment_id: Some("retained-environment".into()),
        browser: None,
    };
    ServiceUnitPlan::build(
        &root,
        configuration,
        42,
        home.to_path_buf(),
        unsafe { libc::geteuid() },
        "/usr/local/bin:/usr/bin:/bin".into(),
    )
    .unwrap()
}
fn props(values: Value) -> Value {
    Value::Object(
        values
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), json!({"data":v})))
            .collect(),
    )
}
fn manager_properties(plan: &ServiceUnitPlan) -> (Value, Value) {
    let unit = props(
        json!({"ActiveState":"inactive","LoadState":"loaded","Job":[0,"/"],"FragmentPath":plan.unit_path,
        "SourcePath":"","Transient":false,"NeedDaemonReload":false,"DropInPaths":[]}),
    );
    let service = props(
        json!({"Environment":plan.environment.iter().map(|(k,v)|format!("{k}={v}")).collect::<Vec<_>>(),
        "WorkingDirectory":plan.home,"Type":"simple","Restart":"always","KillMode":"mixed","TimeoutStopUSec":90_000_000,
        "RestartUSec":5_000_000,"UMask":63,"StandardOutput":"append","StandardError":"append","ExecStart":[[plan.program[0],plan.program,false,0,0,0,0,0,0,0]],
        "ExecStartPre":[],"ExecStartPost":[],"ExecStop":[],"ExecStopPost":[],"ExecReload":[],"EnvironmentFiles":[],"PassEnvironment":[],"UnsetEnvironment":[]}),
    );
    (unit, service)
}

#[test]
fn unit_keeps_identity_escapes_literal_paths_and_does_not_embed_credentials() {
    let plan = plan(Path::new("/home/test \"viewer\""));
    let bytes = plan.render_with_path(&plan.environment["PATH"]).unwrap();
    let source = std::str::from_utf8(&bytes).unwrap();
    assert!(source.contains("Blackcrab %% $ workspace/runtime/t3\" \"__service-launcher\""));
    assert!(source.contains("WorkingDirectory=/home/test \"viewer\"\n"));
    assert!(source.contains("StandardOutput=append:/home/test \"viewer\"/Blackcrab %% $ workspace/logs/boot-service.log\n"));
    assert!(source.contains("Environment=T3CODE_HOME="));
    assert!(source.contains("T3_BOOT_SERVICE_UNIT=\"blackcrab.service\""));
    assert!(!source.contains("DO-NOT-RENDER"));
    assert!(source.contains("TimeoutStopSec=90\n"));
    assert_eq!(
        plan.installed_path(&bytes).unwrap(),
        plan.environment["PATH"]
    );
    assert!(quote("/bad\nExecStart=/bin/false", true).is_err());
    assert!(quote("nul\0value", false).is_err());
    let installed = plan.render_with_path("/previous/bin:/usr/bin").unwrap();
    assert_eq!(
        plan.installed_path(&installed).unwrap(),
        "/previous/bin:/usr/bin"
    );
    assert!(plan
        .installed_path(&[bytes.as_slice(), b"ExecStart=/bin/false\n"].concat())
        .is_err());
}

#[test]
fn real_owned_unit_and_enable_link_reject_foreign_paths_without_touching_history() {
    let temp = tempfile::tempdir().unwrap();
    let plan = plan(temp.path());
    fs::create_dir(&plan.root).unwrap();
    let history = plan.root.join("retained-history");
    fs::write(&history, b"retained").unwrap();
    assert!(plan.read_owned_unit().unwrap().is_none());
    plan.publish_unit().unwrap();
    plan.enable_owned().unwrap();
    assert!(plan.wanted().unwrap());
    let original = fs::read(&plan.unit_path).unwrap();
    assert_eq!(fs::metadata(&plan.unit_path).unwrap().mode() & 0o777, 0o600);
    plan.publish_unit().unwrap();
    assert_eq!(fs::read(&plan.unit_path).unwrap(), original);
    fs::set_permissions(&plan.unit_path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(plan.read_owned_unit().is_err());
    fs::set_permissions(&plan.unit_path, fs::Permissions::from_mode(0o600)).unwrap();
    let alias = temp.path().join("alias");
    fs::hard_link(&plan.unit_path, &alias).unwrap();
    assert!(plan.read_owned_unit().is_err());
    fs::remove_file(alias).unwrap();
    fs::write(&plan.unit_path, b"[Service]\nExecStart=/bin/false\n").unwrap();
    assert!(plan.publish_unit().is_err());
    fs::write(&plan.unit_path, &original).unwrap();
    fs::remove_file(plan.wanted_path()).unwrap();
    std::os::unix::fs::symlink("/foreign.service", plan.wanted_path()).unwrap();
    assert!(plan.enable_owned().is_err());
    fs::remove_file(&plan.unit_path).unwrap();
    std::os::unix::fs::symlink(&history, &plan.unit_path).unwrap();
    assert!(plan.read_owned_unit().is_err());
    assert_eq!(fs::read(history).unwrap(), b"retained");
}

#[test]
fn manager_proof_rejects_overrides_foreign_argv_owner_and_pending_jobs() {
    let plan = plan(Path::new("/home/test"));
    let bytes = plan.render_with_path(&plan.environment["PATH"]).unwrap();
    let (unit, service) = manager_properties(&plan);
    assert_eq!(
        plan.verified_properties(&unit, Some(&service), Some(&bytes))
            .unwrap(),
        Registration {
            installed: true,
            loaded: false
        }
    );
    for (key, value) in [
        ("FragmentPath", json!("/foreign/blackcrab.service")),
        ("DropInPaths", json!(["/override.conf"])),
        ("NeedDaemonReload", json!(true)),
        ("Transient", json!(true)),
        ("Job", json!([100, "/job/100"])),
        ("ActiveState", json!("unknown")),
    ] {
        let mut changed = unit.clone();
        changed[key]["data"] = value;
        assert!(
            plan.verified_properties(&changed, Some(&service), Some(&bytes))
                .is_err(),
            "accepted unit field {key}"
        );
    }
    for (key, value) in [
        (
            "Environment",
            json!(["BLACKCRAB_NATIVE_SERVICE_OWNER=foreign"]),
        ),
        (
            "ExecStart",
            json!([["/foreign", ["/foreign"], false, 0, 0, 0, 0, 0, 0, 0]]),
        ),
        ("ExecStartPre", json!([["/bin/sh"]])),
        ("EnvironmentFiles", json!([["/foreign.env", false]])),
        ("UMask", json!(18)),
        ("TimeoutStopUSec", json!(5)),
    ] {
        let mut changed = service.clone();
        changed[key]["data"] = value;
        assert!(
            plan.verified_properties(&unit, Some(&changed), Some(&bytes))
                .is_err(),
            "accepted service field {key}"
        );
    }
    assert!(plan
        .verified_properties(&unit, Some(&service), None)
        .is_err());
    let mut absent = unit.clone();
    absent["LoadState"]["data"] = json!("not-found");
    absent["FragmentPath"]["data"] = json!("");
    assert_eq!(
        plan.verified_properties(&absent, None, None).unwrap(),
        Registration {
            installed: false,
            loaded: false
        }
    );
    absent["ActiveState"]["data"] = json!("active");
    assert!(plan.verified_properties(&absent, None, None).is_err());
}

#[test]
fn changed_installer_path_does_not_change_the_loaded_service_identity() {
    let mut plan = plan(Path::new("/home/test"));
    let (unit, service) = manager_properties(&plan);
    let bytes = plan.render_with_path(&plan.environment["PATH"]).unwrap();
    plan.environment
        .insert("PATH".into(), "/new/bin:/usr/bin".into());
    assert!(plan
        .verified_properties(&unit, Some(&service), Some(&bytes))
        .is_ok());
}

#[test]
fn absent_unit_requires_a_complete_inactive_manager_reply() {
    let reply = b"LoadState=not-found\nActiveState=inactive\nFragmentPath=\nDropInPaths=\nJob=\n";
    assert!(ServiceUnitPlan::not_found_reply(Some(0), reply));
    assert!(ServiceUnitPlan::not_found_reply(Some(4), reply));
    assert!(!ServiceUnitPlan::not_found_reply(Some(1), reply));
    assert!(!ServiceUnitPlan::not_found_reply(
        Some(4),
        b"LoadState=not-found\n"
    ));
    for value in ["active", "activating", "failed"] {
        let changed = std::str::from_utf8(reply)
            .unwrap()
            .replace("inactive", value);
        assert!(!ServiceUnitPlan::not_found_reply(
            Some(4),
            changed.as_bytes()
        ));
    }
    assert!(!ServiceUnitPlan::not_found_reply(
        Some(4),
        &[reply.as_slice(), b"ActiveState=inactive\n"].concat()
    ));
}

#[tokio::test]
async fn control_operations_serialize_on_the_owned_lease() {
    let temp = tempfile::tempdir().unwrap();
    let first = control_lease(temp.path()).await.unwrap();
    let second = control_lease(temp.path());
    tokio::pin!(second);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut second)
            .await
            .is_err()
    );
    drop(first);
    assert!(tokio::time::timeout(Duration::from_secs(1), second)
        .await
        .unwrap()
        .is_ok());
    fs::set_permissions(
        temp.path().join("service-control.lock"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(control_lease(temp.path()).await.is_err());
}

/// Runs only in CI's freshly created disposable OS account. This exercises the
/// real user manager with an inert launcher, not a provider or production host.
#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "requires the dedicated isolated systemd QA account"]
async fn actual_systemd_user_lifecycle() {
    let home = crate::managed_desktop::native_account_home().unwrap();
    assert_eq!(home, PathBuf::from("/home/blackcrab-systemd-qa"));
    assert_eq!(unsafe { libc::geteuid() }, 1999);
    assert_eq!(
        fs::read_to_string(home.join(".blackcrab-disposable-systemd-qa")).unwrap(),
        "isolated-ci-only\n"
    );
    let plan = plan(&home);
    assert!(!plan.unit_path.exists());
    fs::create_dir(&plan.root).unwrap();
    fs::create_dir(plan.root.join("logs")).unwrap();
    fs::create_dir(&plan.configuration.artifact_path).unwrap();
    let script = b"#!/usr/bin/python3\nimport os,sys,time,signal\nfrom pathlib import Path\nassert sys.argv[1:] == ['__service-launcher']\np=Path(os.environ['T3CODE_HOME']);p.mkdir(exist_ok=True)\nwith (p/'starts').open('a') as f:f.write('started\\n')\nsignal.signal(signal.SIGTERM,lambda *_:sys.exit(0))\nwhile True:time.sleep(0.05)\n";
    fs::write(&plan.program[0], script).unwrap();
    fs::set_permissions(&plan.program[0], fs::Permissions::from_mode(0o700)).unwrap();
    let history = plan.root.join("retained-history");
    fs::write(&history, b"untouched").unwrap();
    let result: Result<(), String> = async {
        assert_eq!(
            plan.registration().await?,
            Registration {
                installed: false,
                loaded: false
            }
        );
        plan.publish_unit()?;
        plan.enable_owned()?;
        plan.command("daemon-reload", false, Duration::from_secs(15))
            .await?;
        assert_eq!(
            plan.registration().await?,
            Registration {
                installed: true,
                loaded: false
            }
        );
        plan.command("start", true, Duration::from_secs(15)).await?;
        wait_starts(&plan, 1).await;
        assert!(plan.registration().await?.loaded);
        // A new controller attaches to the same registration; no second start.
        let reopened = super::tests::plan(&home);
        assert!(reopened.registration().await?.loaded);
        assert_eq!(
            fs::read_to_string(plan.root.join("host/starts"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        plan.command("stop", true, Duration::from_secs(100)).await?;
        assert!(!plan.registration().await?.loaded);
        plan.command("start", true, Duration::from_secs(15)).await?;
        wait_starts(&plan, 2).await;
        assert!(plan.registration().await?.loaded);
        plan.command("restart", true, Duration::from_secs(100))
            .await?;
        wait_starts(&plan, 3).await;
        assert!(plan.registration().await?.loaded);
        Ok(())
    }
    .await;
    // Retain a captured, owned service plan; no PID scanning or broad service stop.
    let stop = plan.command("stop", true, Duration::from_secs(100)).await;
    if plan.wanted().unwrap_or(false) {
        fs::remove_file(plan.wanted_path()).unwrap();
    }
    if plan.read_owned_unit().ok().flatten().is_some() {
        fs::remove_file(&plan.unit_path).unwrap();
    }
    let reload = plan
        .command("daemon-reload", false, Duration::from_secs(15))
        .await;
    assert!(stop.is_ok() && reload.is_ok());
    assert_eq!(
        plan.registration().await.unwrap(),
        Registration {
            installed: false,
            loaded: false
        }
    );
    assert_eq!(fs::read(history).unwrap(), b"untouched");
    result.unwrap();
}
#[cfg(target_os = "linux")]
async fn wait_starts(plan: &ServiceUnitPlan, count: usize) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if fs::read_to_string(plan.root.join("host/starts"))
            .ok()
            .is_some_and(|s| s.lines().count() == count)
        {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "isolated service did not become ready"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
