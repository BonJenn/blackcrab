//! Windows equivalents of the Unix owner/mode checks used for private native
//! storage. A location is trusted only from its opened handle: never a reparse
//! point, owned by the current user (or SYSTEM/Administrators, which are
//! root-equivalent), with a DACL that grants nothing to anyone else. An absent
//! DACL or an ACE type this code does not understand fails closed.
#![cfg(windows)]
use std::{
    fs::{File, OpenOptions},
    io,
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
    ptr,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            GetSecurityInfo, SE_FILE_OBJECT,
        },
        AclSizeInformation, EqualSid, GetAce, GetAclInformation, GetTokenInformation,
        IsWellKnownSid, TokenUser, WinBuiltinAdministratorsSid, WinCreatorOwnerSid,
        WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
        DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSID, SECURITY_ATTRIBUTES,
        TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        CreateDirectoryW, GetFileInformationByHandle, MoveFileExW, BY_HANDLE_FILE_INFORMATION,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, MOVEFILE_WRITE_THROUGH,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const INHERIT_ONLY_ACE: u8 = 0x08;
const SDDL_REVISION_1: u32 = 1;
const READ_CONTROL: u32 = 0x0002_0000;
const FILE_READ_ATTRIBUTES: u32 = 0x0080;
// Every right that can change an object, its children, its DACL or its owner:
// FILE_WRITE_DATA/ADD_FILE, FILE_APPEND_DATA/ADD_SUBDIRECTORY, FILE_WRITE_EA,
// FILE_DELETE_CHILD, FILE_WRITE_ATTRIBUTES, DELETE, WRITE_DAC, WRITE_OWNER,
// GENERIC_WRITE and GENERIC_ALL.
const WRITE_RIGHTS: u32 =
    0x0002 | 0x0004 | 0x0010 | 0x0040 | 0x0100 | 0x0001_0000 | 0x0004_0000 | 0x0008_0000
        | 0x4000_0000
        | 0x1000_0000;

/// How much a location may grant to accounts other than its trusted owners.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Access {
    /// Nothing at all: the equivalent of Unix mode 0700/0600.
    Private,
    /// Reading is tolerated, any modification is not: the equivalent of
    /// rejecting Unix group/other write.
    NoForeignWrite,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Refusal {
    Unavailable,
    NotRegular,
    Owner,
    Access,
}

struct Local(*mut core::ffi::c_void);
impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0) };
        }
    }
}

fn current_user() -> io::Result<Vec<u64>> {
    let mut token: HANDLE = ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut needed = 0u32;
    unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed) };
    // u64 storage keeps TOKEN_USER's pointer alignment.
    let mut buffer = vec![0u64; (needed as usize).div_ceil(8).max(1)];
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            (buffer.len() * 8) as u32,
            &mut needed,
        )
    };
    let error = io::Error::last_os_error();
    unsafe { CloseHandle(token) };
    if ok == 0 {
        return Err(error);
    }
    Ok(buffer)
}
fn user_sid(buffer: &[u64]) -> PSID {
    unsafe { (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid }
}

fn information(file: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
    let mut data: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut data) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(data)
}

fn trusted(sid: PSID, user: PSID) -> bool {
    unsafe {
        EqualSid(sid, user) != 0
            || IsWellKnownSid(sid, WinLocalSystemSid) != 0
            || IsWellKnownSid(sid, WinBuiltinAdministratorsSid) != 0
    }
}

/// Checks the owner and DACL of an already opened object.
pub(crate) fn security(file: &File, access: Access) -> Result<(), Refusal> {
    let user = current_user().map_err(|_| Refusal::Unavailable)?;
    let user = user_sid(&user);
    let mut owner: PSID = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    let mut descriptor = ptr::null_mut();
    let status = unsafe {
        GetSecurityInfo(
            file.as_raw_handle() as HANDLE,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    let _descriptor = Local(descriptor);
    if status != ERROR_SUCCESS {
        return Err(Refusal::Unavailable);
    }
    if owner.is_null() || !trusted(owner, user) {
        return Err(Refusal::Owner);
    }
    // A null DACL grants everyone full access.
    if dacl.is_null() {
        return Err(Refusal::Access);
    }
    let mut size: ACL_SIZE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe {
        GetAclInformation(
            dacl,
            (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    } == 0
    {
        return Err(Refusal::Unavailable);
    }
    for index in 0..size.AceCount {
        let mut entry = ptr::null_mut();
        if unsafe { GetAce(dacl, index, &mut entry) } == 0 || entry.is_null() {
            return Err(Refusal::Unavailable);
        }
        let header = unsafe { &*(entry as *const ACE_HEADER) };
        match header.AceType {
            ACCESS_DENIED_ACE_TYPE => continue,
            ACCESS_ALLOWED_ACE_TYPE => {}
            _ => return Err(Refusal::Access),
        }
        let allowed = unsafe { &*(entry as *const ACCESS_ALLOWED_ACE) };
        let sid = (&allowed.SidStart as *const u32).cast_mut().cast();
        if trusted(sid, user) {
            continue;
        }
        // CREATOR OWNER applies only to children and resolves to whoever
        // creates them, which the remaining entries limit to trusted accounts.
        if header.AceFlags & INHERIT_ONLY_ACE != 0
            && unsafe { IsWellKnownSid(sid, WinCreatorOwnerSid) } != 0
        {
            continue;
        }
        if access == Access::Private || allowed.Mask & WRITE_RIGHTS != 0 {
            return Err(Refusal::Access);
        }
    }
    Ok(())
}

/// Opens a real directory (never a junction or symlink) for inspection.
pub(crate) fn open_directory(path: &Path) -> Result<File, Refusal> {
    let file = OpenOptions::new()
        .access_mode(READ_CONTROL | FILE_READ_ATTRIBUTES)
        .share_mode(7)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| Refusal::Unavailable)?;
    let data = information(&file).map_err(|_| Refusal::Unavailable)?;
    if data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        || data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(Refusal::NotRegular);
    }
    Ok(file)
}

pub(crate) fn directory(path: &Path, access: Access) -> Result<(), Refusal> {
    security(&open_directory(path)?, access)
}

/// Opens a regular single-link file that is not a reparse point. `options`
/// supplies the access and creation mode; sharing and flags are set here.
pub(crate) fn open_file(path: &Path, options: &mut OpenOptions) -> Result<File, Refusal> {
    let file = options
        .share_mode(7)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| Refusal::Unavailable)?;
    let data = information(&file).map_err(|_| Refusal::Unavailable)?;
    if data.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || data.nNumberOfLinks != 1
    {
        return Err(Refusal::NotRegular);
    }
    Ok(file)
}

/// True when `path` still names the object `file` was opened from.
pub(crate) fn same_object(file: &File, path: &Path) -> bool {
    let Ok(current) = open_file(
        path,
        OpenOptions::new().access_mode(READ_CONTROL | FILE_READ_ATTRIBUTES),
    ) else {
        return false;
    };
    match (information(file), information(&current)) {
        (Ok(a), Ok(b)) => {
            a.dwVolumeSerialNumber == b.dwVolumeSerialNumber
                && a.nFileIndexHigh == b.nFileIndexHigh
                && a.nFileIndexLow == b.nFileIndexLow
        }
        _ => false,
    }
}

fn wide(path: &Path) -> io::Result<Vec<u16>> {
    let mut units: Vec<u16> = path.as_os_str().encode_wide().collect();
    if units.contains(&0) {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    for unit in &mut units {
        if *unit == u16::from(b'/') {
            *unit = u16::from(b'\\');
        }
    }
    // Lift the 248/260-character limits for drive-absolute paths.
    let drive = units.len() >= 3
        && units[1] == u16::from(b':')
        && units[2] == u16::from(b'\\')
        && (units[0] as u8).is_ascii_alphabetic()
        && units[0] < 128;
    if drive {
        let mut prefixed: Vec<u16> = r"\\?\".encode_utf16().collect();
        prefixed.extend(units);
        units = prefixed;
    }
    units.push(0);
    Ok(units)
}

/// Creates a new directory whose protected DACL grants full control to the
/// current user, SYSTEM and Administrators only, inherited by its children.
/// Fails if anything already exists at `path`.
pub(crate) fn create_private_directory(path: &Path) -> io::Result<()> {
    let descriptor = Descriptor::new("O:{sid}D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")?;
    let attributes = descriptor.attributes(false);
    let path = wide(path)?;
    if unsafe { CreateDirectoryW(path.as_ptr(), &attributes) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The current user's SID in its `S-1-…` text form.
pub(crate) fn current_user_sid() -> io::Result<String> {
    let user = current_user()?;
    let mut text = ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(user_sid(&user), &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let _text = Local(text.cast());
    let mut length = 0;
    while unsafe { *text.add(length) } != 0 {
        length += 1;
    }
    String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) })
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidData))
}

/// The SID, in text form, of the account Windows knows by `name`
/// (`DOMAIN\\user` or `user`).
pub(crate) fn account_sid(name: &str) -> io::Result<String> {
    use windows_sys::Win32::Security::LookupAccountNameW;
    let account: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    if account.len() > 512 || account[..account.len() - 1].contains(&0) {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    // u64 storage keeps the SID's alignment.
    let mut sid = vec![0u64; 32];
    let mut sid_bytes = (sid.len() * 8) as u32;
    let mut domain = vec![0u16; 512];
    let mut domain_units = domain.len() as u32;
    let mut kind = 0;
    if unsafe {
        LookupAccountNameW(
            ptr::null(),
            account.as_ptr(),
            sid.as_mut_ptr().cast(),
            &mut sid_bytes,
            domain.as_mut_ptr(),
            &mut domain_units,
            &mut kind,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut text = ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(sid.as_mut_ptr().cast(), &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let _text = Local(text.cast());
    let mut length = 0;
    while unsafe { *text.add(length) } != 0 {
        length += 1;
    }
    String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) })
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidData))
}

/// A security descriptor built from SDDL in which `{sid}` stands for the
/// current user. It must outlive every use of its `attributes`.
pub(crate) struct Descriptor(Local);
impl Descriptor {
    pub(crate) fn new(template: &str) -> io::Result<Self> {
        let sid = current_user_sid()?;
        let sddl: Vec<u16> = template
            .replace("{sid}", &sid)
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut descriptor = ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(Local(descriptor)))
    }
    pub(crate) fn attributes(&self, inheritable: bool) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0 .0,
            bInheritHandle: i32::from(inheritable),
        }
    }
}

/// Renames within one volume and never replaces an existing destination.
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    let target = to.to_path_buf();
    let (from, to) = (wide(from)?, wide(to)?);
    // A directory cannot be renamed while any file inside it is open, and a
    // virus scanner opens files that were just written. That refusal (access
    // denied or a sharing violation) is retried for a bounded time. The move
    // never replaces anything, so trying again cannot overwrite a target that
    // appeared in the meantime.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        // Moving onto an existing directory is also reported as access
        // denied; that is final.
        let busy = matches!(error.raw_os_error(), Some(5) | Some(32))
            && std::fs::symlink_metadata(&target).is_err();
        if !busy || std::time::Instant::now() >= deadline {
            return Err(error);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf, process::Command};

    fn base(name: &str) -> PathBuf {
        let mut nonce = [0u8; 8];
        getrandom::getrandom(&mut nonce).unwrap();
        let path = std::env::temp_dir().join(format!(
            "blackcrab-private-{name}-{}",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        create_private_directory(&path).unwrap();
        path
    }
    fn grant_everyone(path: &Path, rights: &str) {
        // S-1-1-0 is Everyone, independent of the display language.
        let status = Command::new("icacls")
            .arg(path)
            .args(["/grant", &format!("*S-1-1-0:{rights}")])
            .output()
            .unwrap();
        assert!(status.status.success());
    }

    #[test]
    fn a_created_directory_is_private_and_its_children_inherit_that() {
        let root = base("create");
        assert_eq!(directory(&root, Access::Private), Ok(()));
        // An existing location is never replaced or adopted by creation.
        assert!(create_private_directory(&root).is_err());
        fs::create_dir(root.join("child")).unwrap();
        assert_eq!(directory(&root.join("child"), Access::Private), Ok(()));
        let file = open_file(
            &root.join("child/file"),
            OpenOptions::new().write(true).create_new(true),
        )
        .unwrap();
        assert_eq!(security(&file, Access::Private), Ok(()));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn foreign_read_is_tolerated_only_where_asked_and_foreign_write_never() {
        let root = base("foreign");
        let read = root.join("read");
        fs::create_dir(&read).unwrap();
        grant_everyone(&read, "(OI)(CI)RX");
        assert_eq!(directory(&read, Access::Private), Err(Refusal::Access));
        assert_eq!(directory(&read, Access::NoForeignWrite), Ok(()));
        let write = root.join("write");
        fs::create_dir(&write).unwrap();
        grant_everyone(&write, "(OI)(CI)M");
        assert_eq!(directory(&write, Access::Private), Err(Refusal::Access));
        assert_eq!(directory(&write, Access::NoForeignWrite), Err(Refusal::Access));
        let file = root.join("file");
        fs::write(&file, b"x").unwrap();
        grant_everyone(&file, "W");
        let opened = open_file(&file, OpenOptions::new().read(true)).unwrap();
        assert_eq!(security(&opened, Access::NoForeignWrite), Err(Refusal::Access));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn links_junctions_and_wrong_kinds_are_not_regular() {
        let root = base("kinds");
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        let file = root.join("file");
        fs::write(&file, b"x").unwrap();
        assert_eq!(directory(&file, Access::Private), Err(Refusal::NotRegular));
        // A directory cannot be opened as a file at all.
        assert!(open_file(&target, OpenOptions::new().read(true)).is_err());
        fs::hard_link(&file, root.join("second")).unwrap();
        assert_eq!(
            open_file(&file, OpenOptions::new().read(true)).err(),
            Some(Refusal::NotRegular)
        );
        // Junctions need no privilege, unlike symbolic links.
        let junction = root.join("junction");
        let made = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .output()
            .unwrap();
        assert!(made.status.success());
        assert_eq!(directory(&junction, Access::Private), Err(Refusal::NotRegular));
        fs::remove_dir(&junction).unwrap();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rename_never_replaces_and_identity_follows_the_object() {
        let root = base("rename");
        let (from, to) = (root.join("from"), root.join("to"));
        fs::create_dir(&from).unwrap();
        fs::write(from.join("kept"), b"new").unwrap();
        fs::create_dir(&to).unwrap();
        assert!(rename_no_replace(&from, &to).is_err());
        assert!(from.join("kept").exists());
        fs::remove_dir(&to).unwrap();
        rename_no_replace(&from, &to).unwrap();
        assert_eq!(fs::read(to.join("kept")).unwrap(), b"new");
        let kept = open_file(&to.join("kept"), OpenOptions::new().read(true)).unwrap();
        assert!(same_object(&kept, &to.join("kept")));
        fs::write(to.join("other"), b"other").unwrap();
        assert!(!same_object(&kept, &to.join("other")));
        fs::remove_dir_all(&root).unwrap();
    }
}
