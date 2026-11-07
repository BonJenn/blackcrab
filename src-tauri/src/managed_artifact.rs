//! Integrity and target checks for an explicitly selected managed-host package.
//!
//! This verifies the unsigned assembly manifest; it does not establish publisher
//! authenticity. Keep this schema aligned with `managed-host/artifact.mjs`.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

const MANIFEST: &str = "blackcrab-managed-host.json";
const REPOSITORY: &str = "BonJenn/t3code";
const COMMIT: &str = "7f02de2eb8e253e0ec23f005b3cfff8e2c963be8";
const ARCHIVE: &str = "eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6";
const VERSION: &str = "0.1.7";
const MAX_FILES: usize = 200_000;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone)]
pub struct VerifiedArtifact {
    pub root: PathBuf,
    pub entry: PathBuf,
    pub version: String,
    pub manifest_digest: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Upstream {
    repository: String,
    commit: String,
    #[serde(rename = "archiveSha256")]
    archive_sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Patch {
    id: String,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Runtime {
    platform: String,
    arch: String,
    version: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct PayloadFile {
    path: String,
    bytes: u64,
    sha256: String,
    executable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u32,
    kind: String,
    upstream: Upstream,
    #[serde(rename = "sourcePatches")]
    source_patches: Vec<Patch>,
    runtime: Runtime,
    entry: String,
    client: String,
    files: Vec<PayloadFile>,
}

fn invalid(message: impl std::fmt::Display) -> String {
    format!("Invalid managed-host artifact: {message}")
}

fn current_target() -> Result<(&'static str, &'static str), String> {
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "win32",
        _ => return Err(invalid("unsupported host platform")),
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => return Err(invalid("unsupported host architecture")),
    };
    Ok((platform, arch))
}

fn valid_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    !value.is_empty()
        && value.encode_utf16().count() <= 4096
        && !value.contains(['\\', '\0'])
        && !value.starts_with('/')
        && !(bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

// JavaScript's manifest writer compares UTF-16 code units, not UTF-8 bytes.
fn path_order(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn validate(manifest: &Manifest, platform: &str, arch: &str) -> Result<(), String> {
    if manifest.schema != 1 || manifest.kind != "blackcrab-managed-host" {
        return Err(invalid("unknown manifest schema"));
    }
    if manifest.upstream.repository != REPOSITORY
        || manifest.upstream.commit != COMMIT
        || manifest.upstream.archive_sha256 != ARCHIVE
    {
        return Err(invalid("upstream pin mismatch"));
    }
    if !["darwin", "linux", "win32"].contains(&manifest.runtime.platform.as_str())
        || !["arm64", "x64"].contains(&manifest.runtime.arch.as_str())
        || manifest.runtime.version != VERSION
    {
        return Err(invalid("runtime metadata mismatch"));
    }
    if manifest.runtime.platform != platform || manifest.runtime.arch != arch {
        return Err(invalid("artifact is incompatible with this host"));
    }
    let entry = if platform == "win32" { "t3.exe" } else { "t3" };
    if manifest.entry != entry || manifest.client != "client/index.html" {
        return Err(invalid("entry or client mismatch"));
    }
    let mut patches = HashSet::new();
    if manifest.source_patches.len() > 128
        || manifest.source_patches.iter().any(|patch| {
            patch.id.is_empty()
                || patch.id.encode_utf16().count() > 256
                || patch.id.trim() != patch.id
                || patch.id.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
                || !valid_digest(&patch.sha256)
                || !patches.insert(&patch.id)
        })
    {
        return Err(invalid("invalid source patch descriptors"));
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_FILES {
        return Err(invalid("invalid file list"));
    }
    let mut previous: Option<&str> = None;
    for file in &manifest.files {
        if !valid_path(&file.path)
            || file.path == MANIFEST
            || file.bytes > MAX_SAFE_INTEGER
            || !valid_digest(&file.sha256)
        {
            return Err(invalid("invalid file record"));
        }
        if previous.is_some_and(|previous| path_order(previous, &file.path).is_ge()) {
            return Err(invalid("file paths must be unique and sorted"));
        }
        previous = Some(&file.path);
    }
    let monitor = if platform == "win32" {
        "resource-monitor/t3-resource-monitor.exe"
    } else {
        "resource-monitor/t3-resource-monitor"
    };
    for name in [
        entry,
        "client/index.html",
        "LICENSE.upstream",
        "THIRD-PARTY-NOTICES",
        monitor,
    ] {
        let file = manifest
            .files
            .iter()
            .find(|file| file.path == name && file.bytes != 0)
            .ok_or_else(|| invalid(format!("missing or empty required file: {name}")))?;
        if platform != "win32" && (name == entry || name == monitor) && !file.executable {
            return Err(invalid("host and resource monitor must be executable"));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable(_metadata: &fs::Metadata) -> bool {
    // Node's Windows stat mode does not infer executable bits from suffixes.
    false
}

fn file_digest(path: &Path) -> Result<String, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .map_err(|e| invalid(format!("cannot read payload: {e}")))?;
    if !file.metadata().map_err(invalid)?.is_file() {
        return Err(invalid("payload changed to a non-file"));
    }
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(invalid)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn scan(root: &Path) -> Result<Vec<PayloadFile>, String> {
    fn visit(
        root: &Path,
        prefix: &str,
        depth: usize,
        files: &mut Vec<PayloadFile>,
    ) -> Result<(), String> {
        if depth > 128 {
            return Err(invalid("directory nesting exceeds limit"));
        }
        let directory = if prefix.is_empty() {
            root.to_path_buf()
        } else {
            root.join(prefix)
        };
        let entries = fs::read_dir(directory).map_err(invalid)?;
        for entry in entries {
            let entry = entry.map_err(invalid)?;
            let name = entry.file_name();
            let name = name
                .to_str()
                .ok_or_else(|| invalid("non-Unicode file path"))?;
            let relative = if prefix.is_empty() {
                name.to_owned()
            } else {
                format!("{prefix}/{name}")
            };
            if !valid_path(&relative) {
                return Err(invalid("unsafe file path"));
            }
            let metadata = fs::symlink_metadata(entry.path()).map_err(invalid)?;
            if metadata.file_type().is_symlink() {
                return Err(invalid(format!("symbolic link: {relative}")));
            }
            if metadata.is_dir() {
                visit(root, &relative, depth + 1, files)?;
                continue;
            }
            if !metadata.is_file() {
                return Err(invalid(format!("non-file entry: {relative}")));
            }
            if relative == MANIFEST {
                continue;
            }
            if files.len() >= MAX_FILES || metadata.len() > MAX_SAFE_INTEGER {
                return Err(invalid("payload exceeds size/count limits"));
            }
            files.push(PayloadFile {
                path: relative,
                bytes: metadata.len(),
                sha256: file_digest(&entry.path())?,
                executable: executable(&metadata),
            });
        }
        Ok(())
    }
    let mut files = Vec::new();
    visit(root, "", 0, &mut files)?;
    files.sort_by(|a, b| path_order(&a.path, &b.path));
    Ok(files)
}

/// Validate every regular file before using an explicitly installed payload.
/// The returned canonical paths do not make the unsigned manifest trusted.
pub fn verify(root: &Path) -> Result<VerifiedArtifact, String> {
    let (platform, arch) = current_target()?;
    verify_target(root, platform, arch)
}

fn verify_target(root: &Path, platform: &str, arch: &str) -> Result<VerifiedArtifact, String> {
    let root_metadata = fs::symlink_metadata(root).map_err(invalid)?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err(invalid("root must be a real directory"));
    }
    let root = fs::canonicalize(root).map_err(invalid)?;
    let manifest_path = root.join(MANIFEST);
    let metadata = fs::symlink_metadata(&manifest_path).map_err(invalid)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(invalid("manifest must be a bounded regular file"));
    }
    let mut bytes = Vec::new();
    File::open(manifest_path)
        .map_err(invalid)?
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(invalid)?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(invalid("manifest exceeds size limit"));
    }
    let manifest: Manifest = serde_json::from_slice(&bytes)
        .map_err(|_| invalid("manifest JSON/schema could not be read"))?;
    validate(&manifest, platform, arch)?;
    let actual = scan(&root)?;
    if actual != manifest.files {
        return Err(invalid("payload files differ from manifest"));
    }
    Ok(VerifiedArtifact {
        entry: root.join(manifest.entry),
        root,
        version: manifest.runtime.version,
        manifest_digest: format!("{:x}", Sha256::digest(&bytes)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    const PLATFORM: &str = if cfg!(windows) { "win32" } else { "darwin" };
    const ENTRY: &str = if cfg!(windows) { "t3.exe" } else { "t3" };
    const MONITOR: &str = if cfg!(windows) {
        "resource-monitor/t3-resource-monitor.exe"
    } else {
        "resource-monitor/t3-resource-monitor"
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "blackcrab-artifact-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            for name in [
                ENTRY,
                "client/index.html",
                "LICENSE.upstream",
                "THIRD-PARTY-NOTICES",
                MONITOR,
            ] {
                let file = root.join(name);
                fs::create_dir_all(file.parent().unwrap()).unwrap();
                fs::write(file, name.as_bytes()).unwrap();
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                for name in [ENTRY, MONITOR] {
                    fs::set_permissions(root.join(name), fs::Permissions::from_mode(0o755))
                        .unwrap();
                }
            }
            let fixture = Self(root);
            fixture.write_manifest();
            fixture
        }
        fn write_manifest(&self) {
            let manifest = Manifest {
                schema: 1,
                kind: "blackcrab-managed-host".into(),
                upstream: Upstream {
                    repository: REPOSITORY.into(),
                    commit: COMMIT.into(),
                    archive_sha256: ARCHIVE.into(),
                },
                source_patches: vec![],
                runtime: Runtime {
                    platform: PLATFORM.into(),
                    arch: "arm64".into(),
                    version: VERSION.into(),
                },
                entry: ENTRY.into(),
                client: "client/index.html".into(),
                files: scan(&self.0).unwrap(),
            };
            fs::write(
                self.0.join(MANIFEST),
                serde_json::to_vec_pretty(&manifest).unwrap(),
            )
            .unwrap();
        }
        fn mutate(&self, f: impl FnOnce(&mut serde_json::Value)) {
            let file = self.0.join(MANIFEST);
            let mut value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
            f(&mut value);
            fs::write(file, serde_json::to_vec(&value).unwrap()).unwrap();
        }
    }
    #[test]
    fn relocated_package_keeps_integrity_and_target() {
        let mut fixture = Fixture::new();
        let first = verify_target(&fixture.0, PLATFORM, "arm64").unwrap();
        let moved = fixture.0.with_extension("relocated");
        fs::rename(&fixture.0, &moved).unwrap();
        fixture.0 = moved;
        let second = verify_target(&fixture.0, PLATFORM, "arm64").unwrap();
        assert_eq!(first.manifest_digest, second.manifest_digest);
        assert_eq!(second.version, VERSION);
        assert_eq!(second.entry, second.root.join(ENTRY));
        assert!(verify_target(&fixture.0, "linux", "arm64").is_err());
    }
    #[test]
    fn changed_missing_and_unlisted_files_fail() {
        for change in [0, 1, 2] {
            let fixture = Fixture::new();
            match change {
                0 => fs::write(fixture.0.join(ENTRY), "changed").unwrap(),
                1 => fs::remove_file(fixture.0.join(ENTRY)).unwrap(),
                _ => fs::write(fixture.0.join("extra"), "extra").unwrap(),
            };
            assert!(verify_target(&fixture.0, PLATFORM, "arm64").is_err());
        }
    }
    #[test]
    fn manifest_pin_unknown_fields_paths_and_duplicate_records_fail() {
        for case in 0..8 {
            let fixture = Fixture::new();
            fixture.mutate(|v| match case {
                0 => v["upstream"]["commit"] = "different".into(),
                1 => v["unknown"] = true.into(),
                2 => v["files"][0]["path"] = "../escape".into(),
                3 => v["files"][0]["bytes"] = serde_json::json!(MAX_SAFE_INTEGER + 1),
                4 => {
                    let duplicate = v["files"][0].clone();
                    v["files"].as_array_mut().unwrap().push(duplicate);
                }
                5 => v["sourcePatches"] = serde_json::json!([{"id":"x","sha256":"invalid"}]),
                6 => v["files"][0]["sha256"] = "A".repeat(64).into(),
                _ => v["entry"] = "client/index.html".into(),
            });
            assert!(
                verify_target(&fixture.0, PLATFORM, "arm64").is_err(),
                "case {case}"
            );
        }
    }
    #[cfg(unix)]
    #[test]
    fn symlink_and_executable_changes_fail() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};
        for case in 0..4 {
            let fixture = Fixture::new();
            match case {
                0 => {
                    fs::remove_file(fixture.0.join(ENTRY)).unwrap();
                    symlink("LICENSE.upstream", fixture.0.join(ENTRY)).unwrap();
                }
                1 => fs::set_permissions(
                    fixture.0.join("resource-monitor/t3-resource-monitor"),
                    fs::Permissions::from_mode(0o644),
                )
                .unwrap(),
                2 => {
                    fs::rename(fixture.0.join("client"), fixture.0.join("original-client"))
                        .unwrap();
                    symlink("original-client", fixture.0.join("client")).unwrap();
                }
                _ => {
                    fs::rename(
                        fixture.0.join(MANIFEST),
                        fixture.0.join("original-manifest"),
                    )
                    .unwrap();
                    symlink("original-manifest", fixture.0.join(MANIFEST)).unwrap();
                }
            }
            assert!(
                verify_target(&fixture.0, PLATFORM, "arm64").is_err(),
                "case {case}"
            );
        }
    }
    #[test]
    fn path_order_matches_javascript_for_non_bmp_names() {
        assert!(path_order("\u{10000}", "\u{e000}").is_lt());
    }
}
