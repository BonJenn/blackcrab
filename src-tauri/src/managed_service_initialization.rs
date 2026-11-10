//! Explicit fresh-owner setup from native bundled selection. No OS activation.
use super::*;
use crate::managed_service_install::SelectedServiceRuntime;

pub(super) fn fresh_owner(host: &ManagedHost) -> Result<(), String> {
    if host.read_config()?.is_some() {
        return Err("This workspace is already configured; service setup cannot replace or migrate it".into());
    }
    for entry in fs::read_dir(&host.root).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        if !["launcher.lock", ".blackcrab-managed-host", "host", "logs"].iter()
            .any(|name| entry.file_name() == *name) {
            return Err("Service setup requires a fresh workspace; existing data was preserved".into());
        }
    }
    for name in ["host", "logs"] {
        let directory = host.root.join(name);
        crate::managed_payload::private_dir(&directory)?;
        if fs::read_dir(directory).map_err(io_error)?.next().is_some() {
            return Err("Service setup requires a fresh workspace; existing data was preserved".into());
        }
    }
    Ok(())
}
fn new_environment_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(io_error)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..]))
}
pub(super) async fn initialize(host: &ManagedHost) -> Result<HostStatus, String> {
    let _operation = host.operation.lock().await;
    // Only the bundled native capability may choose the runtime. No request path.
    let payload = host.bundled_payload.clone().ok_or("A bundled background-service runtime is required")?;
    let expected = option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256")
        .ok_or("Background-service setup is not configured in this build")?;
    if payload.expected_host_manifest_sha256() != Some(expected) {
        return Err("The bundled service runtime differs from this build".into());
    }
    host.prepare()?;
    let lease = host.lease().await?;
    host.initialize_locked()?;
    fresh_owner(host)?;
    let owned = host.clone();
    let config = tokio::task::spawn_blocking(move || -> Result<Configuration, String> {
        // Keep the native configuration lease through publication of Service mode.
        // On a later failure, that mode blocks every Direct startup/replacement.
        let selected = SelectedServiceRuntime::from_embedded(owned.root.clone(), &payload)
            .map_err(|_| "The bundled runtime does not support background-service setup")?;
        fresh_owner(&owned)?;
        let environment_id = new_environment_id()?;
        let mut config = Configuration { schema: 1, ownership: OwnershipMode::Service,
            artifact_path: selected.version_directory().join("payload"), manifest_digest: expected.into(),
            bootstrap_secret: random_secret()?, environment_id: Some(environment_id.clone()), browser: None };
        if native_browser_supported() && selected.supports_native_browser().map_err(|_| "The bundled service browser capability failed verification")? {
            config.browser = Some(crate::managed_browser::Capability::allocate(&owned.root)?);
        }
        owned.save_config(&config)?;
        File::open(&owned.root).and_then(|file| file.sync_all()).map_err(io_error)?;
        let mut installation = selected.prepare().map_err(|_| "Service runtime preparation failed; setup data was retained")?;
        installation.validate_version().map_err(|_| "Service runtime validation failed; setup data was retained")?;
        installation.commit().map_err(|_| "Service runtime publication failed; setup data was retained")?;
        let userdata = owned.root.join("host/userdata");
        fs::create_dir(&userdata).map_err(io_error)?;
        private_directory(&userdata)?;
        write_new(&userdata.join("environment-id"), format!("{environment_id}\n").as_bytes())?;
        write_new(&owned.root.join("host/runtime/service-state.json"),
            &serde_json::to_vec(&json!({"protocol":4,"activeVersion":"0.1.7"})).map_err(io_error)?)?;
        for directory in [&userdata, &owned.root.join("host/runtime"), &owned.root.join("host")] {
            File::open(directory).and_then(|file| file.sync_all()).map_err(io_error)?;
        }
        // Issuer publication takes service-owner then launcher. Release this
        // launcher lease before that call; Service configuration already fences Direct.
        drop(lease);
        service_issuer::publish_current_issuer(&owned)?;
        Ok(config)
    }).await.map_err(io_error)??;
    Ok(status("stopped", Some(&config)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_identity_uses_v4_uuid_without_changing_request_id_policy() {
        let id = new_environment_id().unwrap();
        assert!(desktop_policy::uuid(&id));
        assert_eq!(id.as_bytes()[14], b'4');
        assert!(b"89ab".contains(&id.as_bytes()[19]));
        assert_ne!(id, new_environment_id().unwrap());
    }
    #[test]
    fn configured_owners_and_existing_data_are_never_migrated() {
        let base = std::env::temp_dir().join(format!("blackcrab-fresh-service-{}", random_secret().unwrap()));
        fs::create_dir(&base).unwrap();
        let host = ManagedHost::new(base.join("owner"));
        host.prepare().unwrap(); host.initialize_locked().unwrap();
        assert!(fresh_owner(&host).is_ok());
        write_new(&host.root.join("host/history"), b"existing data").unwrap();
        assert!(fresh_owner(&host).is_err());
        assert_eq!(fs::read(host.root.join("host/history")).unwrap(), b"existing data");
        fs::remove_file(host.root.join("host/history")).unwrap();
        for ownership in [OwnershipMode::Direct, OwnershipMode::Service] {
            let config = Configuration { schema:1, ownership, artifact_path:base.join("runtime"),
                manifest_digest:"a".repeat(64), bootstrap_secret:"b".repeat(64), environment_id:None, browser:None };
            host.save_config(&config).unwrap();
            let before = fs::read(host.root.join("configuration.json")).unwrap();
            assert!(fresh_owner(&host).is_err());
            assert_eq!(fs::read(host.root.join("configuration.json")).unwrap(), before);
        }
        fs::remove_dir_all(base).unwrap();
    }
}
