//! Windows-only issuer tests: the pipe loop over real pipes and the private
//! file rules against real NTFS owners and DACLs. The state machine itself is
//! covered by the Unix tests, which share its code unchanged.
use super::*;
use crate::managed_private_windows as private;
use std::io::{BufRead, BufReader};
use std::process::Command;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        // A canonical long path: the runner's temp directory is reached
        // through an 8.3 short name.
        let temp = std::env::temp_dir().canonicalize().unwrap();
        let temp = PathBuf::from(temp.to_string_lossy().trim_start_matches(r"\\?\"));
        let path = temp.join(format!("issuer-core-{}", super::super::random_secret().unwrap()));
        private::create_private_directory(&path).unwrap();
        managed_payload::private_dir(&path).unwrap();
        Self(path)
    }
    fn core(&self) -> NativeIssuer {
        NativeIssuer {
            host: ManagedHost::new(self.0.clone()),
            binding: Binding {
                schema: 1,
                self_sha256: "a".repeat(64),
                manifest_sha256: "b".repeat(64),
                generation: 7,
                environment_id: "env_fixture".into(),
                version: "0.1.7".into(),
            },
            _session_lease: managed_payload::owned_lock(&self.0.join("service-owner.lock"), true)
                .unwrap(),
            transaction: None,
            session: "c".repeat(64),
            journal: None,
            poisoned: false,
            pending_deadline: None,
            transcript_bytes: 0,
            boot_session_id: boot_session::read_boot_session_id().unwrap(),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn config() -> Configuration {
    Configuration {
        schema: 1,
        ownership: OwnershipMode::Service,
        artifact_path: PathBuf::from(r"C:\synthetic-not-a-selected-artifact"),
        manifest_digest: "b".repeat(64),
        bootstrap_secret: "d".repeat(64),
        environment_id: Some("env_fixture".into()),
        browser: None,
    }
}
fn prepare(core: &mut NativeIssuer) -> Value {
    let lease = managed_payload::owned_lock(&core.host.root.join("launcher.lock"), true).unwrap();
    serde_json::from_slice(&core.prepare_verified(1, 7, config(), lease).unwrap()).unwrap()
}
fn grant_everyone_read(path: &Path) {
    let granted = Command::new("icacls")
        .arg(path)
        .args(["/grant", "*S-1-1-0:R"])
        .output()
        .unwrap();
    assert!(granted.status.success());
}

#[test]
fn pipe_loop_issues_retires_and_ends_cleanly_at_end_of_stream() {
    let fixture = Fixture::new();
    let mut core = fixture.core();
    let prepared = prepare(&mut core);
    assert_eq!(prepared["type"], "prepared");
    assert_eq!(prepared["envelope"]["kind"], "blackcrab-owned-service-auth-v1");
    let session = core.session.clone();
    let (to_issuer, mut requests) = std::io::pipe().unwrap();
    let (replies, from_issuer) = std::io::pipe().unwrap();
    let task = std::thread::spawn(move || {
        let mut input = super::super::issuer_io::PrivateInput::new(to_issuer);
        let mut output = super::super::issuer_io::PrivateOutput::new(from_issuer);
        let result = run_pipes(&mut core, &mut input, &mut output);
        (result, core.journal.unwrap().phase)
    });
    let mut replies = BufReader::new(replies);
    for phase in ["issued", "retire"] {
        let request = json!({"type":phase,"protocol":1,"epoch":1,"session":session});
        requests.write_all(&frame(&request).unwrap()).unwrap();
        let mut response = String::new();
        replies.read_line(&mut response).unwrap();
        let response: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(response["type"], if phase == "issued" { "issued" } else { "retired" });
    }
    drop(requests);
    let (result, phase) = task.join().unwrap();
    assert!(result.is_ok());
    assert_eq!(phase, Phase::Retired);
    // The journal on disk is private, single-link and names this boot.
    let journal = read_journal(&fixture.0).unwrap().unwrap();
    assert_eq!(journal.phase, Phase::Retired);
    assert_eq!(journal.boot_session_id, Some(boot_session::read_boot_session_id().unwrap()));
}

#[test]
fn end_of_stream_while_prepared_is_uncertain_and_never_retires() {
    let fixture = Fixture::new();
    let mut core = fixture.core();
    prepare(&mut core);
    let (to_issuer, requests) = std::io::pipe().unwrap();
    let (_replies, from_issuer) = std::io::pipe().unwrap();
    drop(requests);
    let mut input = super::super::issuer_io::PrivateInput::new(to_issuer);
    let mut output = super::super::issuer_io::PrivateOutput::new(from_issuer);
    assert!(run_pipes(&mut core, &mut input, &mut output).is_err());
    assert_eq!(read_journal(&fixture.0).unwrap().unwrap().phase, Phase::Prepared);
}

#[test]
fn a_malformed_frame_poisons_the_session_and_ends_the_loop() {
    let fixture = Fixture::new();
    let mut core = fixture.core();
    let (to_issuer, mut requests) = std::io::pipe().unwrap();
    let (_replies, from_issuer) = std::io::pipe().unwrap();
    requests.write_all(b"{\"type\":\"unknown\"}\n").unwrap();
    let mut input = super::super::issuer_io::PrivateInput::new(to_issuer);
    let mut output = super::super::issuer_io::PrivateOutput::new(from_issuer);
    assert!(run_pipes(&mut core, &mut input, &mut output).is_err());
    assert!(core.poisoned);
}

#[test]
fn the_helper_copy_is_installed_private_under_its_digest_and_verified_by_handle() {
    let fixture = Fixture::new();
    let host = ManagedHost::new(fixture.0.clone());
    let source = b"MZ synthetic helper bytes";
    let digest = format!("{:x}", Sha256::digest(source));
    let installed = install_issuer_copy(&host, source, &digest).unwrap();
    assert_eq!(installed, fixture.0.join("issuer").join(&digest).join("blackcrab-issuer.exe"));
    assert_eq!(fs::read(&installed).unwrap(), source);
    let directory = installed.parent().unwrap();
    verify_installed_copy(directory, &installed, &digest).unwrap();
    // Installing the same bytes again verifies the existing copy.
    assert_eq!(install_issuer_copy(&host, source, &digest).unwrap(), installed);
    assert!(verify_installed_copy(directory, &installed, &"0".repeat(64)).is_err());
    assert!(!fs::read_dir(fixture.0.join("issuer"))
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(".native-issuer-")));
    // Readable by anyone else is not private.
    grant_everyone_read(&installed);
    assert!(verify_installed_copy(directory, &installed, &digest).is_err());
    assert!(install_issuer_copy(&host, source, &digest).is_err());
}

#[test]
fn private_files_must_be_ours_alone_single_link_and_within_bound() {
    let fixture = Fixture::new();
    let file = fixture.0.join("binding.json");
    super::super::write_new(&file, b"{\"schema\":1}").unwrap();
    assert_eq!(private_bytes(&file, 64).unwrap(), b"{\"schema\":1}");
    assert!(private_bytes(&file, 4).is_err());
    assert!(private_bytes(&fixture.0.join("absent"), 64).is_err());
    assert!(private_bytes(&fixture.0, 64).is_err());
    // A second name for the same file.
    fs::hard_link(&file, fixture.0.join("alias")).unwrap();
    assert!(private_bytes(&file, 64).is_err());
    fs::remove_file(fixture.0.join("alias")).unwrap();
    assert_eq!(private_bytes(&file, 64).unwrap(), b"{\"schema\":1}");
    // The same bytes, readable by everyone.
    grant_everyone_read(&file);
    assert!(private_bytes(&file, 64).is_err());
    // Still an ordinary regular file for digest purposes.
    assert_eq!(private_or_public_regular(&file, 64).unwrap(), b"{\"schema\":1}");
}

#[test]
fn a_path_reached_through_a_junction_is_not_canonical() {
    let fixture = Fixture::new();
    assert!(platform::canonical(&fixture.0));
    let real = fixture.0.join("real");
    fs::create_dir(&real).unwrap();
    assert!(platform::canonical(&real));
    let junction = fixture.0.join("junction");
    let made = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&real)
        .output()
        .unwrap();
    assert!(made.status.success());
    assert!(!platform::canonical(&junction));
    assert!(!platform::canonical(&fixture.0.join("real").join("..").join("real")));
    assert!(!platform::canonical(&fixture.0.join("missing")));
    fs::remove_dir(&junction).unwrap();
}
