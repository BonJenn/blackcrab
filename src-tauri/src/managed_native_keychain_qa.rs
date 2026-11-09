//! Test-only permit for one reviewed, strictly signed QA artifact and archive.
use std::path::Path;

use super::super::{ManagedNativeEntry, NativeDesktopStatus, Pins};
use crate::managed_desktop::DesktopIdentity;
use crate::managed_host::ManagedHost;

/// Fixed source pins identify the independently verified archive and complete source graph.
/// Paths and environment variables cannot change these expectations.
pub(crate) struct QaArtifactExpectations {
    pub(crate) manifest_sha256: &'static str,
    pub(crate) archive_sha256: &'static str,
    pub(crate) production_registry_sha256: &'static str,
    pub(crate) nonce: &'static str,
    pub(crate) app_id: &'static str,
    pub(crate) app_name: &'static str,
    pub(crate) identity_json: &'static str,
    pub(crate) identity_json_sha256: &'static str,
    pub(crate) build_identity_json: &'static str,
}

const REVIEWED_ARTIFACT: QaArtifactExpectations = QaArtifactExpectations {
    manifest_sha256: r####"82659693f28e09d9d9794c51f0a76e01d2c3853c7704171909d381dc45839178"####,
    archive_sha256: r####"90cc159b7dafe12c5f2503845d51fff9f5228a6ac1b97bcfb9ee5d0d42f5364b"####,
    production_registry_sha256: r####"2548af76196fff6e472ff9899cf0499e9509056dba0a7d84d0164c672254b9e6"####,
    nonce: r####"fce2f49e77256ba8"####,
    app_id: r####"com.blackcrab.desktop.managed.nativekeychainqa.nfce2f49e77256ba8"####,
    app_name: r####"Blackcrab Native QA fce2f49e77256ba8 Beta"####,
    identity_json: r####"{
  "version": 1,
  "nonce": "fce2f49e77256ba8",
  "appVersion": "0.1.7",
  "appName": "Blackcrab Native QA fce2f49e77256ba8 Beta",
  "service": "Blackcrab Native QA fce2f49e77256ba8 Beta Safe Storage",
  "account": "Blackcrab Native QA fce2f49e77256ba8 Beta",
  "nonAdoptable": true,
  "records": [
    {
      "target": "apps/desktop/src/app/DesktopEnvironment.ts",
      "phase": "source",
      "beforeSha256": "bc6c3cc38247e58fc322b85ae4d003d1eb683cc2377e60cba4efcd5538cb660f",
      "afterSha256": "227e31bbab68398ceadca72763f5400e23c67d77e741a48db75996cbf2fe1e59",
      "changed": true
    },
    {
      "target": "apps/desktop/src/app/ManagedBootstrap.mjs",
      "phase": "preserved-source",
      "beforeSha256": "20c35c4e3909c4ea18188fb15dfcc499ef8839021334e514514bb439cb2eadef",
      "afterSha256": "20c35c4e3909c4ea18188fb15dfcc499ef8839021334e514514bb439cb2eadef",
      "changed": false
    },
    {
      "target": "apps/desktop/src/app/managed-desktop/descriptor.mjs",
      "phase": "source",
      "beforeSha256": "bf0526ba6f5a32d00083771eb8a473dcff22353e1a8598234e2af4e298026576",
      "afterSha256": "7f78055d9bc269259490261f675d15e4251e7982630a801f4272f0ef6217c443",
      "changed": true
    },
    {
      "target": "apps/desktop/src/app/DesktopAppIdentity.ts",
      "phase": "preserved-source",
      "beforeSha256": "89063852cf93ca9d303e0182c63b0c85e594d50634a3161d912f48b379b34dba",
      "afterSha256": "89063852cf93ca9d303e0182c63b0c85e594d50634a3161d912f48b379b34dba",
      "changed": false
    },
    {
      "target": "apps/desktop/src/electron/ElectronSafeStorage.ts",
      "phase": "preserved-source",
      "beforeSha256": "ac7e34845e98b1c8302c757cd968c3d10478a0ecc9c2e4061bd8684c07f2f6e2",
      "afterSha256": "ac7e34845e98b1c8302c757cd968c3d10478a0ecc9c2e4061bd8684c07f2f6e2",
      "changed": false
    },
    {
      "target": "apps/desktop/src/main.ts",
      "phase": "preserved-source",
      "beforeSha256": "a2dd1d5402d1a811c9682859c3d6a888ec43ba15553654ae74074483cbf75b5c",
      "afterSha256": "a2dd1d5402d1a811c9682859c3d6a888ec43ba15553654ae74074483cbf75b5c",
      "changed": false
    },
    {
      "target": "Blackcrab.app/Contents/Resources/app/package.json",
      "phase": "package",
      "beforeSha256": "367f6d3865f8910d0732f53c1696e67f649a625932eac597909a2dc25c1f947e",
      "afterSha256": "1900080e5a44e1da2083ec8a3c1c60e91f4a16eb654f9aeb0a7c7a3b12d6cb0e",
      "changed": true
    },
    {
      "target": "Blackcrab.app/Contents/Info.plist",
      "phase": "package",
      "beforeSha256": "ce112236aaa06049b28bb12a567e1dc9fff0f190a46fdc9e9952912b2d1f6f68",
      "afterSha256": "64c6d8a275f79ff6c1bb971ce40e7a27f6e0fab3fffe74d15ab534df4264dfdf",
      "changed": true
    },
    {
      "target": "apps/desktop/src/app/managed-desktop/environment.mjs",
      "phase": "preserved-source",
      "beforeSha256": "54607d51d65a300f3331d8ce0ee63d9933c1547cb46f32fb89d7b45f4e6ed892",
      "afterSha256": "54607d51d65a300f3331d8ce0ee63d9933c1547cb46f32fb89d7b45f4e6ed892",
      "changed": false
    }
  ]
}
"####,
    identity_json_sha256: r####"6ca5b45814e4a852ea7f16955a638f21a9262920b25639afca88d4a6eaa5df8a"####,
    build_identity_json: r####"{"nonce":"fce2f49e77256ba8","appVersion":"0.1.7","stage":"Beta","baseName":"Blackcrab Native QA fce2f49e77256ba8","appName":"Blackcrab Native QA fce2f49e77256ba8 Beta","service":"Blackcrab Native QA fce2f49e77256ba8 Beta Safe Storage","account":"Blackcrab Native QA fce2f49e77256ba8 Beta","namespace":{"appId":"com.blackcrab.desktop.managed.nativekeychainqa.nfce2f49e77256ba8","name":"Blackcrab Native QA fce2f49e77256ba8 Beta","scheme":"blackcrab","profile":"blackcrab-managed-v1"}}"####,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ReviewedQaPermit {
    sealed: (),
}
impl ReviewedQaPermit {
    pub(crate) fn pins(&self) -> &'static QaArtifactExpectations {
        &REVIEWED_ARTIFACT
    }
}
pub(crate) fn reviewed() -> Result<ReviewedQaPermit, String> {
    Ok(ReviewedQaPermit { sealed: () })
}

/// Paths are locators only. Source pins remain authoritative for every payload.
fn reviewed_entry(
    resources: &Path,
    data: &Path,
) -> Result<(ManagedNativeEntry, DesktopIdentity), String> {
    let permit = reviewed()?;
    let pin = permit.pins();
    let entry = ManagedNativeEntry::from_inputs(
        resources,
        data,
        Pins {
            host_manifest: Some(super::HOST_MANIFEST),
            host_archive: Some(super::HOST_ARCHIVE),
            desktop_manifest: Some(pin.manifest_sha256),
            desktop_archive: Some(pin.archive_sha256),
        },
    );
    let identity = identity_for_entry_with_permit(&entry, permit)?;
    Ok((entry, identity))
}
fn identity_for_entry_with_permit(
    entry: &ManagedNativeEntry,
    permit: ReviewedQaPermit,
) -> Result<DesktopIdentity, String> {
    let pin = permit.pins();
    if entry.desktop_manifest.as_deref() != Some(pin.manifest_sha256) {
        return Err("Reviewed QA entry manifest differs".into());
    }
    entry
        .desktop
        .as_ref()
        .ok_or("Reviewed QA payload is unavailable")?
        .check_reviewed_native_keychain_qa(&permit)?;
    Ok(DesktopIdentity::NativeKeychainQa(permit))
}

// These thin test-only dispatchers reuse the real entry/extractor/owner/broker.
// They are not connected to a renderer, normal entrypoint or production flag.
async fn open_reviewed(
    entry: &ManagedNativeEntry,
    host: ManagedHost,
) -> Result<NativeDesktopStatus, String> {
    let permit = reviewed()?;
    let identity = identity_for_entry_with_permit(entry, permit)?;
    Ok(entry.open_for_identity(host, identity).await)
}
async fn status_reviewed(entry: &ManagedNativeEntry) -> Result<NativeDesktopStatus, String> {
    let permit = reviewed()?;
    let identity = identity_for_entry_with_permit(entry, permit)?;
    Ok(entry.status_for_identity(identity).await)
}

#[test]
fn reviewed_identity_pins_are_internally_consistent() {
    use sha2::{Digest, Sha256};
    let permit = reviewed().unwrap();
    let pin = permit.pins();
    assert_eq!(
        format!("{:x}", Sha256::digest(pin.identity_json.as_bytes())),
        pin.identity_json_sha256
    );
    assert_eq!(
        pin.app_id,
        format!(
            "com.blackcrab.desktop.managed.nativekeychainqa.n{}",
            pin.nonce
        )
    );
    let identity: serde_json::Value = serde_json::from_str(pin.identity_json).unwrap();
    assert_eq!(identity["nonce"], pin.nonce);
    assert_eq!(identity["appName"], pin.app_name);
    assert_eq!(identity["records"].as_array().unwrap().len(), 9);
}

#[test]
fn reviewed_entry_factory_refuses_unavailable_archives() {
    let impossible = Path::new("/dev/null/native-keychain-qa-must-not-be-accessed");
    assert!(reviewed_entry(impossible, impossible).is_err());
}

#[tokio::test]
#[ignore = "requires independently reviewed signed QA artifact pins and a fresh owned native fixture"]
async fn reviewed_native_launch_reuse_quit_reopen() {
    let permit =
        reviewed().expect("Reviewed signed QA artifact pins are required before fixture IO");
    super::native_launch_reuse_quit_reopen(DesktopIdentity::NativeKeychainQa(permit)).await;
}
