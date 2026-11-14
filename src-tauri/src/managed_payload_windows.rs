//! Windows payload cache. Same rules as the Unix cache: a dedicated, marked,
//! private root is published atomically under a trusted parent and is never
//! adopted, replaced or removed; payloads are extracted into private staging
//! and published without replacement. Ownership and access come from the
//! opened handle's owner and DACL instead of UID and mode bits, and Windows
//! packages contain no links, so link entries are refused outright.
use super::*;
use crate::managed_private_windows::{self as private, Access, Refusal};

fn io(operation: &str, error: std::io::Error) -> String {
    // Only error kinds and OS numbers are included; never paths or contents.
    match error.raw_os_error() {
        Some(code) => format!("{operation} ({}; OS error {code}).", error.kind()),
        None => format!("{operation} ({}).", error.kind()),
    }
}

pub(super) fn regular(path: &Path) -> Result<File, String> {
    private::open_file(path, OpenOptions::new().read(true)).map_err(|_| invalid())
}

pub(in crate) fn private_dir(path: &Path) -> Result<(), String> {
    private::directory(path, Access::Private).map_err(|refusal| {
        match refusal {
            Refusal::Unavailable => "Cannot inspect the workspace cache directory.",
            Refusal::NotRegular => "The workspace cache is not a regular directory.",
            Refusal::Owner => "The workspace cache belongs to a different user.",
            Refusal::Access => "The workspace cache permissions are not private.",
        }
        .to_string()
    })
}

fn bounded_lock(file: &File) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(()),
            Err(std::fs::TryLockError::WouldBlock) => {}
            Err(std::fs::TryLockError::Error(error)) => {
                return Err(io("Cannot acquire the workspace cache lock", error))
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err("The workspace cache lock is busy after waiting five seconds.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// A lock file that is ours, single-link and not writable by anyone else. It
/// lives beside the cache in a parent that may be readable by others.
pub(in crate) fn owned_lock(path: &Path, create: bool) -> Result<File, String> {
    let file = private::open_file(
        path,
        OpenOptions::new().read(true).write(true).create(create),
    )
    .map_err(|_| "Cannot open the workspace cache lock for reading and writing.".to_string())?;
    private::security(&file, Access::NoForeignWrite).map_err(|_| {
        "The workspace cache lock has incompatible ownership, permissions or links.".to_string()
    })?;
    bounded_lock(&file)?;
    if !private::same_object(&file, path) {
        return Err("The workspace cache lock changed while being acquired.".into());
    }
    Ok(file)
}

pub(super) fn initialize_cache_root(root: &Path) -> Result<(), String> {
    let mut prefix = PathBuf::new();
    for component in root.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err("The workspace cache path contains a relative component.".into());
        }
        prefix.push(component.as_os_str());
        if matches!(component, Component::Prefix(_) | Component::RootDir) {
            continue;
        }
        if let Ok(meta) = fs::symlink_metadata(&prefix) {
            if meta.file_type().is_symlink() {
                return Err("The workspace cache path contains a symbolic link.".into());
            }
        }
    }
    let parent = root
        .parent()
        .ok_or("The workspace cache has no parent directory.")?;
    private::directory(parent, Access::NoForeignWrite).map_err(|refusal| match refusal {
        Refusal::Unavailable => "Cannot inspect the application-data directory.".to_string(),
        Refusal::NotRegular => "The application-data location is not a directory.".into(),
        Refusal::Owner => "The application-data directory belongs to a different user.".into(),
        Refusal::Access => "The application-data directory allows other users to write.".into(),
    })?;
    if fs::symlink_metadata(root).is_ok() {
        private_dir(root)?;
        verify_marker(root)?;
    }
    let name = root
        .file_name()
        .ok_or("The workspace cache has no directory name.")?;
    let key = format!("{:x}", Sha256::digest(name.to_string_lossy().as_bytes()));
    let _initialization = owned_lock(
        &parent.join(format!(".blackcrab-payload-init-{}.lock", &key[..24])),
        true,
    )?;
    match fs::symlink_metadata(root) {
        Ok(_) => {
            private_dir(root)?;
            verify_marker(root)?;
            return Ok(());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(io("Cannot recheck the workspace cache directory", e)),
    }
    let mut nonce = [0u8; 16];
    getrandom::getrandom(&mut nonce)
        .map_err(|_| "Cannot generate a unique workspace cache directory.")?;
    let stage = parent.join(format!(
        ".payload-cache-init-{}",
        nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ));
    private::create_private_directory(&stage)
        .map_err(|e| io("Cannot create a private workspace cache directory", e))?;
    let mut guard = Staging(Some(stage.clone()));
    let mut marker = private::open_file(
        &stage.join(MARKER),
        OpenOptions::new().write(true).create_new(true),
    )
    .map_err(|_| "Cannot create the workspace cache marker.".to_string())?;
    marker
        .write_all(b"blackcrab-payload-cache-v1\n")
        .and_then(|_| marker.sync_all())
        .map_err(|e| io("Cannot save the workspace cache marker", e))?;
    drop(marker);
    drop(owned_lock(&stage.join(".lease"), true)?);
    private::rename_no_replace(&stage, root)
        .map_err(|_| "Cannot publish the new workspace cache without replacing existing data.")?;
    guard.0 = None;
    private_dir(root)?;
    verify_marker(root)
}

pub(super) fn cache_lease(root: &Path) -> Result<File, String> {
    initialize_cache_root(root)?;
    let lease = owned_lock(&root.join(".lease"), false)?;
    private_dir(root)?;
    verify_marker(root)?;
    Ok(lease)
}

pub(in crate) fn publish_no_replace(from: &Path, to: &Path) -> Result<(), String> {
    private::rename_no_replace(from, to).map_err(|_| invalid())
}

fn verify_marker(root: &Path) -> Result<(), String> {
    let mut f = regular(&root.join(MARKER)).map_err(|_| {
        "The workspace cache marker is missing, unreadable or not a regular single-link file."
    })?;
    let length = f
        .metadata()
        .map_err(|e| io("Cannot inspect the workspace cache marker", e))?
        .len();
    if private::security(&f, Access::Private).is_err()
        || length != b"blackcrab-payload-cache-v1\n".len() as u64
    {
        return Err(
            "The workspace cache marker has incompatible ownership, permissions or size.".into(),
        );
    }
    let mut b = String::new();
    f.read_to_string(&mut b)
        .map_err(|e| io("Cannot read the workspace cache marker", e))?;
    if b != "blackcrab-payload-cache-v1\n" {
        return Err(
            "The workspace cache marker is not recognized; existing data was preserved.".into(),
        );
    }
    Ok(())
}

/// Names Windows would silently rewrite or route to a device are refused, so
/// what is created is exactly what the archive and its manifest name.
fn windows_name(path: &Path) -> bool {
    path.components().all(|component| {
        let Some(name) = component.as_os_str().to_str() else {
            return false;
        };
        if name.ends_with(['.', ' ']) || name.contains(['<', '>', '"', '|', '?', '*']) {
            return false;
        }
        let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
        let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit()
                && stem.as_bytes()[3] != b'0');
        !device
    })
}

pub(super) fn create_staging(path: &Path) -> Result<(), String> {
    private::create_private_directory(path).map_err(|_| invalid())
}

pub(super) fn extract(file: File, root: &Path) -> Result<(), String> {
    let decoder = MultiGzDecoder::new(file);
    let mut archive = tar::Archive::new(Bounded {
        inner: decoder,
        total: 0,
    });
    // NTFS names are case-insensitive: two entries differing only in case
    // would address one file.
    let mut names = HashSet::new();
    let mut pending = HashMap::<String, String>::new();
    let mut metadata = 0u64;
    let mut count = 0;
    let mut bytes = 0u64;
    let mut indexed_bytes = 0usize;
    let mut output_nodes = 0usize;
    for entry in archive.entries().map_err(|_| invalid())?.raw(true) {
        let mut entry = entry.map_err(|_| invalid())?;
        count += 1;
        if count > ENTRIES {
            return Err(invalid());
        }
        let kind = entry.header().entry_type();
        if kind.is_pax_local_extensions() || kind.is_gnu_longname() {
            if entry.size() > META {
                return Err(invalid());
            }
            metadata += entry.size();
            if metadata > 16 * 1024 * 1024 {
                return Err(invalid());
            }
            let mut b = Vec::new();
            entry.read_to_end(&mut b).map_err(|_| invalid())?;
            if kind.is_pax_local_extensions() {
                for ext in tar::PaxExtensions::new(&b) {
                    let ext = ext.map_err(|_| invalid())?;
                    let key = ext.key().map_err(|_| invalid())?;
                    let value = ext.value().map_err(|_| invalid())?;
                    if ![
                        "path",
                        "size",
                        "mtime",
                        "atime",
                        "ctime",
                        "uid",
                        "gid",
                        "uname",
                        "gname",
                        "LIBARCHIVE.creationtime",
                    ]
                    .contains(&key)
                        || value.len() > 4096
                        || pending.insert(key.into(), value.into()).is_some()
                    {
                        return Err(invalid());
                    }
                }
            } else {
                if b.last() == Some(&0) {
                    b.pop();
                }
                let value = String::from_utf8(b).map_err(|_| invalid())?;
                if pending.insert("path".into(), value).is_some() {
                    return Err(invalid());
                }
            }
            continue;
        }
        // Regular files and directories only: no symbolic or hard links,
        // devices or long-link records.
        if !(kind.is_file() || kind.is_dir()) {
            return Err(invalid());
        }
        let name = match pending.remove("path") {
            Some(s) => s,
            None => entry
                .path()
                .map_err(|_| invalid())?
                .to_str()
                .ok_or_else(invalid)?
                .to_owned(),
        };
        indexed_bytes = indexed_bytes.checked_add(name.len()).ok_or_else(invalid)?;
        if indexed_bytes > 64 * 1024 * 1024 {
            return Err(invalid());
        }
        let relative = safe_path(&name)?;
        if !windows_name(&relative)
            || !names.insert(relative.to_string_lossy().to_lowercase())
        {
            return Err(invalid());
        }
        output_nodes = output_nodes
            .checked_add(parents(root, &relative)? + 1)
            .ok_or_else(invalid)?;
        if output_nodes > ENTRIES {
            return Err(invalid());
        }
        if let Some(size) = pending.remove("size") {
            if size.parse::<u64>().map_err(|_| invalid())? != entry.size() {
                return Err(invalid());
            }
        }
        bytes = bytes.checked_add(entry.size()).ok_or_else(invalid)?;
        if bytes > EXPANDED {
            return Err(invalid());
        }
        let output = root.join(&relative);
        if entry.header().mode().map_err(|_| invalid())? & 0o7000 != 0 {
            return Err(invalid());
        }
        if kind.is_dir() {
            if entry.size() != 0 {
                return Err(invalid());
            }
            match fs::create_dir(&output) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let meta = fs::symlink_metadata(&output).map_err(|_| invalid())?;
                    if !meta.is_dir() || meta.file_type().is_symlink() {
                        return Err(invalid());
                    }
                }
                Err(_) => return Err(invalid()),
            }
        } else {
            let mut out = private::open_file(
                &output,
                OpenOptions::new().write(true).create_new(true),
            )
            .map_err(|_| invalid())?;
            let n = std::io::copy(&mut entry, &mut out).map_err(|_| invalid())?;
            if n != entry.size() {
                return Err(invalid());
            }
            out.sync_all().map_err(|_| invalid())?;
        }
        pending.clear();
    }
    if !pending.is_empty() {
        return Err(invalid());
    }
    // Drain through gzip trailer/checksum and bound padding; reject nonzero trailing tar bytes.
    let mut reader = archive.into_inner();
    let mut b = [0u8; 8192];
    loop {
        let n = reader.read(&mut b).map_err(|_| invalid())?;
        if n == 0 {
            break;
        }
        if b[..n].iter().any(|x| *x != 0) {
            return Err(invalid());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    struct Fixture {
        base: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let mut nonce = [0u8; 8];
            getrandom::getrandom(&mut nonce).unwrap();
            let base = std::env::temp_dir().join(format!(
                "blackcrab-payload-{}",
                nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
            ));
            private::create_private_directory(&base).unwrap();
            Self { base }
        }
        fn archive(&self, name: &str, build: impl FnOnce(&mut tar::Builder<Vec<u8>>)) -> PathBuf {
            let mut builder = tar::Builder::new(Vec::new());
            build(&mut builder);
            let bytes = builder.into_inner().unwrap();
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
            encoder.write_all(&bytes).unwrap();
            let path = self.base.join(name);
            fs::write(&path, encoder.finish().unwrap()).unwrap();
            path
        }
        fn payload(&self, archive: &Path, cache: &str) -> EmbeddedPayload {
            let digest = hash(&mut File::open(archive).unwrap(), COMPRESSED).unwrap();
            EmbeddedPayload::new(
                PayloadRole::Desktop,
                archive.to_owned(),
                digest,
                "b".repeat(64),
                self.base.join(cache),
            )
            .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }
    fn file(builder: &mut tar::Builder<Vec<u8>>, name: &str, content: &[u8]) {
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        builder.append_data(&mut header, name, content).unwrap();
    }
    fn directory(builder: &mut tar::Builder<Vec<u8>>, name: &str) {
        let mut header = tar::Header::new_gnu();
        header.set_size(0);
        header.set_mode(0o755);
        header.set_entry_type(tar::EntryType::Directory);
        header.set_cksum();
        builder.append_data(&mut header, name, &[][..]).unwrap();
    }

    #[test]
    fn a_payload_is_extracted_once_into_a_private_marked_cache() {
        let f = Fixture::new();
        let archive = f.archive("ok.tar.gz", |b| {
            directory(b, "resources/");
            file(b, "resources/app/main.js", b"entry");
            file(b, "Blackcrab.exe", b"MZ");
        });
        let payload = f.payload(&archive, "cache");
        let seen = std::cell::Cell::new(0);
        let target = payload
            .ensure_with(|root| {
                seen.set(seen.get() + 1);
                assert_eq!(fs::read(root.join("resources/app/main.js")).unwrap(), b"entry");
                Ok(())
            })
            .unwrap();
        assert_eq!(target, payload.target_directory());
        assert_eq!(private_dir(&f.base.join("cache")), Ok(()));
        assert_eq!(private_dir(&target), Ok(()));
        assert_eq!(fs::read(target.join("Blackcrab.exe")).unwrap(), b"MZ");
        // The second use verifies the published target and extracts nothing.
        fs::remove_file(&archive).unwrap();
        assert_eq!(payload.ensure_with(|_| Ok(())).unwrap(), target);
        assert_eq!(seen.get(), 1);
        assert!(!fs::read_dir(f.base.join("cache"))
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with(".staging-")));
    }

    #[test]
    fn a_failed_verification_publishes_nothing_and_leaves_no_staging() {
        let f = Fixture::new();
        let archive = f.archive("bad.tar.gz", |b| file(b, "file", b"x"));
        let payload = f.payload(&archive, "cache");
        assert!(payload.ensure_with(|_| Err(invalid())).is_err());
        assert!(!payload.target_directory().exists());
        let left: Vec<_> = fs::read_dir(f.base.join("cache"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(left.iter().all(|n| n == MARKER || n == ".lease"), "{left:?}");
    }

    #[test]
    fn links_devices_aliases_and_changed_archives_are_refused() {
        let f = Fixture::new();
        let cases: Vec<(&str, Box<dyn FnOnce(&mut tar::Builder<Vec<u8>>)>)> = vec![
            (
                "symlink",
                Box::new(|b| {
                    file(b, "target", b"x");
                    let mut header = tar::Header::new_gnu();
                    header.set_size(0);
                    header.set_mode(0o777);
                    header.set_entry_type(tar::EntryType::Symlink);
                    header.set_link_name("target").unwrap();
                    header.set_cksum();
                    b.append_data(&mut header, "link", &[][..]).unwrap();
                }),
            ),
            (
                "hardlink",
                Box::new(|b| {
                    file(b, "target", b"x");
                    let mut header = tar::Header::new_gnu();
                    header.set_size(0);
                    header.set_mode(0o644);
                    header.set_entry_type(tar::EntryType::Link);
                    header.set_link_name("target").unwrap();
                    header.set_cksum();
                    b.append_data(&mut header, "link", &[][..]).unwrap();
                }),
            ),
            ("device", Box::new(|b| file(b, "dir/NUL.txt", b"x"))),
            ("trailing", Box::new(|b| file(b, "name.", b"x"))),
            (
                "case",
                Box::new(|b| {
                    file(b, "Readme", b"x");
                    file(b, "README", b"y");
                }),
            ),
        ];
        for (name, build) in cases {
            let archive = f.archive(&format!("{name}.tar.gz"), build);
            let payload = f.payload(&archive, &format!("cache-{name}"));
            assert!(payload.ensure_with(|_| Ok(())).is_err(), "{name}");
            assert!(!payload.target_directory().exists(), "{name}");
        }
        let archive = f.archive("changed.tar.gz", |b| file(b, "file", b"x"));
        let payload = f.payload(&archive, "cache-changed");
        fs::write(&archive, b"different bytes").unwrap();
        assert!(payload.ensure_with(|_| Ok(())).is_err());
        let archive = f.archive("linked.tar.gz", |b| file(b, "file", b"x"));
        let payload = f.payload(&archive, "cache-linked");
        fs::hard_link(&archive, f.base.join("alias")).unwrap();
        assert!(payload.ensure_with(|_| Ok(())).is_err());
    }

    #[test]
    fn existing_foreign_or_shared_roots_are_never_adopted() {
        let f = Fixture::new();
        // An unmarked directory that was already there.
        fs::create_dir(f.base.join("unmarked")).unwrap();
        fs::write(f.base.join("unmarked/user-data"), b"keep").unwrap();
        assert!(initialize_cache_root(&f.base.join("unmarked"))
            .unwrap_err()
            .contains("marker"));
        assert_eq!(fs::read(f.base.join("unmarked/user-data")).unwrap(), b"keep");
        // Our own cache, later opened up to everyone.
        let root = f.base.join("shared");
        initialize_cache_root(&root).unwrap();
        initialize_cache_root(&root).unwrap();
        let granted = Command::new("icacls")
            .arg(&root)
            .args(["/grant", "*S-1-1-0:(OI)(CI)RX"])
            .output()
            .unwrap();
        assert!(granted.status.success());
        assert!(initialize_cache_root(&root)
            .unwrap_err()
            .contains("not private"));
        // A parent that lets others write.
        let parent = f.base.join("open-parent");
        fs::create_dir(&parent).unwrap();
        let granted = Command::new("icacls")
            .arg(&parent)
            .args(["/grant", "*S-1-1-0:(OI)(CI)M"])
            .output()
            .unwrap();
        assert!(granted.status.success());
        assert!(initialize_cache_root(&parent.join("cache"))
            .unwrap_err()
            .contains("allows other users to write"));
        assert!(!parent.join("cache").exists());
    }
}
