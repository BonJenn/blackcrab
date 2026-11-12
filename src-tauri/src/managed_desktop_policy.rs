//! Dependency-free policy shared by the private owner and launcher. No IO/credentials in diagnostics.
use std::collections::HashSet;
use std::path::{Component, Path};
use std::time::{Duration, Instant};
pub(crate) fn captured_child_alive(
    child: &std::sync::Arc<std::sync::Mutex<std::process::Child>>,
) -> Result<bool, ()> {
    Ok(child
        .lock()
        .map_err(|_| ())?
        .try_wait()
        .map_err(|_| ())?
        .is_none())
}
pub(crate) fn arm64_macho(bytes: &[u8]) -> bool {
    bytes.len() >= 32
        && bytes[..4] == [0xcf, 0xfa, 0xed, 0xfe]
        && u32::from_le_bytes(bytes[4..8].try_into().unwrap()) == 0x0100000c
        && u32::from_le_bytes(bytes[12..16].try_into().unwrap()) == 2
}
pub(crate) const MAX_FRAME: usize = 16_384;
pub(crate) fn uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
/// T3 EnvironmentId is a trimmed non-empty string, not a UUID. Match
/// ECMAScript trim exactly; Rust's Unicode whitespace set also includes NEL.
pub(crate) fn environment_id(s: &str) -> bool {
    let trim = |c: char| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}'
        | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}'
        | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}');
    !s.is_empty() && s.trim_matches(trim) == s
}
pub(crate) fn valid_native_pair(s: &str) -> bool {
    s.len() == 12
        && s.bytes()
            .all(|b| b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ".contains(&b))
}
pub(crate) fn native_pair_expiry(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() != 24
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'.'
        || b[23] != b'Z'
    {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<u64>().ok();
    let (y, m, d, h, min, sec, ms) = (
        n(0, 4)?,
        n(5, 7)?,
        n(8, 10)?,
        n(11, 13)?,
        n(14, 16)?,
        n(17, 19)?,
        n(20, 23)?,
    );
    if !(1970..=9999).contains(&y) || !(1..=12).contains(&m) || h > 23 || min > 59 || sec > 59 {
        return None;
    }
    let leap = |y: u64| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let months = [
        31,
        if leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if d < 1 || d > months[(m - 1) as usize] {
        return None;
    }
    let days = (1970..y)
        .map(|y| if leap(y) { 366 } else { 365 })
        .sum::<u64>()
        + months[..(m - 1) as usize].iter().sum::<u64>()
        + d
        - 1;
    Some((((days * 24 + h) * 60 + min) * 60 + sec) * 1000 + ms)
}
pub(crate) fn relative(s: &str) -> Result<&str, ()> {
    if s.is_empty()
        || s.len() > 4096
        || s.contains(['\\', '\0', ':'])
        || s.starts_with('/')
        || s.split('/').any(|p| p.is_empty() || p == "." || p == "..")
    {
        Err(())
    } else {
        Ok(s)
    }
}
/// `Some(None)` denotes a real terminal entry, `Some(Some(target))` a symlink.
pub(crate) fn resolve_link<'a>(
    start: &str,
    lookup: impl Fn(&str) -> Option<Option<&'a str>>,
) -> Result<String, ()> {
    let boundaries = [
        "Blackcrab.app/Contents/Frameworks",
        "Blackcrab.app/Contents/Resources/app/node_modules",
    ];
    let boundary = boundaries
        .iter()
        .find(|b| start.starts_with(&format!("{b}/")))
        .ok_or(())?;
    let depth = boundary.split('/').count();
    let mut current = start.to_owned();
    let mut seen = HashSet::new();
    for _ in 0..32 {
        if !seen.insert(current.clone()) {
            return Err(());
        }
        let parts: Vec<_> = current.split('/').collect();
        let mut replacement = None;
        for i in 1..=parts.len() {
            let prefix = parts[..i].join("/");
            if let Some(Some(target)) = lookup(&prefix) {
                if !prefix.starts_with(&format!("{boundary}/"))
                    || target.is_empty()
                    || target.len() > 1024
                    || target.starts_with('/')
                    || target.contains(['\\', '\0', ':'])
                {
                    return Err(());
                }
                let joined = Path::new(&prefix)
                    .parent()
                    .ok_or(())?
                    .join(target)
                    .join(parts[i..].join("/"));
                let mut normalized = Vec::new();
                for c in joined.components() {
                    match c {
                        Component::Normal(x) => normalized.push(x.to_str().ok_or(())?.to_owned()),
                        Component::CurDir => {}
                        Component::ParentDir => {
                            if normalized.len() <= depth || normalized.pop().is_none() {
                                return Err(());
                            }
                        }
                        _ => return Err(()),
                    }
                }
                let next = normalized.join("/");
                relative(&next)?;
                if next != *boundary && !next.starts_with(&format!("{boundary}/")) {
                    return Err(());
                }
                replacement = Some(next);
                break;
            }
        }
        match replacement {
            Some(next) => current = next,
            None => return lookup(&current).is_some().then_some(current).ok_or(()),
        }
    }
    Err(())
}
/// Narrow fail-closed XML plist reader for the pinned producer, not an XML/entity engine.
pub(crate) fn plist_string<'a>(xml: &'a str, wanted: &str) -> Result<&'a str, ()> {
    if !xml.starts_with("<?xml")
        || xml.len() > 2 * 1024 * 1024
        || xml.contains('&')
        || xml.contains("<!--")
        || xml.contains("<![CDATA[")
    {
        return Err(());
    }
    let mut rest = xml;
    let mut stack: Vec<&str> = Vec::new();
    let mut pending = false;
    let mut result = None;
    let mut root_seen = false;
    while !rest.is_empty() {
        if rest.trim().is_empty() {
            break;
        }
        let start = rest.find('<').ok_or(())?;
        let text = &rest[..start];
        if !text.trim().is_empty()
            && !stack
                .last()
                .is_some_and(|t| ["key", "string", "integer", "real", "data", "date"].contains(t))
        {
            return Err(());
        }
        rest = &rest[start..];
        if rest.starts_with("<?xml") {
            if root_seen {
                return Err(());
            }
            let end = rest.find("?>").ok_or(())?;
            rest = &rest[end + 2..];
            continue;
        }
        if rest.starts_with("<!DOCTYPE plist PUBLIC ") {
            if root_seen || rest.contains("<!ENTITY") {
                return Err(());
            }
            let end = rest.find('>').ok_or(())?;
            if rest[..end].contains('[') {
                return Err(());
            }
            rest = &rest[end + 1..];
            continue;
        }
        let end = rest.find('>').ok_or(())?;
        let tag = &rest[1..end];
        rest = &rest[end + 1..];
        if let Some(close) = tag.strip_prefix('/') {
            if stack.pop() != Some(close) {
                return Err(());
            }
            continue;
        }
        if stack
            .last()
            .is_some_and(|t| ["key", "string", "integer", "real", "data", "date"].contains(t))
        {
            return Err(());
        }
        let name = if tag == "plist version=\"1.0\"" || tag == "plist" {
            "plist"
        } else {
            tag
        };
        if name == "plist" {
            if root_seen || !stack.is_empty() {
                return Err(());
            }
            root_seen = true;
        } else if ![
            "dict", "array", "key", "string", "integer", "real", "data", "date", "true/", "false/",
        ]
        .contains(&name)
        {
            return Err(());
        }
        if stack.len() == 2 && stack[0] == "plist" && stack[1] == "dict" {
            if name == "key" {
                let key = rest.split('<').next().ok_or(())?;
                pending = key == wanted;
                if pending && result.is_some() {
                    return Err(());
                }
            } else if pending {
                if name != "string" {
                    return Err(());
                }
                result = Some(rest.split('<').next().ok_or(())?);
                pending = false;
            }
        }
        if !name.ends_with('/') {
            stack.push(name);
        }
        if rest.trim().is_empty() {
            rest = "";
        }
    }
    if !stack.is_empty() || !root_seen || pending {
        return Err(());
    }
    result.ok_or(())
}

#[derive(Default)]
pub(crate) struct Frames {
    pending: Vec<u8>,
    started: Option<Instant>,
}
impl Frames {
    /// Idle is unlimited. Only an incomplete frame gets the2s completion deadline.
    pub(crate) fn check(&self, now: Instant) -> Result<(), ()> {
        if self
            .started
            .is_some_and(|s| now.duration_since(s) > Duration::from_secs(2))
        {
            Err(())
        } else {
            Ok(())
        }
    }
    pub(crate) fn push(&mut self, chunk: &[u8], now: Instant) -> Result<Option<Vec<u8>>, ()> {
        self.check(now)?;
        if chunk.is_empty() {
            return Ok(None);
        }
        if self.pending.is_empty() {
            self.started = Some(now);
        }
        if self.pending.len() + chunk.len() > MAX_FRAME {
            return Err(());
        }
        self.pending.extend_from_slice(chunk);
        let Some(i) = self.pending.iter().position(|b| *b == b'\n') else {
            return Ok(None);
        };
        if i + 1 != self.pending.len() {
            return Err(());
        }
        let result = self.pending[..i].to_vec();
        self.pending.clear();
        self.started = None;
        Ok(Some(result))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[test]
    fn environment_identity_preserves_original_non_uuid_contract() {
        for value in ["legacy-env", "env_nativeqa_123", "環境-🦀", "a b", "a\nb", "\u{0085}"] {
            assert!(environment_id(value), "{value:?}");
        }
        assert!(environment_id(&"x".repeat(1024)));
        assert!(!environment_id(""));
        for c in ['\u{0009}', '\u{000a}', '\u{000b}', '\u{000c}', '\u{000d}', ' ',
            '\u{00a0}', '\u{1680}', '\u{2000}', '\u{200a}', '\u{2028}', '\u{2029}',
            '\u{202f}', '\u{205f}', '\u{3000}', '\u{feff}'] {
            assert!(!environment_id(&format!("{c}legacy")));
            assert!(!environment_id(&format!("legacy{c}")));
            assert!(!environment_id(&c.to_string()));
        }
        assert!(!uuid("legacy-env"));
        assert!(uuid("12345678-1234-1234-1234-123456789abc"));
    }
    #[test]
    fn idle_is_not_a_ten_second_expiry() {
        let t = Instant::now();
        let mut f = Frames::default();
        assert!(f.check(t + Duration::from_secs(31 * 86400)).is_ok());
        assert_eq!(
            f.push(b"{}\n", t + Duration::from_secs(31 * 86400))
                .unwrap(),
            Some(b"{}".to_vec())
        );
    }
    #[test]
    fn fragmented_frame_is_bounded_even_with_drip_feeding() {
        let t = Instant::now();
        let mut f = Frames::default();
        assert_eq!(f.push(b"{", t).unwrap(), None);
        assert_eq!(f.push(b"}", t + Duration::from_millis(1500)).unwrap(), None);
        assert!(f.push(b"\n", t + Duration::from_millis(2001)).is_err());
        let mut f = Frames::default();
        assert!(f.push(&vec![b'x'; MAX_FRAME + 1], t).is_err());
        let mut f = Frames::default();
        assert!(f.push(b"{}\n{}\n", t).is_err());
    }
    #[test]
    fn complete_frame_resets_partial_deadline() {
        let t = Instant::now();
        let mut f = Frames::default();
        f.push(b"{", t).unwrap();
        assert_eq!(
            f.push(b"}\n", t + Duration::from_secs(1)).unwrap(),
            Some(b"{}".to_vec())
        );
        assert!(f.check(t + Duration::from_secs(31 * 86400)).is_ok());
    }
    #[test]
    fn epochs_ids_and_grants_are_canonical() {
        assert!(uuid("12345678-1234-1234-1234-123456789abc"));
        for s in ["12345678-1234-1234-1234-123456789ABC", "1234", "../private"] {
            assert!(!uuid(s));
        }
        assert!(valid_native_pair("23456789ABCD"));
        for s in [
            "23456789ABCI",
            "23456789ABCO",
            "23456789abcD",
            "23456789ABCDE",
        ] {
            assert!(!valid_native_pair(s));
        }
    }
    #[test]
    fn utc_expiry_matches_js_iso_without_normalizing_invalid_dates() {
        assert_eq!(native_pair_expiry("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            native_pair_expiry("2024-02-29T12:34:56.789Z"),
            Some(1709210096789)
        );
        for s in [
            "2023-02-29T12:34:56.789Z",
            "2024-13-01T00:00:00.000Z",
            "2024-02-29T24:00:00.000Z",
            "2024-02-29T00:00:60.000Z",
            "2024-02-29T00:00:00.000+00:00",
        ] {
            assert_eq!(native_pair_expiry(s), None);
        }
    }
    #[test]
    fn unsafe_inventory_paths_fail_closed() {
        for s in [
            "", "/private", "../x", "a/../b", "C:x", "a\\b", "a//b", "a\0b",
        ] {
            assert!(relative(s).is_err());
        }
        assert!(relative("Blackcrab.app/Contents/MacOS/Blackcrab").is_ok());
    }
    #[test]
    fn framework_and_external_closure_links_are_supported() {
        let fw = "Blackcrab.app/Contents/Frameworks/F.framework";
        let nm = "Blackcrab.app/Contents/Resources/app/node_modules";
        let mut m: BTreeMap<String, Option<String>> = BTreeMap::new();
        m.insert(format!("{fw}/Versions/A/F"), None);
        m.insert(format!("{fw}/Versions/Current"), Some("A".into()));
        m.insert(format!("{fw}/F"), Some("Versions/Current/F".into()));
        m.insert(format!("{nm}/@scope/a"), Some("../.blackcrab/a".into()));
        m.insert(format!("{nm}/.blackcrab/a"), None);
        let lookup = |p: &str| m.get(p).map(|v| v.as_deref());
        assert_eq!(
            resolve_link(&format!("{fw}/F"), lookup).unwrap(),
            format!("{fw}/Versions/A/F")
        );
        assert_eq!(
            resolve_link(&format!("{nm}/@scope/a"), lookup).unwrap(),
            format!("{nm}/.blackcrab/a")
        );
    }
    #[test]
    fn escapes_cross_subtrees_cycles_and_dangling_links_are_rejected() {
        let nm = "Blackcrab.app/Contents/Resources/app/node_modules";
        for target in [
            "../../../../Frameworks/F",
            "../../../../../../private",
            "/private",
            "C:private",
            "missing",
            "loop",
        ] {
            let mut m = BTreeMap::new();
            m.insert(format!("{nm}/loop"), Some(target.to_owned()));
            assert!(
                resolve_link(&format!("{nm}/loop"), |p| m.get(p).map(|v| v.as_deref())).is_err()
            );
        }
        assert!(resolve_link("outside", |_| Some(None)).is_err());
    }
    #[test]
    fn real_production_framework_and_external_closure_geometry_matches_policy() {
        let mut entries: BTreeMap<&str, Option<&str>> = BTreeMap::new();
        for line in include_str!("managed_desktop_links.fixture.tsv")
            .lines()
            .filter(|s| !s.starts_with('#'))
        {
            let fields: Vec<_> = line.split('\t').collect();
            match fields.as_slice() {
                ["L", path, target] => {
                    entries.insert(path, Some(target));
                }
                ["T", path] => {
                    entries.insert(path, None);
                }
                _ => panic!("Invalid link fixture"),
            }
        }
        let mut count = 0;
        for (p, target) in &entries {
            if target.is_some() {
                assert!(
                    resolve_link(p, |name| entries.get(name).copied()).is_ok(),
                    "{p}"
                );
                count += 1;
            }
        }
        assert_eq!(count, 40);
    }
    #[test]
    fn pinned_plist_namespace_is_root_level_and_unambiguous() {
        let xml = include_str!("managed_desktop_info.fixture.plist");
        for (key, value) in [
            ("CFBundleIdentifier", "com.blackcrab.desktop.managed"),
            ("CFBundleName", "Blackcrab"),
            ("CFBundleExecutable", "Blackcrab"),
            ("CFBundleDisplayName", "Blackcrab"),
        ] {
            assert_eq!(plist_string(xml, key), Ok(value));
        }
        for xml in ["bplist00","<?xml?><plist><dict><key>A</key><string>x</string><key>A</key><string>y</string></dict></plist>","<?xml?><plist><dict><key>Other</key><dict><key>A</key><string>fake</string></dict></dict></plist>","<?xml?><plist><dict><!--<key>A</key><string>fake</string>--></dict></plist>","<?xml?><plist><dict><key>A</key><string>own&#65;</string></dict></plist>"] {assert!(plist_string(xml,"A").is_err());}
    }
    #[test]
    fn captured_child_fixture() {
        if std::env::var_os("BLACKCRAB_CAPTURED_FIXTURE").is_some() {
            use std::io::Read;
            let _ = std::io::stdin().read_to_end(&mut Vec::new());
        }
    }
    #[test]
    fn liveness_uses_only_the_exact_captured_child_and_reaps_normal_exit() {
        use std::process::{Command, Stdio};
        use std::sync::{Arc, Mutex};
        let fixture = format!(
            "{}::captured_child_fixture",
            module_path!().split_once("::").unwrap().1
        );
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", fixture.as_str()])
            .env_clear()
            .env("BLACKCRAB_CAPTURED_FIXTURE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let child = Arc::new(Mutex::new(child));
        assert!(captured_child_alive(&child).unwrap());
        drop(input);
        let deadline = Instant::now() + Duration::from_secs(3);
        while captured_child_alive(&child).unwrap() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!captured_child_alive(&child).unwrap());
    }
    #[test]
    fn only_the_pinned_native_executable_architecture_is_accepted() {
        let mut header = [0u8; 32];
        header[..4].copy_from_slice(&[0xcf, 0xfa, 0xed, 0xfe]);
        header[4..8].copy_from_slice(&0x0100000cu32.to_le_bytes());
        header[12..16].copy_from_slice(&2u32.to_le_bytes());
        assert!(arm64_macho(&header));
        header[4] = 7;
        assert!(!arm64_macho(&header));
        assert!(!arm64_macho(b"#!/bin/sh\necho arbitrary CLI"));
    }
}
