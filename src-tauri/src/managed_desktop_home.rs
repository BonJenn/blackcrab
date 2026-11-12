//! macOS Native-viewer OS HOME. No descriptor, argv or environment home authority.
use std::{
    ffi::CStr,
    fs,
    os::unix::{ffi::OsStrExt, fs::MetadataExt},
    path::{Path, PathBuf},
};
fn error() -> String {
    "Native OS account home is unavailable".into()
}
fn validate(uid: libc::uid_t, record_uid: libc::uid_t, home: &Path) -> Result<PathBuf, String> {
    if uid != record_uid || !home.is_absolute() || home == Path::new("/") {
        return Err(error());
    }
    let canonical = home.canonicalize().map_err(|_| error())?;
    let metadata = fs::symlink_metadata(&canonical).map_err(|_| error())?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o022 != 0 {
        return Err(error());
    }
    Ok(canonical)
}
pub(super) fn account_home() -> Result<PathBuf, String> {
    let uid = unsafe { libc::getuid() };
    if uid != unsafe { libc::geteuid() } {
        return Err(error());
    }
    let mut size = 4096usize;
    loop {
        let mut bytes = vec![0u8; size];
        let mut record: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result = std::ptr::null_mut();
        let status = unsafe {
            libc::getpwuid_r(
                uid,
                &mut record,
                bytes.as_mut_ptr().cast(),
                bytes.len(),
                &mut result,
            )
        };
        if status == libc::ERANGE && size < 1024 * 1024 {
            size *= 2;
            continue;
        }
        if status != 0 || result.is_null() || record.pw_dir.is_null() {
            return Err(error());
        }
        let address = record.pw_dir as usize;
        let start = bytes.as_ptr() as usize;
        if address < start || address >= start + bytes.len() {
            return Err(error());
        }
        let tail = &bytes[address - start..];
        let nul = tail.iter().position(|byte| *byte == 0).ok_or_else(error)?;
        let value = CStr::from_bytes_with_nul(&tail[..=nul]).map_err(|_| error())?;
        return validate(
            uid,
            record.pw_uid,
            Path::new(std::ffi::OsStr::from_bytes(value.to_bytes())),
        );
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::unix::fs::PermissionsExt, process::Command};
    #[test]
    fn account_record_refuses_relative_foreign_and_writable_home() {
        let uid = unsafe { libc::getuid() };
        assert!(validate(uid, uid, Path::new("relative")).is_err());
        assert!(validate(uid, uid ^ 1, Path::new("/tmp")).is_err());
        let path =
            std::env::temp_dir().join(format!("native-home-validation-{}", std::process::id()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            validate(uid, uid, &path).unwrap(),
            path.canonicalize().unwrap()
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o777)).unwrap();
        assert!(validate(uid, uid, &path).is_err());
        fs::remove_dir(path).unwrap();
    }
    #[test]
    fn uid_lookup_ignores_poisoned_home_in_actual_child() {
        if std::env::var_os("BLACKCRAB_OS_HOME_TEST_CHILD").is_some() {
            let path = account_home().unwrap();
            assert_ne!(Some(path.as_os_str()), std::env::var_os("HOME").as_deref());
            assert_eq!(fs::metadata(path).unwrap().uid(), unsafe { libc::getuid() });
            return;
        }
        let current = std::thread::current();
        let name = current.name().expect("libtest test name").to_owned();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([name.as_str(), "--exact", "--test-threads=1"])
            .env("HOME", "/must-not-be-used/foreign-t3-home")
            .env("BLACKCRAB_OS_HOME_TEST_CHILD", "1")
            .output()
            .unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.contains("running 1 test"));
        assert!(stdout.contains("1 passed; 0 failed"));
    }
}
