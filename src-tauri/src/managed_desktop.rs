//! Private native-client owner/launcher. Deliberately not registered in lib.rs.
//! Package verification establishes unsigned consistency, not publisher authenticity.
use crate::managed_host::{DesktopHostBinding, DesktopPairGrant, ManagedHost};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
#[path = "managed_desktop_home.rs"]
mod account_home;

const MANIFEST: &str = "blackcrab-managed-desktop.json";
const APP_ID: &str = "com.blackcrab.desktop.managed";
const PROFILE: &str = "blackcrab-managed-v1";
const EXECUTABLE: &str = "Blackcrab.app/Contents/MacOS/Blackcrab";
use crate::managed_host::desktop_policy::{self, Frames, MAX_FRAME};
const MAX_ENTRIES: usize = 50_000;
const MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
const PROFILE_MARKER: &[u8] = b"blackcrab-managed-desktop-profile-v1\n";
const PATCHES: &str = include_str!("../../managed-desktop/patches/registry.json");
const ASSETS: &str = include_str!("../../managed-desktop/assets/registry.json");

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
enum Entry {
    #[serde(rename = "file")]
    File {
        path: String,
        bytes: u64,
        executable: bool,
        sha256: String,
    },
    #[serde(rename = "directory")]
    Directory { path: String },
    #[serde(rename = "symlink")]
    Symlink { path: String, target: String },
}
impl Entry {
    fn path(&self) -> &str {
        match self {
            Self::File { path, .. } | Self::Directory { path } | Self::Symlink { path, .. } => path,
        }
    }
}
/// Immutable purpose carried only by a successfully verified package/client.
/// The QA variant requires the sealed permit for the fixed reviewed artifact.
/// It is available only in the macOS arm64 test build.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DesktopIdentity {
    Production,
    #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
    NativeKeychainQa(crate::managed_native_entry::acceptance::keychain_qa::ReviewedQaPermit),
}
impl DesktopIdentity {
    fn app_id(self) -> &'static str {
        match self {
            Self::Production => APP_ID,
            #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
            Self::NativeKeychainQa(permit) => permit.pins().app_id,
        }
    }
    fn app_name(self) -> &'static str {
        match self {
            Self::Production => "Blackcrab",
            #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
            Self::NativeKeychainQa(permit) => permit.pins().app_name,
        }
    }
    fn kind(self) -> &'static str {
        match self {
            Self::Production => "blackcrab-managed-desktop",
            #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
            Self::NativeKeychainQa(_) => "blackcrab-managed-desktop-native-keychain-qa",
        }
    }
    fn package_role(self) -> &'static str {
        match self {
            Self::Production => "production",
            #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
            Self::NativeKeychainQa(_) => "native-keychain-qa",
        }
    }
    fn namespace(self) -> Value {
        json!({"appId":self.app_id(),"name":self.app_name(),"scheme":"blackcrab","profile":PROFILE})
    }
    fn check_digest(self, digest: &str) -> Result<(), String> {
        match self {
            Self::Production => {
                let _ = digest;
                Ok(())
            }
            #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
            Self::NativeKeychainQa(permit) if permit.pins().manifest_sha256 == digest => Ok(()),
            #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
            Self::NativeKeychainQa(_) => Err(error()),
        }
    }
}
fn same_verified_client(
    actual_identity: DesktopIdentity,
    actual_digest: &str,
    expected_identity: DesktopIdentity,
    expected_digest: &str,
) -> bool {
    actual_identity == expected_identity && actual_digest == expected_digest
}

pub(super) struct VerifiedDesktop {
    root: PathBuf,
    executable: PathBuf,
    manifest_digest: String,
    identity: DesktopIdentity,
}
fn error() -> String {
    "Managed desktop package or private owner contract was refused".into()
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn relative(s: &str) -> Result<&str, String> {
    desktop_policy::relative(s).map_err(|_| error())
}
fn digest_file(path: &Path) -> Result<String, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|_| error())?;
    if !file.metadata().map_err(|_| error())?.is_file() {
        return Err(error());
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|_| error())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| error())?;
    if !meta.is_file() || meta.len() > maximum {
        return Err(error());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(|_| error())?;
    let mut bytes = Vec::new();
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error())?;
    if bytes.len() as u64 > maximum {
        return Err(error());
    }
    Ok(bytes)
}
fn resolve_link(start: &str, entries: &BTreeMap<String, Entry>) -> Result<String, String> {
    desktop_policy::resolve_link(start, |p| {
        entries.get(p).map(|e| match e {
            Entry::Symlink { target, .. } => Some(target.as_str()),
            _ => None,
        })
    })
    .map_err(|_| error())
}
fn plist_string<'a>(xml: &'a str, key: &str) -> Result<&'a str, String> {
    desktop_policy::plist_string(xml, key).map_err(|_| error())
}
// Only compile-time reviewed registry paths may step once above source-patches.
// Inventory paths keep the stricter relative() contract without any parent aliases.
fn reviewed_patch_path(file: &str) -> Result<String, String> {
    if let Some(root_file) = file.strip_prefix("../") {
        relative(root_file)?;
        Ok(root_file.to_owned())
    } else {
        relative(file)?;
        Ok(format!("source-patches/{file}"))
    }
}
fn verify_reviewed_patch_payload(
    root: &Path,
    entries: &BTreeMap<String, Entry>,
    file: &str,
    expected: &str,
) -> Result<(), String> {
    let relative_path = reviewed_patch_path(file)?;
    if !matches!(entries.get(&relative_path), Some(Entry::File {sha256, ..}) if sha256 == expected)
    {
        return Err(error());
    }
    let mut current = root.to_owned();
    let mut prefix = String::new();
    let components: Vec<_> = relative_path.split('/').collect();
    for (index, component) in components.iter().enumerate() {
        current.push(component);
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(component);
        let meta = fs::symlink_metadata(&current).map_err(|_| error())?;
        if meta.file_type().is_symlink() {
            return Err(error());
        }
        if index + 1 < components.len()
            && (!meta.is_dir() || !matches!(entries.get(&prefix), Some(Entry::Directory { .. })))
        {
            return Err(error());
        }
    }
    if digest_file(&current)? != expected {
        return Err(error());
    }
    Ok(())
}
/// Selected digest is an explicit adoption consistency anchor, not a publisher signature.
#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
fn verify_keychain_qa_identity_evidence(
    root: &Path,
    manifest: &Value,
    entries: &BTreeMap<String, Entry>,
    package: &Value,
    permit: &crate::managed_native_entry::acceptance::keychain_qa::ReviewedQaPermit,
) -> Result<(), String> {
    let pins = permit.pins();
    let identity = DesktopIdentity::NativeKeychainQa(*permit);
    let is_digest = |value: &str| {
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    };
    if pins.nonce.len() != 16
        || !pins
            .nonce
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || pins.app_id
            != format!(
                "com.blackcrab.desktop.managed.nativekeychainqa.n{}",
                pins.nonce
            )
        || !pins
            .app_name
            .starts_with(&format!("Blackcrab Native QA {} ", pins.nonce))
        || pins.app_name.len() > 160
        || !is_digest(pins.archive_sha256)
        || !is_digest(pins.production_registry_sha256)
        || sha(PATCHES.as_bytes()) != pins.production_registry_sha256
        || digest_file(&root.join("source-patches/registry.json"))?
            != pins.production_registry_sha256
        || !is_digest(pins.identity_json_sha256)
        || sha(pins.identity_json.as_bytes()) != pins.identity_json_sha256
        || package.get("productName") != Some(&json!(pins.app_name))
    {
        return Err(error());
    }
    let expected: Value = serde_json::from_str(pins.identity_json).map_err(|_| error())?;
    let build_identity: Value =
        serde_json::from_str(pins.build_identity_json).map_err(|_| error())?;
    if expected.get("version") != Some(&json!(1))
        || expected.get("nonce") != Some(&json!(pins.nonce))
        || expected.get("appName") != Some(&json!(pins.app_name))
        || expected.get("account") != Some(&json!(pins.app_name))
        || expected.get("service") != Some(&json!(format!("{} Safe Storage", pins.app_name)))
        || expected.get("nonAdoptable") != Some(&json!(true))
        || manifest.get("nativeKeychainQaIdentity") != Some(&expected)
    {
        return Err(error());
    }
    let metadata = read_bounded(
        &root.join("native-keychain-qa/identity.json"),
        MAX_FRAME as u64,
    )?;
    if sha(&metadata) != pins.identity_json_sha256
        || serde_json::from_slice::<Value>(&metadata).map_err(|_| error())? != expected
    {
        return Err(error());
    }
    let records = expected
        .get("records")
        .and_then(Value::as_array)
        .ok_or_else(error)?;
    if records.len() != 9 {
        return Err(error());
    }
    let mut proof_paths: HashSet<String> = [
        "native-keychain-qa",
        "native-keychain-qa/before",
        "native-keychain-qa/after",
        "native-keychain-qa/identity.json",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    let mut package_targets = HashSet::new();
    for (index, record) in records.iter().enumerate() {
        let target = relative(
            record
                .get("target")
                .and_then(Value::as_str)
                .ok_or_else(error)?,
        )?;
        for (phase, field) in [("before", "beforeSha256"), ("after", "afterSha256")] {
            let digest = record
                .get(field)
                .and_then(Value::as_str)
                .ok_or_else(error)?;
            let path = format!("native-keychain-qa/{phase}/{index}.txt");
            if !is_digest(digest)
                || !matches!(entries.get(&path), Some(Entry::File { .. }))
                || digest_file(&root.join(&path))? != digest
            {
                return Err(error());
            }
            proof_paths.insert(path);
        }
        if record.get("phase") == Some(&json!("package")) {
            if !matches!(
                target,
                "Blackcrab.app/Contents/Resources/app/package.json"
                    | "Blackcrab.app/Contents/Info.plist"
            ) || !package_targets.insert(target)
                || digest_file(&root.join(target))?
                    != record["afterSha256"].as_str().ok_or_else(error)?
            {
                return Err(error());
            }
        }
    }
    if package_targets.len() != 2
        || entries
            .keys()
            .filter(|path| {
                path.as_str() == "native-keychain-qa" || path.starts_with("native-keychain-qa/")
            })
            .cloned()
            .collect::<HashSet<_>>()
            != proof_paths
    {
        return Err(error());
    }
    for path in [
        "native-keychain-qa",
        "native-keychain-qa/before",
        "native-keychain-qa/after",
    ] {
        if !matches!(entries.get(path), Some(Entry::Directory { .. })) {
            return Err(error());
        }
    }
    let provenance: Value = serde_json::from_slice(&read_bounded(
        &root.join("BUILD-PROVENANCE.json"),
        2 * 1024 * 1024,
    )?)
    .map_err(|_| error())?;
    if provenance.get("namespace") != Some(&identity.namespace())
        || provenance.get("nativeKeychainQaIdentity") != Some(&build_identity)
    {
        return Err(error());
    }
    Ok(())
}

pub(super) fn verify_package(
    selected: &Path,
    expected_manifest_sha256: &str,
) -> Result<VerifiedDesktop, String> {
    verify_package_for_identity(
        selected,
        expected_manifest_sha256,
        DesktopIdentity::Production,
    )
}
#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
pub(crate) fn verify_reviewed_keychain_qa_package(
    selected: &Path,
    permit: &crate::managed_native_entry::acceptance::keychain_qa::ReviewedQaPermit,
) -> Result<VerifiedDesktop, String> {
    verify_package_for_identity(
        selected,
        permit.pins().manifest_sha256,
        DesktopIdentity::NativeKeychainQa(*permit),
    )
}
fn verify_package_for_identity(
    selected: &Path,
    expected_manifest_sha256: &str,
    identity: DesktopIdentity,
) -> Result<VerifiedDesktop, String> {
    identity.check_digest(expected_manifest_sha256)?;
    if expected_manifest_sha256.len() != 64
        || !expected_manifest_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(error());
    }
    let metadata = fs::symlink_metadata(selected).map_err(|_| error())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(error());
    }
    let root = fs::canonicalize(selected).map_err(|_| error())?;
    let bytes = read_bounded(&root.join(MANIFEST), 16 * 1024 * 1024)?;
    if sha(&bytes) != expected_manifest_sha256 {
        return Err(error());
    }
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|_| error())?;
    if manifest.get("format") != Some(&json!(1))
        || manifest.get("kind") != Some(&json!(identity.kind()))
        || manifest.get("qaPolicy").is_some()
        || manifest.get("namespace") != Some(&identity.namespace())
        || manifest.get("upstream")
            != Some(
                &json!({"repository":"BonJenn/t3code","commit":"7f02de2eb8e253e0ec23f005b3cfff8e2c963be8","archiveSha256":"eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6"}),
            )
        || manifest.get("electron")
            != Some(
                &json!({"version":"44.10.1","platform":"darwin","arch":"arm64","archiveSha256":"687f922034f1e991ab34ed7f47c4cb4e5c5e85e974b0ce155c22ce6d6f699aa3","url":"https://github.com/electron/electron/releases/download/v44.10.1/electron-v44.10.1-darwin-arm64.zip"}),
            )
    {
        return Err(error());
    }
    let patches: Vec<Value> = serde_json::from_str(PATCHES).map_err(|_| error())?;
    let expected: Vec<_> = patches
        .iter()
        .map(|p| json!({"id":p["id"],"sha256":p["sha256"]}))
        .collect();
    if manifest.get("sourcePatches") != Some(&json!(expected)) {
        return Err(error());
    }
    let list: Vec<Entry> =
        serde_json::from_value(manifest.get("files").cloned().ok_or_else(error)?)
            .map_err(|_| error())?;
    if list.len() > MAX_ENTRIES {
        return Err(error());
    }
    let mut entries = BTreeMap::new();
    let mut total = 0u64;
    for e in list {
        relative(e.path())?;
        if e.path() == MANIFEST || e.path() == "qa-policy" || e.path().starts_with("qa-policy/") {
            return Err(error());
        }
        if let Entry::File { bytes, sha256, .. } = &e {
            total = total.checked_add(*bytes).ok_or_else(error)?;
            if total > MAX_BYTES
                || sha256.len() != 64
                || !sha256
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                return Err(error());
            }
        }
        if entries.insert(e.path().to_owned(), e).is_some() {
            return Err(error());
        }
    }
    let mut found = HashSet::new();
    fn visit(
        root: &Path,
        folder: &Path,
        entries: &BTreeMap<String, Entry>,
        found: &mut HashSet<String>,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 128 {
            return Err(error());
        }
        for item in fs::read_dir(folder).map_err(|_| error())? {
            let item = item.map_err(|_| error())?;
            let file = item.path();
            let p = file
                .strip_prefix(root)
                .map_err(|_| error())?
                .to_str()
                .ok_or_else(error)?
                .to_owned();
            if p == MANIFEST {
                continue;
            }
            relative(&p)?;
            let expected = entries.get(&p).ok_or_else(error)?;
            let m = fs::symlink_metadata(&file).map_err(|_| error())?;
            match expected {
                Entry::Directory { .. } if m.is_dir() && !m.file_type().is_symlink() => {
                    visit(root, &file, entries, found, depth + 1)?
                }
                Entry::Symlink { target, .. } if m.file_type().is_symlink() => {
                    if fs::read_link(&file).map_err(|_| error())?.to_str() != Some(target) {
                        return Err(error());
                    }
                    let resolved = resolve_link(&p, entries)?;
                    if fs::canonicalize(&file).map_err(|_| error())? != root.join(resolved) {
                        return Err(error());
                    }
                }
                Entry::File {
                    bytes,
                    executable,
                    sha256,
                    ..
                } if m.is_file() && !m.file_type().is_symlink() => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::MetadataExt;
                        if m.nlink() != 1 || ((m.mode() & 0o111) != 0) != *executable {
                            return Err(error());
                        }
                    }
                    if m.len() != *bytes || digest_file(&file)? != *sha256 {
                        return Err(error());
                    }
                }
                _ => return Err(error()),
            }
            found.insert(p);
            if found.len() > MAX_ENTRIES {
                return Err(error());
            }
        }
        Ok(())
    }
    visit(&root, &root, &entries, &mut found, 0)?;
    if found.len() != entries.len() {
        return Err(error());
    }
    for p in [
        EXECUTABLE,
        "Blackcrab.app/Contents/Info.plist",
        "Blackcrab.app/Contents/Resources/app/package.json",
        "Blackcrab.app/Contents/Resources/app/apps/desktop/dist-electron/main.cjs",
        "Blackcrab.app/Contents/Resources/app/apps/desktop/dist-electron/preload.cjs",
        "Blackcrab.app/Contents/Resources/app/apps/server/dist/client/index.html",
        "LICENSE.upstream",
        "LICENSE.electron",
        "BUILD-PROVENANCE.json",
    ] {
        if !matches!(entries.get(p), Some(Entry::File { .. })) {
            return Err(error());
        }
    }
    if !matches!(
        entries.get(EXECUTABLE),
        Some(Entry::File {
            executable: true,
            ..
        })
    ) {
        return Err(error());
    }
    let mut native = OpenOptions::new();
    native.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        native.custom_flags(libc::O_NOFOLLOW);
    }
    let mut header = [0u8; 32];
    native
        .open(root.join(EXECUTABLE))
        .map_err(|_| error())?
        .read_exact(&mut header)
        .map_err(|_| error())?;
    if !desktop_policy::arm64_macho(&header) {
        return Err(error());
    }
    for p in patches {
        verify_reviewed_patch_payload(
            &root,
            &entries,
            p["file"].as_str().ok_or_else(error)?,
            p["sha256"].as_str().ok_or_else(error)?,
        )?;
    }
    let assets: Vec<Value> = serde_json::from_str(ASSETS).map_err(|_| error())?;
    for a in assets {
        let target = a["target"].as_str().ok_or_else(error)?;
        relative(target)?;
        if digest_file(
            &root
                .join("Blackcrab.app/Contents/Resources/app")
                .join(target),
        )? != a["afterSha256"].as_str().ok_or_else(error)?
        {
            return Err(error());
        }
    }
    let package: Value = serde_json::from_slice(&read_bounded(
        &root.join("Blackcrab.app/Contents/Resources/app/package.json"),
        MAX_FRAME as u64,
    )?)
    .map_err(|_| error())?;
    if package.get("blackcrabManagedClient") != Some(&json!(identity.package_role()))
        || package.get("name") != Some(&json!("blackcrab-managed-desktop"))
        || package.get("main") != Some(&json!("apps/desktop/dist-electron/boot.cjs"))
        || package.get("t3codeCommitHash")
            != Some(&json!("7f02de2eb8e253e0ec23f005b3cfff8e2c963be8"))
    {
        return Err(error());
    }
    let plist = read_bounded(
        &root.join("Blackcrab.app/Contents/Info.plist"),
        2 * 1024 * 1024,
    )?;
    let xml = std::str::from_utf8(&plist).map_err(|_| error())?;
    for (k, v) in [
        ("CFBundleIdentifier", identity.app_id()),
        ("CFBundleExecutable", "Blackcrab"),
        ("CFBundleName", identity.app_name()),
        ("CFBundleDisplayName", identity.app_name()),
    ] {
        if plist_string(xml, k)? != v {
            return Err(error());
        }
    }
    #[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
    if let DesktopIdentity::NativeKeychainQa(permit) = identity {
        verify_keychain_qa_identity_evidence(&root, &manifest, &entries, &package, &permit)?;
    }
    Ok(VerifiedDesktop {
        executable: root.join(EXECUTABLE),
        root,
        manifest_digest: expected_manifest_sha256.into(),
        identity,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Renewal {
    version: u32,
    kind: String,
    request_id: String,
    generation: u64,
    environment_id: String,
}
fn uuid(s: &str) -> bool {
    desktop_policy::uuid(s)
}
fn authorize_renewal(
    bytes: &[u8],
    binding: &DesktopHostBinding,
    seen: &mut HashSet<String>,
) -> Result<Renewal, String> {
    if bytes.len() > MAX_FRAME {
        return Err(error());
    }
    let request: Renewal = serde_json::from_slice(bytes).map_err(|_| error())?;
    if request.version != 1
        || request.kind != "native-client-credential"
        || request.generation != binding.generation
        || request.generation == 0
        || request.generation > MAX_SAFE
        || request.environment_id != binding.environment_id
        || !uuid(&request.request_id)
        || seen.len() >= 1024
        || !seen.insert(request.request_id.clone())
    {
        return Err(error());
    }
    Ok(request)
}
fn now_ms() -> Result<u64, String> {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| error())?
            .as_millis(),
    )
    .map_err(|_| error())
}
fn descriptor(
    binding: &DesktopHostBinding,
    profile: &Path,
    grant: &DesktopPairGrant,
) -> Result<Vec<u8>, String> {
    descriptor_for_identity(binding, profile, grant, DesktopIdentity::Production)
}
fn descriptor_for_identity(
    binding: &DesktopHostBinding,
    profile: &Path,
    grant: &DesktopPairGrant,
    identity: DesktopIdentity,
) -> Result<Vec<u8>, String> {
    let now = now_ms()?;
    let origin = url::Url::parse(&binding.origin).map_err(|_| error())?;
    if origin.scheme() != "http"
        || origin.host_str() != Some("127.0.0.1")
        || origin.port().is_none()
        || origin.path() != "/"
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.query().is_some()
        || origin.fragment().is_some()
        || origin.as_str() != binding.origin
        || grant.credential.len() != 12
        || !grant
            .credential
            .bytes()
            .all(|b| b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ".contains(&b))
    {
        return Err(error());
    }
    if !uuid(&binding.environment_id)
        || binding.generation == 0
        || binding.generation > MAX_SAFE
        || grant.expires_at <= now
        || grant.expires_at > now.saturating_add(86_400_000)
    {
        return Err(error());
    }
    let mut value = json!({"version":1,"owner":{"kind":"blackcrab-managed-host","generation":binding.generation,"environmentId":binding.environment_id,"origin":binding.origin,"serverVersion":"0.1.7","orchestrationProtocolVersion":2},"profile":{"root":profile,"namespace":PROFILE,"appId":identity.app_id()},"control":{"kind":"unavailable"},"authorization":{"kind":"paired-credential","credential":grant.credential,"expiresAt":grant.expires_at,"renewal":{"kind":"owner-credential-fd-v1","fd":4}}});
    if let Some(capability) = &binding.browser {
        if capability.generation != binding.generation
            || capability.key.len() != 64
            || !capability
                .key
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !capability.path.is_absolute()
            || capability.path.as_os_str().as_encoded_bytes().len() > 100
        {
            return Err(error());
        }
        value["browser"] = json!({"kind":"leased-uds-v2","generation":binding.generation,"environmentId":binding.environment_id,"path":capability.path,"key":capability.key});
    }
    let bytes = serde_json::to_vec(&value).map_err(|_| error())?;
    if bytes.len() > MAX_FRAME {
        return Err(error());
    }
    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn prepare_profile(path: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
    let parent = path.parent().ok_or_else(error)?;
    let parent_meta = fs::symlink_metadata(parent).map_err(|_| error())?;
    if !parent_meta.is_dir()
        || parent_meta.file_type().is_symlink()
        || parent_meta.uid() != unsafe { libc::geteuid() }
        || parent_meta.mode() & 0o077 != 0
    {
        return Err(error());
    }
    let marker = path.join(".blackcrab-managed-desktop");
    if !path.exists() {
        fs::create_dir(path).map_err(|_| error())?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| error())?;
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&marker)
            .map_err(|_| error())?;
        f.write_all(PROFILE_MARKER).map_err(|_| error())?;
        f.sync_all().map_err(|_| error())?;
    }
    let meta = fs::symlink_metadata(path).map_err(|_| error())?;
    if !meta.is_dir()
        || meta.file_type().is_symlink()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o077 != 0
        || read_bounded(&marker, 128)? != PROFILE_MARKER
    {
        return Err(error());
    }
    let canonical = fs::canonicalize(path).map_err(|_| error())?;
    for name in ["home", "tmp"] {
        let p = canonical.join(name);
        if !p.exists() {
            fs::create_dir(&p).map_err(|_| error())?;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).map_err(|_| error())?;
        }
        let m = fs::symlink_metadata(&p).map_err(|_| error())?;
        if !m.is_dir()
            || m.file_type().is_symlink()
            || m.uid() != unsafe { libc::geteuid() }
            || m.mode() & 0o077 != 0
        {
            return Err(error());
        }
    }
    Ok(canonical)
}
fn child_alive(child: &Arc<Mutex<Child>>) -> Result<bool, String> {
    desktop_policy::captured_child_alive(child).map_err(|_| error())
}
fn reap_captured(child: Arc<Mutex<Child>>) {
    std::thread::spawn(move || {
        while child_alive(&child).unwrap_or(false) {
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

#[cfg(target_os = "macos")]
pub(super) struct NativeDesktop {
    child: Arc<Mutex<Child>>,
    control: std::os::unix::net::UnixStream,
    pub(super) package_digest: String,
    identity: DesktopIdentity,
}
#[cfg(target_os = "macos")]
impl NativeDesktop {
    pub(super) fn detach(&self) {
        let _ = self.control.shutdown(std::net::Shutdown::Both);
    }
    pub(super) fn is_running(&self) -> Result<bool, String> {
        child_alive(&self.child)
    }
}
#[cfg(target_os = "macos")]
impl Drop for NativeDesktop {
    fn drop(&mut self) {
        self.detach();
        reap_captured(self.child.clone());
    }
}

/// Root may hold exactly one of these in native state after reviewing integration.
/// Repeated explicit opens reuse the captured client; no automatic restart/reauthentication.
#[cfg(target_os = "macos")]
#[derive(Default)]
pub(super) struct NativeDesktopOwner {
    active: tokio::sync::Mutex<Option<NativeDesktop>>,
}
#[cfg(target_os = "macos")]
impl NativeDesktopOwner {
    pub(super) async fn running(&self) -> Result<bool, String> {
        self.running_for_identity(DesktopIdentity::Production, None)
            .await
    }
    pub(super) async fn running_for_identity(
        &self,
        identity: DesktopIdentity,
        expected_digest: Option<&str>,
    ) -> Result<bool, String> {
        match self.active.lock().await.as_ref() {
            Some(client) => {
                let alive = client.is_running()?;
                if alive
                    && (client.identity != identity
                        || expected_digest
                            .is_some_and(|digest| client.package_digest.as_str() != digest))
                {
                    return Err(error());
                }
                Ok(alive)
            }
            None => Ok(false),
        }
    }
    pub(super) async fn open(
        &self,
        host: ManagedHost,
        selected: PathBuf,
        expected_digest: String,
    ) -> Result<bool, String> {
        self.open_for_identity(host, selected, expected_digest, DesktopIdentity::Production)
            .await
    }
    pub(super) async fn open_for_identity(
        &self,
        host: ManagedHost,
        selected: PathBuf,
        expected_digest: String,
        identity: DesktopIdentity,
    ) -> Result<bool, String> {
        identity.check_digest(&expected_digest)?;
        let mut active = self.active.lock().await;
        if let Some(client) = active.as_ref() {
            if client.is_running()? {
                if !same_verified_client(
                    client.identity,
                    &client.package_digest,
                    identity,
                    &expected_digest,
                ) {
                    return Err(
                        "Close the existing native client before changing its package".into(),
                    );
                }
                return Ok(false);
            }
        }
        *active = Some(launch_for_identity(host, selected, expected_digest, identity).await?);
        Ok(true)
    }
    /// Explicit detach closes only this client's owner socket; never a host/process signal.
    pub(super) async fn detach(&self) {
        if let Some(client) = self.active.lock().await.as_ref() {
            client.detach();
        }
    }
}

#[cfg(target_os = "macos")]
fn inherit_private_fds(
    command: &mut Command,
    descriptor: &std::os::unix::net::UnixStream,
    control: &std::os::unix::net::UnixStream,
) {
    use std::os::fd::AsRawFd;
    use std::os::unix::process::CommandExt;
    let d = descriptor.as_raw_fd();
    let c = control.as_raw_fd();
    // Duplicate both sources before remapping; either source can itself be3/4.
    unsafe {
        command.pre_exec(move || {
            let a = libc::fcntl(d, libc::F_DUPFD_CLOEXEC, 5);
            if a < 0 {
                return Err(std::io::Error::last_os_error());
            }
            let b = libc::fcntl(c, libc::F_DUPFD_CLOEXEC, 5);
            if b < 0 {
                libc::close(a);
                return Err(std::io::Error::last_os_error());
            }
            let ok = libc::dup2(a, 3) >= 0 && libc::dup2(b, 4) >= 0;
            libc::close(a);
            libc::close(b);
            if !ok {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// Backend-only launch. No app entrypoint, adoption persistence or arbitrary CLI exists here.
#[cfg(target_os = "macos")]
pub(super) async fn launch(
    host: ManagedHost,
    selected: PathBuf,
    expected_digest: String,
) -> Result<NativeDesktop, String> {
    launch_for_identity(host, selected, expected_digest, DesktopIdentity::Production).await
}
#[cfg(target_os = "macos")]
async fn launch_for_identity(
    host: ManagedHost,
    selected: PathBuf,
    expected_digest: String,
    identity: DesktopIdentity,
) -> Result<NativeDesktop, String> {
    if !cfg!(target_arch = "aarch64") {
        return Err("Managed desktop package is verified only for Apple Silicon".into());
    }
    let package = tokio::task::spawn_blocking(move || {
        verify_package_for_identity(&selected, &expected_digest, identity)
    })
    .await
    .map_err(|_| error())??;
    launch_verified(host, package).await
}
#[cfg(target_os = "macos")]
async fn launch_verified(
    host: ManagedHost,
    package: VerifiedDesktop,
) -> Result<NativeDesktop, String> {
    use std::os::unix::net::UnixStream;
    let verified_identity = package.identity;
    let binding = host.desktop_binding().await?;
    let profile = prepare_profile(&host.desktop_profile_root())?;
    let (mut descriptor_writer, descriptor_reader) = UnixStream::pair().map_err(|_| error())?;
    let (control, client_control) = UnixStream::pair().map_err(|_| error())?;
    let os_home = account_home::account_home()?;
    let mut command = Command::new(&package.executable);
    command
        .current_dir(&package.root)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", &os_home)
        .env("TMPDIR", profile.join("tmp"))
        .env("OTEL_SDK_DISABLED", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(all(test, target_os = "macos"))]
    crate::managed_native_entry::acceptance::configure_native_output(&mut command, &profile)?;
    inherit_private_fds(&mut command, &descriptor_reader, &client_control);
    let child = Arc::new(Mutex::new(
        command
            .spawn()
            .map_err(|_| "Managed native client could not start")?,
    ));
    #[cfg(all(test, target_os = "macos"))]
    crate::managed_native_entry::acceptance::record_native_spawn(
        &child,
        &profile,
        &package.executable,
    )?;
    drop(descriptor_reader);
    drop(client_control);
    let owner = NativeDesktop {
        child: child.clone(),
        control,
        package_digest: package.manifest_digest,
        identity: verified_identity,
    };
    if !child_alive(&child)? {
        return Err(error());
    }

    #[cfg(all(test, target_os = "macos"))]
    crate::managed_native_entry::acceptance::record_native_stage(
        &child,
        crate::managed_native_entry::acceptance::NativeStage::InitialGrantRequested,
    );
    let grant = tokio::time::timeout(Duration::from_secs(8), host.desktop_pair_grant(&binding))
        .await
        .map_err(|_| "Native pairing deadline exceeded")??;
    #[cfg(all(test, target_os = "macos"))]
    crate::managed_native_entry::acceptance::record_native_stage(
        &child,
        crate::managed_native_entry::acceptance::NativeStage::InitialGrantSucceeded,
    );

    if !child_alive(&child)? {
        return Err(error());
    }
    host.desktop_binding_current(&binding)?;
    descriptor_writer
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| error())?;
    descriptor_writer
        .write_all(&descriptor_for_identity(
            &binding,
            &profile,
            &grant,
            verified_identity,
        )?)
        .map_err(|_| error())?;
    descriptor_writer
        .shutdown(std::net::Shutdown::Write)
        .map_err(|_| error())?;
    drop(descriptor_writer);
    #[cfg(all(test, target_os = "macos"))]
    crate::managed_native_entry::acceptance::record_native_stage(
        &child,
        crate::managed_native_entry::acceptance::NativeStage::DescriptorWritten,
    );

    let stream = owner.control.try_clone().map_err(|_| error())?;
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        serve_broker(stream, child.clone(), host, binding, runtime);
        reap_captured(child);
    });
    Ok(owner)
}
#[cfg(target_os = "macos")]
fn serve_broker(
    mut stream: std::os::unix::net::UnixStream,
    child: Arc<Mutex<Child>>,
    host: ManagedHost,
    binding: DesktopHostBinding,
    runtime: tokio::runtime::Handle,
) {
    if stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .is_err()
        || stream
            .set_write_timeout(Some(Duration::from_secs(1)))
            .is_err()
    {
        let _ = stream.shutdown(std::net::Shutdown::Both);
        return;
    }
    let mut frames = Frames::default();
    #[cfg(all(test, target_os = "macos"))]
    crate::managed_native_entry::acceptance::record_native_stage(
        &child,
        crate::managed_native_entry::acceptance::NativeStage::BrokerReady,
    );

    let mut seen = HashSet::new();
    let mut chunk = [0u8; 2048];
    let result = (|| -> Result<(), String> {
        loop {
            host.desktop_binding_current(&binding)?;
            frames.check(Instant::now()).map_err(|_| error())?;
            if !child_alive(&child)? {
                return Ok(());
            }
            let n = match stream.read(&mut chunk) {
                Ok(0) => {
                    #[cfg(all(test, target_os = "macos"))]
                    crate::managed_native_entry::acceptance::record_native_stage(
                        &child,
                        crate::managed_native_entry::acceptance::NativeStage::BrokerEof,
                    );
                    return Ok(());
                }
                Ok(n) => n,
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    frames.check(Instant::now()).map_err(|_| error())?;
                    continue;
                }
                Err(_) => return Err(error()),
            };
            frames.check(Instant::now()).map_err(|_| error())?;
            let Some(frame) = frames
                .push(&chunk[..n], Instant::now())
                .map_err(|_| error())?
            else {
                continue;
            };

            #[cfg(all(test, target_os = "macos"))]
            crate::managed_native_entry::acceptance::record_native_stage(
                &child,
                crate::managed_native_entry::acceptance::NativeStage::RequestFrame,
            );
            let request = authorize_renewal(&frame, &binding, &mut seen)?;
            #[cfg(all(test, target_os = "macos"))]
            crate::managed_native_entry::acceptance::record_native_stage(
                &child,
                crate::managed_native_entry::acceptance::NativeStage::RequestAuthorized,
            );

            if !child_alive(&child)? {
                return Err(error());
            }
            let grant = runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(8), host.desktop_pair_grant(&binding))
                    .await
                    .map_err(|_| error())?
            })?;

            #[cfg(all(test, target_os = "macos"))]
            crate::managed_native_entry::acceptance::record_native_stage(
                &child,
                crate::managed_native_entry::acceptance::NativeStage::RenewalGrantSucceeded,
            );
            if !child_alive(&child)? {
                return Err(error());
            }
            host.desktop_binding_current(&binding)?;
            use std::os::fd::AsRawFd;
            let mut peek = [0u8; 1];
            let queued = unsafe {
                libc::recv(
                    stream.as_raw_fd(),
                    peek.as_mut_ptr().cast(),
                    1,
                    libc::MSG_PEEK | libc::MSG_DONTWAIT,
                )
            };
            if queued >= 0
                || std::io::Error::last_os_error().kind() != std::io::ErrorKind::WouldBlock
            {
                return Err(error());
            }
            let mut reply=serde_json::to_vec(&json!({"version":1,"kind":"paired-credential","requestId":request.request_id,"generation":binding.generation,"environmentId":binding.environment_id,"credential":grant.credential,"expiresAt":grant.expires_at})).map_err(|_|error())?;
            if reply.len() + 1 > MAX_FRAME {
                return Err(error());
            }
            reply.push(b'\n');
            stream.write_all(&reply).map_err(|_| error())?;
            #[cfg(all(test, target_os = "macos"))]
            crate::managed_native_entry::acceptance::record_native_stage(
                &child,
                crate::managed_native_entry::acceptance::NativeStage::ReplyWritten,
            );
        }
    })();
    #[cfg(all(test, target_os = "macos"))]
    crate::managed_native_entry::acceptance::record_native_stage(
        &child,
        if result.is_ok() {
            crate::managed_native_entry::acceptance::NativeStage::BrokerSucceeded
        } else {
            crate::managed_native_entry::acceptance::NativeStage::BrokerFailed
        },
    );
    let _ = result;
    let _ = stream.shutdown(std::net::Shutdown::Both);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> DesktopHostBinding {
        DesktopHostBinding {
            generation: 1,
            environment_id: "12345678-1234-1234-1234-123456789abc".into(),
            origin: "http://127.0.0.1:32123/".into(),
            browser: None,
        }
    }
    #[test]
    fn production_identity_and_live_reuse_remain_fixed() {
        let identity = DesktopIdentity::Production;
        assert_eq!(identity.app_id(), "com.blackcrab.desktop.managed");
        assert_eq!(identity.app_name(), "Blackcrab");
        assert_eq!(identity.kind(), "blackcrab-managed-desktop");
        assert_eq!(identity.package_role(), "production");
        assert_eq!(
            identity.namespace(),
            json!({"appId":"com.blackcrab.desktop.managed","name":"Blackcrab","scheme":"blackcrab","profile":"blackcrab-managed-v1"})
        );
        assert!(same_verified_client(
            identity,
            "verified-a",
            identity,
            "verified-a"
        ));
        assert!(!same_verified_client(
            identity,
            "verified-a",
            identity,
            "verified-b"
        ));
    }
    #[test]
    fn renewal_is_exact_epoch_bound_and_non_replayable() {
        let b = binding();
        let mut seen = HashSet::new();
        let request = json!({"version":1,"kind":"native-client-credential","requestId":"87654321-1234-1234-1234-123456789abc","generation":1,"environmentId":b.environment_id});
        let bytes = serde_json::to_vec(&request).unwrap();
        assert!(authorize_renewal(&bytes, &b, &mut seen).is_ok());
        assert!(authorize_renewal(&bytes, &b, &mut seen).is_err());
        for field in ["scopes", "pid", "origin"] {
            let mut v = request.clone();
            v[field] = json!("untrusted");
            assert!(
                authorize_renewal(&serde_json::to_vec(&v).unwrap(), &b, &mut HashSet::new())
                    .is_err()
            );
        }
        let mut v = request;
        v["generation"] = json!(2);
        assert!(
            authorize_renewal(&serde_json::to_vec(&v).unwrap(), &b, &mut HashSet::new()).is_err()
        );
    }
    #[test]
    fn links_are_internal_bounded_and_framework_only() {
        let mut entries = BTreeMap::new();
        for e in [
            Entry::Directory {
                path: "Blackcrab.app/Contents/Frameworks/F.framework/Versions/A".into(),
            },
            Entry::Symlink {
                path: "Blackcrab.app/Contents/Frameworks/F.framework/Versions/Current".into(),
                target: "A".into(),
            },
        ] {
            entries.insert(e.path().into(), e);
        }
        assert!(resolve_link(
            "Blackcrab.app/Contents/Frameworks/F.framework/Versions/Current",
            &entries
        )
        .is_ok());
        entries.insert(
            "outside".into(),
            Entry::Symlink {
                path: "outside".into(),
                target: "Blackcrab.app".into(),
            },
        );
        assert!(resolve_link("outside", &entries).is_err());
    }
    #[test]
    fn plist_identity_is_exact_and_unambiguous() {
        assert_eq!(
            plist_string(
                "<?xml?><plist><dict><key>CFBundleName</key><string>Blackcrab</string></dict></plist>",
                "CFBundleName"
            )
            .unwrap(),
            "Blackcrab"
        );
        assert!(plist_string("bplist00", "CFBundleName").is_err());
        assert!(plist_string(
            "<?xml?><key>A</key><string>x</string><key>A</key><string>y</string>",
            "A"
        )
        .is_err());
    }
    #[test]
    fn descriptor_is_bounded_and_contains_no_owner_secret() {
        let b = binding();
        let grant = DesktopPairGrant {
            credential: "23456789ABCD".into(),
            expires_at: now_ms().unwrap() + 60000,
        };
        let bytes = descriptor(&b, Path::new("/private/owned"), &grant).unwrap();
        assert_eq!(
            bytes,
            descriptor_for_identity(
                &b,
                Path::new("/private/owned"),
                &grant,
                DesktopIdentity::Production
            )
            .unwrap()
        );
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["authorization"]["renewal"]["fd"], 4);
        assert_eq!(v.as_object().unwrap().len(), 5);
        let mut fixture: Value =
            serde_json::from_str(include_str!("managed_desktop_contract.fixture.json")).unwrap();
        fixture["descriptor"]["authorization"]["expiresAt"] = json!(grant.expires_at);
        assert_eq!(v, fixture["descriptor"]);
        assert!(!String::from_utf8(bytes).unwrap().contains("bootstrap"));
    }
    #[test]
    fn descriptor_browser_capability_matches_the_shared_private_contract() {
        let fixture: Value =
            serde_json::from_str(include_str!("managed_desktop_browser.fixture.json")).unwrap();
        let mut b = binding();
        b.browser = Some(crate::managed_browser::Capability {
            path: PathBuf::from(fixture["path"].as_str().unwrap()),
            key: fixture["key"].as_str().unwrap().into(),
            generation: 1,
        });
        let grant = DesktopPairGrant {
            credential: "23456789ABCD".into(),
            expires_at: now_ms().unwrap() + 60_000,
        };
        let value: Value =
            serde_json::from_slice(&descriptor(&b, Path::new("/private/owned"), &grant).unwrap())
                .unwrap();
        assert_eq!(value["browser"], fixture);
        assert_eq!(value["browser"]["generation"], value["owner"]["generation"]);
        assert_eq!(
            value["browser"]["environmentId"],
            value["owner"]["environmentId"]
        );
        b.browser.as_mut().unwrap().generation = 2;
        assert!(descriptor(&b, Path::new("/private/owned"), &grant).is_err());
        b.browser.as_mut().unwrap().generation = 1;
        b.browser.as_mut().unwrap().key = "A".repeat(64);
        assert!(descriptor(&b, Path::new("/private/owned"), &grant).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn private_fd_child_fixture() {
        if std::env::var_os("BLACKCRAB_DESKTOP_FD_FIXTURE").is_none() {
            return;
        }
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::net::UnixStream;
        let mut input = unsafe { UnixStream::from_raw_fd(3) };
        let mut control = unsafe { UnixStream::from_raw_fd(4) };
        for fd in [input.as_raw_fd(), control.as_raw_fd()] {
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            assert_eq!(unsafe { libc::fstat(fd, stat.as_mut_ptr()) }, 0);
            assert_eq!(
                unsafe { stat.assume_init() }.st_mode & libc::S_IFMT,
                libc::S_IFSOCK
            );
        }
        input
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        control
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut descriptor = String::new();
        input.read_to_string(&mut descriptor).unwrap();
        assert_eq!(descriptor, "private-descriptor");
        let mut request = [0u8; 6];
        control.read_exact(&mut request).unwrap();
        assert_eq!(&request, b"renew\n");
        control.write_all(b"reply\n").unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn actual_inherited_fd3_and_duplex_fd4_are_private_sockets() {
        use std::os::unix::net::UnixStream;
        let (mut writer, reader) = UnixStream::pair().unwrap();
        let (mut owner, client) = UnixStream::pair().unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "managed_desktop::tests::private_fd_child_fixture",
            ])
            .env_clear()
            .env("BLACKCRAB_DESKTOP_FD_FIXTURE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        inherit_private_fds(&mut command, &reader, &client);
        let child = command.spawn().unwrap();
        drop(reader);
        drop(client);
        let child = Arc::new(Mutex::new(child));
        writer.write_all(b"private-descriptor").unwrap();
        writer.shutdown(std::net::Shutdown::Write).unwrap();
        owner
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        owner.write_all(b"renew\n").unwrap();
        let mut reply = [0u8; 6];
        owner.read_exact(&mut reply).unwrap();
        assert_eq!(&reply, b"reply\n");
        assert!(child.lock().unwrap().wait().unwrap().success());
    }
    #[test]
    fn reviewed_patch_provenance_paths_are_exact_regular_files_without_aliases() {
        let root = std::env::temp_dir().join(format!(
            "blackcrab-reviewed-patches-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let mut entries = BTreeMap::new();
        let bytes = b"reviewed";
        let expected = sha(bytes);
        for file in [
            "001.patch",
            "../runtime/ManagedAttached.ts",
            "../descriptor.mjs",
            "../assets/icon.png",
        ] {
            let relative = reviewed_patch_path(file).unwrap();
            let target = root.join(&relative);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(&target, bytes).unwrap();
            entries.insert(
                relative.clone(),
                Entry::File {
                    path: relative.clone(),
                    bytes: bytes.len() as u64,
                    executable: false,
                    sha256: expected.clone(),
                },
            );
            for parent in Path::new(&relative)
                .ancestors()
                .skip(1)
                .filter(|p| !p.as_os_str().is_empty())
            {
                let path = parent.to_str().unwrap().to_owned();
                entries.insert(path.clone(), Entry::Directory { path });
            }
            verify_reviewed_patch_payload(&root, &entries, file, &expected).unwrap();
        }
        for file in [
            "../../escape",
            "../runtime/../descriptor.mjs",
            "./alias",
            "a/../b",
            "/absolute",
            "a//b",
            "a\\b",
            "",
        ] {
            assert!(reviewed_patch_path(file).is_err());
        }
        assert!(
            verify_reviewed_patch_payload(&root, &entries, "missing.patch", &expected).is_err()
        );
        assert!(verify_reviewed_patch_payload(&root, &entries, "../runtime", &expected).is_err());
        assert!(verify_reviewed_patch_payload(
            &root,
            &entries,
            "../descriptor.mjs",
            &"a".repeat(64)
        )
        .is_err());
        #[cfg(unix)]
        {
            fs::rename(root.join("runtime"), root.join("real-runtime")).unwrap();
            std::os::unix::fs::symlink("real-runtime", root.join("runtime")).unwrap();
            assert!(verify_reviewed_patch_payload(
                &root,
                &entries,
                "../runtime/ManagedAttached.ts",
                &expected
            )
            .is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
