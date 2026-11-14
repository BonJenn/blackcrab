//! Native package layout selected by the launcher, never by untrusted manifest data.
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Target {
    Mac,
    Linux,
    Windows,
}
impl Target {
    pub(super) fn native() -> Result<Self, String> {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => Ok(Self::Mac),
            ("linux", "x86_64") => Ok(Self::Linux),
            ("windows", "x86_64") => Ok(Self::Windows),
            _ => Err("Unsupported managed desktop platform".into()),
        }
    }
    pub(super) fn id(self) -> &'static str {
        match self {
            Self::Mac => "darwin-arm64",
            Self::Linux => "linux-x64",
            Self::Windows => "win32-x64",
        }
    }
    pub(super) fn format(self) -> u8 {
        if self == Self::Mac {
            1
        } else {
            2
        }
    }
    pub(super) fn executable(self) -> &'static str {
        match self {
            Self::Mac => "Blackcrab.app/Contents/MacOS/Blackcrab",
            Self::Linux => "Blackcrab",
            Self::Windows => "Blackcrab.exe",
        }
    }
    pub(super) fn payload(self) -> &'static str {
        if self == Self::Mac {
            "Blackcrab.app/Contents/Resources/app"
        } else {
            "resources/app"
        }
    }
    pub(super) fn electron(self) -> Value {
        let (platform, arch, digest) = match self {
            Self::Mac => (
                "darwin",
                "arm64",
                "687f922034f1e991ab34ed7f47c4cb4e5c5e85e974b0ce155c22ce6d6f699aa3",
            ),
            Self::Linux => (
                "linux",
                "x64",
                "2be868b71b0aa71f30e6b5567a106a35a049385e963183c074aad1975ead5167",
            ),
            Self::Windows => (
                "win32",
                "x64",
                "5099bdc11c6a78edff35851491c1f8228a1c2e844e1b376eee219402c42c6011",
            ),
        };
        json!({"version":"44.10.1","platform":platform,"arch":arch,"archiveSha256":digest,"url":format!("https://github.com/electron/electron/releases/download/v44.10.1/electron-v44.10.1-{platform}-{arch}.zip")})
    }
    pub(super) fn valid_path(self, path: &str) -> bool {
        if self != Self::Windows {
            return true;
        }
        path.split('/').all(|part| {
            if part.ends_with(['.', ' ']) || part.chars().any(|c| c < ' ' || "<>\"|?*".contains(c))
            {
                return false;
            }
            let stem = part.split('.').next().unwrap_or("").to_uppercase();
            !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !["COM", "LPT"].iter().any(|prefix| {
                    stem.strip_prefix(prefix).is_some_and(|s| {
                        matches!(
                            s,
                            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                        )
                    })
                })
        })
    }
    pub(super) fn valid_header(self, file: &mut File) -> bool {
        let mut header = [0u8; 64];
        if file.read_exact(&mut header).is_err() {
            return false;
        }
        match self {
            Self::Mac => header[..4] == [0xcf, 0xfa, 0xed, 0xfe] && header[4..8] == [0x0c, 0, 0, 1],
            Self::Linux => {
                header[..6] == [0x7f, b'E', b'L', b'F', 2, 1] && header[18..20] == [62, 0]
            }
            Self::Windows => {
                if header[..2] != *b"MZ" {
                    return false;
                }
                let offset = u32::from_le_bytes(header[60..64].try_into().unwrap()) as u64;
                if !(64..=1024 * 1024).contains(&offset)
                    || file.seek(SeekFrom::Start(offset)).is_err()
                {
                    return false;
                }
                let mut pe = [0u8; 6];
                file.read_exact(&mut pe).is_ok() && pe == [b'P', b'E', 0, 0, 0x64, 0x86]
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn native_layout_rejects_windows_aliases_and_device_paths() {
        for p in [
            "aux",
            "NUL.txt",
            "dir/COM1.log",
            "Lpt³.txt",
            "trailing.",
            "space ",
            "bad?file",
            "bad\u{1f}file",
        ] {
            assert!(!Target::Windows.valid_path(p), "{p}");
        }
        for p in [
            "console.txt",
            "company/COM10.txt",
            "resources/app/package.json",
        ] {
            assert!(Target::Windows.valid_path(p));
        }
        assert_eq!(Target::Mac.format(), 1);
        assert_eq!(Target::Windows.format(), 2);
        assert_ne!(Target::Linux.electron(), Target::Windows.electron());
    }
    #[test]
    fn native_headers_reject_wrong_architecture_and_truncated_pe_offsets() {
        let mut elf = vec![0u8; 64];
        elf[..6].copy_from_slice(&[0x7f, b'E', b'L', b'F', 2, 1]);
        elf[18] = 62;
        let mut pe = vec![0u8; 134];
        pe[..2].copy_from_slice(b"MZ");
        pe[60] = 128;
        pe[128..].copy_from_slice(&[b'P', b'E', 0, 0, 0x64, 0x86]);
        let mut mac = vec![0u8; 64];
        mac[..8].copy_from_slice(&[0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]);
        for (target, bytes) in [
            (Target::Mac, mac),
            (Target::Linux, elf),
            (Target::Windows, pe),
        ] {
            let mut file = tempfile::tempfile().unwrap();
            file.write_all(&bytes).unwrap();
            for candidate in [Target::Mac, Target::Linux, Target::Windows] {
                file.rewind().unwrap();
                assert_eq!(candidate.valid_header(&mut file), candidate == target);
            }
            file.set_len(32).unwrap();
            file.rewind().unwrap();
            assert!(!target.valid_header(&mut file));
        }
        for offset in [0u32, 63, 129, 1024 * 1024 + 1, u32::MAX] {
            let mut file = tempfile::tempfile().unwrap();
            let mut bytes = [0u8; 134];
            bytes[..2].copy_from_slice(b"MZ");
            bytes[60..64].copy_from_slice(&offset.to_le_bytes());
            file.write_all(&bytes).unwrap();
            file.rewind().unwrap();
            assert!(!Target::Windows.valid_header(&mut file));
        }
    }
}
