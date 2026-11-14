//! Destination-local installation of bytes already authenticated by Update::download.
//! Never use the system temporary filesystem for bundle backup or replacement.
use std::fs;
use std::io::{self, Cursor};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

fn failure(message: impl Into<String>) -> io::Error {
    io::Error::other(message.into())
}

#[cfg(target_os = "macos")]
pub(crate) fn install(bytes: &[u8], version: &str) -> Result<(), String> {
    let result = (|| {
        let executable = std::env::current_exe()?;
        let destination = bundle_for_executable(&executable)?;
        install_with(
            bytes,
            &destination,
            |bundle| verify_bundle(bundle, version),
            |a, b| fs::rename(a, b),
        )
    })();
    result.map_err(|error| format!("Mac update could not be installed: {error}. Quit the desktop and replace Blackcrab using the official installer at blackcrab.app. Keep all application data and the background service."))
}

fn bundle_for_executable(executable: &Path) -> io::Result<PathBuf> {
    let macos = executable
        .parent()
        .ok_or_else(|| failure("Missing executable parent"))?;
    let contents = macos.parent().ok_or_else(|| failure("Missing Contents"))?;
    let bundle = contents
        .parent()
        .ok_or_else(|| failure("Missing application bundle"))?;
    if !executable.is_absolute()
        || macos.file_name() != Some("MacOS".as_ref())
        || contents.file_name() != Some("Contents".as_ref())
        || bundle.extension() != Some("app".as_ref())
    {
        return Err(failure("Updater must run from an installed .app bundle"));
    }
    Ok(bundle.to_path_buf())
}

#[cfg(target_os = "macos")]
fn verify_bundle(bundle: &Path, version: &str) -> io::Result<()> {
    let info = plist::Value::from_file(bundle.join("Contents/Info.plist"))
        .map_err(|e| failure(format!("Cannot read update Info.plist: {e}")))?;
    let info = info
        .as_dictionary()
        .ok_or_else(|| failure("Invalid update Info.plist"))?;
    for (key, expected) in [
        ("CFBundleIdentifier", "com.bonjenn.blackcrab"),
        ("CFBundleShortVersionString", version),
        ("CFBundleExecutable", "blackcrab"),
    ] {
        if info.get(key).and_then(plist::Value::as_string) != Some(expected) {
            return Err(failure(format!(
                "Update {key} does not match the queued Blackcrab release"
            )));
        }
    }
    // Minisign authenticates the download. This additional check validates the
    // extracted/installed bundle, nested code and the expected Developer ID.
    let status = std::process::Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict", "-R",
            "=anchor apple generic and identifier \"com.bonjenn.blackcrab\" and certificate leaf[subject.OU] = \"YF28W3NGG6\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"])
        .arg(bundle).output()?;
    if !status.status.success() {
        return Err(failure(
            "Update bundle failed Developer ID signature verification",
        ));
    }
    Ok(())
}

fn extract(bytes: &[u8], directory: &Path) -> io::Result<PathBuf> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(Cursor::new(bytes)));
    let mut root = None;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let parts: Vec<_> = path.components().collect();
        if parts.is_empty() || parts.iter().any(|p| !matches!(p, Component::Normal(_))) {
            return Err(failure("Unsafe update archive path"));
        }
        let name = PathBuf::from(parts[0].as_os_str());
        if name.extension() != Some("app".as_ref()) || root.as_ref().is_some_and(|r| r != &name) {
            return Err(failure("Update archive must contain exactly one .app"));
        }
        root = Some(name);
        let kind = entry.header().entry_type();
        if !(kind.is_file() || kind.is_dir() || kind.is_symlink()) {
            return Err(failure("Unsupported update archive entry"));
        }
        if parts.len() == 1 && !kind.is_dir() {
            return Err(failure("Archive root must be a directory"));
        }
        if kind.is_symlink() {
            let link = entry
                .link_name()?
                .ok_or_else(|| failure("Missing symlink target"))?;
            // Permit Electron's relative framework links, but never escape the .app.
            let mut depth = parts.len() - 2;
            for component in link.components() {
                match component {
                    Component::Normal(_) => depth += 1,
                    Component::CurDir => {}
                    Component::ParentDir if depth > 0 => depth -= 1,
                    _ => return Err(failure("Update symlink escapes application bundle")),
                }
            }
        }
        if !entry.unpack_in(directory)? {
            return Err(failure("Update archive escaped staging directory"));
        }
    }
    let bundle = directory.join(root.ok_or_else(|| failure("Empty update archive"))?);
    // Do not let a root link or a nested link masquerade as the bundle structure.
    for path in [
        &bundle,
        &bundle.join("Contents"),
        &bundle.join("Contents/MacOS"),
    ] {
        if !fs::symlink_metadata(path)?.is_dir() {
            return Err(failure("Update is not a complete application directory"));
        }
    }
    validate_links(&bundle, &fs::canonicalize(&bundle)?)?;
    Ok(bundle)
}

fn validate_links(directory: &Path, root: &Path) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            if !fs::canonicalize(entry.path())?.starts_with(root) {
                return Err(failure(
                    "Update symlink resolves outside application bundle",
                ));
            }
        } else if kind.is_dir() {
            validate_links(&entry.path(), root)?;
        }
    }
    Ok(())
}

fn install_with(
    bytes: &[u8],
    destination: &Path,
    verify: impl Fn(&Path) -> io::Result<()>,
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| failure("Missing installation directory"))?;
    let original = fs::symlink_metadata(destination)?;
    if !original.is_dir() || destination.extension() != Some("app".as_ref()) {
        return Err(failure(
            "Installation must be a real .app directory, not a symlink",
        ));
    }
    // Stable advisory lock serializes cooperating Root processes. Never unlink a
    // lock file while a different process could hold its inode. No shell/elevation.
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(parent.join(".blackcrab-update.lock"))?;
    use std::os::fd::AsRawFd;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err(failure("Another app update owns the installation lock"));
    }
    let transaction = tempfile::Builder::new()
        .prefix(".blackcrab-update-")
        .tempdir_in(parent)?;
    if fs::metadata(transaction.path())?.dev() != original.dev() {
        return Err(failure(
            "Application is a separate mount; install a copy in a writable Applications folder",
        ));
    }
    let extraction = transaction.path().join("candidate");
    fs::create_dir(&extraction)?;
    let staged = extract(bytes, &extraction)?;
    verify(&staged)?;
    let current = fs::symlink_metadata(destination)?;
    if current.dev() != original.dev() || current.ino() != original.ino() {
        return Err(failure("Installation changed while preparing the update"));
    }
    let backup = transaction.path().join("previous.app");
    // Disable RAII cleanup BEFORE moving the old bundle: a crash/unwind or a
    // failed rollback must never delete the only good copy. The error names it.
    let retained = transaction.keep();
    if let Err(error) = rename(destination, &backup) {
        let _ = fs::remove_dir_all(&retained); // old app was never moved
        return Err(error);
    }
    let replacement = rename(&staged, destination).and_then(|_| verify(destination));
    if let Err(error) = replacement {
        // On failed verification the new app exists at destination. Move it out
        // before restoring the complete original; never merge bundle contents.
        let rollback = (|| {
            if fs::symlink_metadata(destination).is_ok() {
                rename(destination, &retained.join("rejected.app"))?;
            }
            rename(&backup, destination)
        })();
        return match rollback {
            Ok(()) => {
                let _ = fs::remove_dir_all(&retained);
                Err(failure(format!("{error}; original application restored")))
            }
            Err(restore) => Err(failure(format!(
                "{error}; rollback failed: {restore}; original application retained at {}",
                backup.display()
            ))),
        };
    }
    // Cleanup failure does not invalidate an installed, verified app. Retaining
    // an old bundle is safer than reporting a failed install and replaying it.
    if let Err(error) = fs::remove_dir_all(&retained) {
        eprintln!(
            "Verified update installed; backup cleanup failed at {}: {error}",
            retained.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::os::unix::fs::PermissionsExt;

    fn archive(entries: &[(&str, &[u8], u32, Option<&str>)]) -> Vec<u8> {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        for (path, data, mode, link) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_mode(*mode);
            header.set_size(data.len() as u64);
            if let Some(link) = link {
                header.set_entry_type(tar::EntryType::Symlink);
                header.set_link_name(link).unwrap();
            }
            header.set_cksum();
            tar.append_data(&mut header, path, *data).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap()
    }
    fn payload() -> Vec<u8> {
        archive(&[
            (
                "Blackcrab.app/Contents/MacOS/blackcrab",
                b"new",
                0o755,
                None,
            ),
            (
                "Blackcrab.app/Contents/Resources/link",
                b"",
                0o777,
                Some("../MacOS/blackcrab"),
            ),
        ])
    }
    fn fixture(parent: &Path) -> PathBuf {
        let app = parent.join("Blackcrab.app");
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/MacOS/blackcrab"), "old").unwrap();
        fs::write(parent.join("service-and-conversations"), "untouched").unwrap();
        app
    }
    fn contents(app: &Path) -> String {
        fs::read_to_string(app.join("Contents/MacOS/blackcrab")).unwrap()
    }
    fn verify(app: &Path) -> io::Result<()> {
        if contents(app) != "new" {
            return Err(failure("Invalid fixture"));
        }
        assert_eq!(
            fs::metadata(app.join("Contents/MacOS/blackcrab"))?
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        assert_eq!(
            fs::read_link(app.join("Contents/Resources/link"))?,
            PathBuf::from("../MacOS/blackcrab")
        );
        Ok(())
    }
    #[test]
    fn installs_complete_bundle_and_preserves_unrelated_data() {
        let dir = tempfile::tempdir().unwrap();
        let app = fixture(dir.path());
        install_with(&payload(), &app, verify, |a, b| fs::rename(a, b)).unwrap();
        assert_eq!(contents(&app), "new");
        assert_eq!(
            fs::read_to_string(dir.path().join("service-and-conversations")).unwrap(),
            "untouched"
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3); // app, data, stable lock
    }
    #[test]
    fn invalid_archive_or_failed_preverification_keeps_original() {
        for bytes in [
            b"truncated gzip".to_vec(),
            payload(),
            archive(&[("Other.txt", b"bad", 0o644, None)]),
            archive(&[("Blackcrab.app", b"", 0o777, Some("elsewhere"))]),
            archive(&[(
                "Blackcrab.app/Contents/link",
                b"",
                0o777,
                Some("../../outside"),
            )]),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let app = fixture(dir.path());
            assert!(install_with(
                &bytes,
                &app,
                |_| Err(failure("bad signature or version")),
                |_, _| panic!("must not rename")
            )
            .is_err());
            assert_eq!(contents(&app), "old");
        }
    }
    #[test]
    fn malformed_archive_is_rejected_by_extractor_itself() {
        for bytes in [
            b"truncated gzip".to_vec(),
            archive(&[("Other.txt", b"bad", 0o644, None)]),
            archive(&[("Blackcrab.app", b"", 0o777, Some("elsewhere"))]),
            archive(&[(
                "Blackcrab.app/Contents/link",
                b"",
                0o777,
                Some("../../outside"),
            )]),
            archive(&[
                (
                    "Blackcrab.app/Contents/MacOS/blackcrab",
                    b"new",
                    0o755,
                    None,
                ),
                ("Second.app/Contents/MacOS/blackcrab", b"new", 0o755, None),
            ]),
            archive(&[(
                "Blackcrab.app/Contents/Info.plist",
                b"incomplete",
                0o644,
                None,
            )]),
        ] {
            let dir = tempfile::tempdir().unwrap();
            assert!(extract(&bytes, dir.path()).is_err());
        }
    }
    #[test]
    fn backup_and_replacement_failures_never_report_success() {
        for fail_at in [1, 2] {
            let dir = tempfile::tempdir().unwrap();
            let app = fixture(dir.path());
            let mut calls = 0;
            let error = install_with(&payload(), &app, verify, |a, b| {
                calls += 1;
                if calls == fail_at {
                    Err(io::Error::from_raw_os_error(libc::EXDEV))
                } else {
                    fs::rename(a, b)
                }
            })
            .unwrap_err();
            assert!(error.to_string().to_lowercase().contains("cross-device"));
            assert_eq!(contents(&app), "old");
        }
    }
    #[test]
    fn failed_post_install_verification_restores_original() {
        let dir = tempfile::tempdir().unwrap();
        let app = fixture(dir.path());
        let calls = Cell::new(0);
        let error = install_with(
            &payload(),
            &app,
            |p| {
                calls.set(calls.get() + 1);
                if calls.get() == 2 {
                    Err(failure("failed installed verification"))
                } else {
                    verify(p)
                }
            },
            |a, b| fs::rename(a, b),
        )
        .unwrap_err();
        assert!(error.to_string().contains("original application restored"));
        assert_eq!(contents(&app), "old");
    }
    #[test]
    fn failed_rollback_retains_original_and_reports_its_location() {
        let dir = tempfile::tempdir().unwrap();
        let app = fixture(dir.path());
        let mut calls = 0;
        let error = install_with(&payload(), &app, verify, |a, b| {
            calls += 1;
            if calls >= 2 {
                Err(failure("injected failure"))
            } else {
                fs::rename(a, b)
            }
        })
        .unwrap_err();
        let backup = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path().join("previous.app"))
            .find(|p| p.exists())
            .unwrap();
        assert_eq!(contents(&backup), "old");
        assert!(error.to_string().contains(&backup.display().to_string()));
        assert!(error.to_string().contains("rollback failed"));
    }
    #[test]
    fn busy_lock_or_symlink_destination_keeps_original() {
        let dir = tempfile::tempdir().unwrap();
        let app = fixture(dir.path());
        use std::os::fd::AsRawFd;
        let lock = fs::File::create(dir.path().join(".blackcrab-update.lock")).unwrap();
        assert_eq!(
            unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0
        );
        assert!(install_with(&payload(), &app, verify, |a, b| fs::rename(a, b)).is_err());
        let link = dir.path().join("Link.app");
        std::os::unix::fs::symlink(&app, &link).unwrap();
        assert!(install_with(&payload(), &link, verify, |a, b| fs::rename(a, b)).is_err());
        assert_eq!(contents(&app), "old");
    }
    #[test]
    fn executable_must_identify_an_outer_bundle() {
        assert_eq!(
            bundle_for_executable(Path::new(
                "/Volumes/Test/Blackcrab.app/Contents/MacOS/blackcrab"
            ))
            .unwrap(),
            PathBuf::from("/Volumes/Test/Blackcrab.app")
        );
        assert!(bundle_for_executable(Path::new("/tmp/blackcrab")).is_err());
    }
    /// Requires a caller-owned writable fixture parent on a DIFFERENT device.
    /// No installed app, service or environment is inspected or modified.
    #[test]
    #[ignore = "requires BLACKCRAB_UPDATER_TEST_VOLUME on another filesystem"]
    fn real_cross_device_backup_failure_then_destination_local_success() {
        let parent =
            std::env::var_os("BLACKCRAB_UPDATER_TEST_VOLUME").expect("fixture volume required");
        let volume = tempfile::tempdir_in(parent).unwrap();
        let system_temp = tempfile::tempdir().unwrap();
        let app = fixture(volume.path());
        assert_ne!(
            fs::metadata(&app).unwrap().dev(),
            fs::metadata(system_temp.path()).unwrap().dev()
        );
        // Exact first failing operation in tauri-plugin-updater 2.10.1.
        let error = fs::rename(&app, system_temp.path().join("current_app")).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(libc::EXDEV));
        assert_eq!(contents(&app), "old");
        install_with(&payload(), &app, verify, |a, b| fs::rename(a, b)).unwrap();
        assert_eq!(contents(&app), "new");
        assert_eq!(
            fs::read_to_string(volume.path().join("service-and-conversations")).unwrap(),
            "untouched"
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn native_verifier_rejects_unsigned_and_wrong_version_bundles() {
        let dir = tempfile::tempdir().unwrap();
        let app = extract(&payload(), dir.path()).unwrap();
        let mut info = plist::Dictionary::new();
        for (key, value) in [
            ("CFBundleIdentifier", "com.bonjenn.blackcrab"),
            ("CFBundleShortVersionString", "0.4.3"),
            ("CFBundleExecutable", "blackcrab"),
        ] {
            info.insert(key.into(), plist::Value::String(value.into()));
        }
        plist::Value::Dictionary(info)
            .to_file_xml(app.join("Contents/Info.plist"))
            .unwrap();
        assert!(verify_bundle(&app, "0.4.4")
            .unwrap_err()
            .to_string()
            .contains("CFBundleShortVersionString"));
        assert!(verify_bundle(&app, "0.4.3")
            .unwrap_err()
            .to_string()
            .contains("signature"));
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires the official 0.4.3 archive and an owned fixture volume"]
    fn official_043_archive_installs_and_verifies_in_isolation() {
        use sha2::{Digest, Sha256};
        let archive = std::env::var_os("BLACKCRAB_UPDATER_TEST_ARCHIVE").expect("archive required");
        let bytes = fs::read(archive).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            "3b53a5e5631a2742e678fb805a967c2968741f15f57d039150c340d1b214079c"
        );
        let parent =
            std::env::var_os("BLACKCRAB_UPDATER_TEST_VOLUME").expect("fixture parent required");
        let dir = tempfile::tempdir_in(parent).unwrap();
        let app = fixture(dir.path());
        install_with(
            &bytes,
            &app,
            |p| verify_bundle(p, "0.4.3"),
            |a, b| fs::rename(a, b),
        )
        .unwrap();
        verify_bundle(&app, "0.4.3").unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("service-and-conversations")).unwrap(),
            "untouched"
        );
    }
}
