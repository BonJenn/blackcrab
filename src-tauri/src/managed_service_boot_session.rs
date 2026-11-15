//! Kernel boot-session identity only. No PID, timestamp, persisted-file or random fallback.
//! Internal issuer input; never renderer-supplied recovery authority.

const UNAVAILABLE: &str = "Managed service boot-session identity unavailable";

pub(super) fn normalize(value: &[u8]) -> Result<String, String> {
    if value.len() != 36
        || value.iter().enumerate().any(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte != b'-'
            } else {
                !byte.is_ascii_hexdigit()
            }
        })
        || value.iter().all(|byte| matches!(*byte, b'0' | b'-'))
    {
        return Err(UNAVAILABLE.into());
    }
    String::from_utf8(value.to_ascii_lowercase()).map_err(|_| UNAVAILABLE.into())
}

#[cfg(target_os = "macos")]
pub(super) fn read_boot_session_id() -> Result<String, String> {
    // kern.bootsessionuuid is one bounded NUL-terminated UUID. Reject API/length
    // changes; do not substitute kern.boottime, wallclock or a fresh random UUID.
    let mut bytes = [0u8; 37];
    let mut length = bytes.len();
    let result = unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            bytes.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 || length != bytes.len() || bytes[36] != 0 {
        return Err(UNAVAILABLE.into());
    }
    normalize(&bytes[..36])
}

#[cfg(target_os = "linux")]
pub(super) fn read_boot_session_id() -> Result<String, String> {
    use std::io::Read;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    // Fixed kernel procfs node, never configuration, environment or request input.
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open("/proc/sys/kernel/random/boot_id")
        .map_err(|_| UNAVAILABLE.to_string())?;
    let metadata = file.metadata().map_err(|_| UNAVAILABLE.to_string())?;
    let mut filesystem = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o222 != 0
        || unsafe { libc::fstatfs(file.as_raw_fd(), filesystem.as_mut_ptr()) } != 0
    {
        return Err(UNAVAILABLE.into());
    }
    let filesystem = unsafe { filesystem.assume_init() };
    if filesystem.f_type != libc::PROC_SUPER_MAGIC {
        return Err(UNAVAILABLE.into());
    }
    let mut bytes = Vec::with_capacity(38);
    file.take(38)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE.to_string())?;
    if bytes.len() != 37 || bytes[36] != b'\n' {
        return Err(UNAVAILABLE.into());
    }
    normalize(&bytes[..36])
}

#[cfg(windows)]
pub(super) fn read_boot_session_id() -> Result<String, String> {
    // KUSER_SHARED_DATA is the kernel's read-only page mapped at this address
    // in every process. Its BootId is the kernel's count of boots of this
    // installation, so it differs for every boot and cannot change within one.
    // It is read directly: no registry value, boot time, wallclock or random
    // substitute. The major version sits in the same structure and guards
    // against a layout this code does not know; Windows 10 and 11 both
    // report 10 there.
    const SHARED: usize = 0x7FFE_0000;
    const MAJOR_VERSION: usize = 0x26C;
    const BOOT_ID: usize = 0x2C4;
    let (major, boot) = unsafe {
        (
            std::ptr::read_volatile((SHARED + MAJOR_VERSION) as *const u32),
            std::ptr::read_volatile((SHARED + BOOT_ID) as *const u32),
        )
    };
    if major != 10 || boot == 0 {
        return Err(UNAVAILABLE.into());
    }
    // The journal stores a UUID. This one spells "boot" and "id" in its first
    // two groups and carries the counter in its last.
    normalize(format!("626f6f74-6964-4000-8000-{boot:012x}").as_bytes())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub(super) fn read_boot_session_id() -> Result<String, String> {
    Err(UNAVAILABLE.into())
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[cfg(windows)]
    #[test]
    fn windows_boot_identity_is_the_kernel_boot_counter_and_is_stable() {
        let first = super::read_boot_session_id().unwrap();
        assert_eq!(super::read_boot_session_id().unwrap(), first);
        assert_eq!(normalize(first.as_bytes()).unwrap(), first);
        assert!(first.starts_with("626f6f74-6964-4000-8000-"));
        let counter = u64::from_str_radix(&first[24..], 16).unwrap();
        assert!(counter > 0 && counter <= u64::from(u32::MAX));
        // Windows keeps a boot count in the registry too. Where it is present
        // it is reported beside the kernel value for comparison, not required.
        let registry = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters",
                "/v",
                "BootId",
            ])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).split_whitespace().last().unwrap_or("absent").to_string())
            .unwrap_or_else(|_| "unavailable".into());
        println!("WINDOWS_BOOT_ID kernel={counter} registry={registry}");
    }

    #[test]
    fn kernel_uuid_is_normalized_without_semantic_rewriting() {
        assert_eq!(
            normalize(b"27E29119-7AEE-46E8-86F1-212756A4DA80").unwrap(),
            "27e29119-7aee-46e8-86f1-212756a4da80"
        );
    }

    #[test]
    fn missing_malformed_truncated_or_extra_identity_is_rejected() {
        for value in [
            &b""[..],
            &b"00000000-0000-0000-0000-000000000000"[..],
            &b"27e29119-7aee-46e8-86f1-212756a4da80\n"[..],
            &b"27e29119-7aee-46e8-86f1-212756a4da8"[..],
            &b"27e29119_7aee-46e8-86f1-212756a4da80"[..],
            &b"27e29119-7aee-46e8-86f1-212756a4da8g"[..],
            &b" 27e29119-7aee-46e8-86f1-212756a4da80"[..],
        ] {
            assert!(normalize(value).is_err());
        }
    }
}
