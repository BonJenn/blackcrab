//! Native launchd ownership, bounded manager IO and explicit lifecycle actions.
use super::*;
use std::collections::BTreeMap;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
#[path = "managed_service_manager_io.rs"]
mod manager_io;
const LABEL: &str = "com.blackcrab.desktop.managed.service";
// launchd must attribute the independently running host to the signed app for
// macOS file/network permission prompts and System Settings.
const RESPONSIBLE_BUNDLE: &str = "com.bonjenn.blackcrab";
const UNIT_LIMIT: usize = 64 * 1024;
fn invalid() -> String { "The background-service unit is unavailable or belongs to a different owner".into() }
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnerStamp {
    schema: u32,
    root: String,
    manifest_sha256: String,
    generation: u64,
    environment_id: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
struct UnitDocument {
    label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    associated_bundle_identifiers: Option<Vec<String>>,
    program_arguments: Vec<String>,
    environment_variables: BTreeMap<String, String>,
    working_directory: String,
    run_at_load: bool,
    keep_alive: bool,
    throttle_interval: u32,
    exit_time_out: u32,
    process_type: String,
    standard_out_path: String,
    standard_error_path: String,
}
/// The plan has no Deserialize or renderer constructor. Its only production
/// factory verifies the compiled native selection and reads OS account HOME.
pub(super) struct ServiceUnitPlan {
    document: UnitDocument,
    root: PathBuf,
    configuration: Configuration,
    generation: u64,
    unit_path: PathBuf,
    domain: String,
}
use super::ServiceAction as Action;
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Registration {pub(super) installed:bool,pub(super) loaded:bool}
fn manager_value(text:&str,key:&str,separator:&str,expected:&str)->bool {
    let prefix=format!("{key}{separator}");
    let values:Vec<_>=text.lines().filter_map(|line|line.trim().strip_prefix(&prefix)).collect();
    values.len()==1&&(values[0]==expected||serde_json::to_string(expected).ok().as_deref()==Some(values[0]))
}
async fn control_lease(root:&Path)->Result<File,String>{
    let file=OpenOptions::new().read(true).write(true).create(true).truncate(false).mode(0o600)
        .custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(root.join("service-control.lock")).map_err(|_|invalid())?;
    let metadata=file.metadata().map_err(|_|invalid())?;
    if !metadata.is_file()||metadata.uid()!=unsafe{libc::geteuid()}||metadata.nlink()!=1||metadata.mode()&0o777!=0o600||metadata.len()!=0{return Err(invalid());}
    let deadline=tokio::time::Instant::now()+Duration::from_secs(150);
    loop{match file.try_lock(){
        Ok(())=>return Ok(file),
        Err(std::fs::TryLockError::WouldBlock) if tokio::time::Instant::now()<deadline=>tokio::time::sleep(Duration::from_millis(50)).await,
        Err(_)=>return Err("Another background-service operation is active; refresh after it completes".into()),
    }}
}
impl ServiceUnitPlan {
    pub(super) async fn from_host(host: &ManagedHost) -> Result<Self, String> {
        let _operation = host.operation.lock().await;
        host.prepare()?;
        let _lease = host.lease().await?;
        host.initialize_locked()?;
        let config = host.read_config()?.ok_or_else(invalid)?;
        if config.ownership != OwnershipMode::Service { return Err(invalid()); }
        let generation = service_issuer::control_generation(host, &config)?;
        let home = crate::managed_desktop::native_account_home()?;
        let entry = config.artifact_path.join("t3");
        let mut directories: Vec<String> = std::env::var_os("PATH").into_iter()
            .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
            .filter(|value| value.is_absolute()).filter_map(|value| value.to_str().map(str::to_owned))
            .filter(|value| value.chars().all(|c| c >= ' ' || matches!(c, '\t' | '\n' | '\r'))).collect();
        for directory in [entry.parent().ok_or_else(invalid)?.to_str().ok_or_else(invalid)?,
            "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            if !directories.iter().any(|value| value == directory) { directories.push(directory.into()); }
        }
        Self::build(&host.root, &config, generation, &home, unsafe { libc::getuid() }, directories.join(":"))
    }
    fn build(root: &Path, config: &Configuration, generation: u64, home: &Path, uid: u32, environment_path: String) -> Result<Self, String> {
        let text = |path: &Path| path.to_str().map(str::to_owned).ok_or_else(invalid);
        let log = text(&root.join("logs/boot-service.log"))?;
        let home_text = text(home)?;
        let environment_id = config.environment_id.clone().ok_or_else(invalid)?;
        let owner = OwnerStamp {schema:1,root:text(root)?,manifest_sha256:config.manifest_digest.clone(),generation,environment_id};
        let owner_stamp = serde_json::to_string(&owner).map_err(|_| invalid())?;
        let document = UnitDocument {
            label: LABEL.into(), program_arguments: vec![text(&config.artifact_path.join("t3"))?, "__service-launcher".into()],
            associated_bundle_identifiers: Some(vec![RESPONSIBLE_BUNDLE.into()]),
            environment_variables: BTreeMap::from([
                ("PATH".into(), environment_path), ("T3CODE_HOME".into(), text(&root.join("host"))?),
                ("T3_BOOT_SERVICE_UNIT".into(), format!("{LABEL}.plist")),
                // Selection metadata, never a standalone authority receipt.
                ("BLACKCRAB_NATIVE_SERVICE_OWNER".into(), owner_stamp)]),
            working_directory: home_text, run_at_load: true, keep_alive: true,
            throttle_interval: 5, exit_time_out: 90, process_type: "Interactive".into(),
            standard_out_path: log.clone(), standard_error_path: log,
        };
        Ok(Self {document,root:root.to_path_buf(),configuration:config.clone(),generation,unit_path:home.join("Library/LaunchAgents").join(format!("{LABEL}.plist")),domain:format!("gui/{uid}")})
    }
    pub(super) fn render(&self) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        plist::to_writer_xml(&mut bytes, &self.document).map_err(|_| invalid())?;
        if bytes.len() > UNIT_LIMIT { return Err(invalid()); }
        Ok(bytes)
    }
    pub(super) fn recognizes(&self, bytes: &[u8]) -> Result<(), String> {
        self.owned_document(bytes).map(|_| ())
    }
    fn owned_document(&self, bytes: &[u8]) -> Result<UnitDocument, String> {
        if bytes.len() > UNIT_LIMIT { return Err(invalid()); }
        let mut document: UnitDocument = plist::from_bytes(bytes).map_err(|_| invalid())?;
        let original = document.clone();
        let mut expected = self.document.clone();
        // Installer PATH can change between app launches. Ownership binds every
        // other field; preserve the installed PATH instead of silently rewriting it.
        let installed_path = document.environment_variables.remove("PATH").ok_or_else(invalid)?;
        if installed_path.is_empty() || installed_path.contains('\0') { return Err(invalid()); }
        expected.environment_variables.remove("PATH");
        // Accept only the exact prior document without this field. A present
        // empty/foreign/multiple association is not a legacy unit we may adopt.
        if document.associated_bundle_identifiers.is_none() {
            document.associated_bundle_identifiers = expected.associated_bundle_identifiers.clone();
        }
        if document != expected { return Err(invalid()); }
        Ok(original)
    }
    fn permission_identity_upgrade(&self, bytes: &[u8]) -> Result<Option<Vec<u8>>, String> {
        let mut document = self.owned_document(bytes)?;
        if document.associated_bundle_identifiers.is_some() { return Ok(None); }
        // Preserve the installed PATH and every owner, runtime and lifecycle field.
        document.associated_bundle_identifiers = self.document.associated_bundle_identifiers.clone();
        let mut updated = Vec::new();
        plist::to_writer_xml(&mut updated, &document).map_err(|_| invalid())?;
        if updated.len() > UNIT_LIMIT { return Err(invalid()); }
        Ok(Some(updated))
    }
    fn needs_permission_identity_upgrade(&self) -> Result<bool, String> {
        match self.read_owned_unit()? {
            Some(bytes) => Ok(self.permission_identity_upgrade(&bytes)?.is_some()),
            None => Ok(false),
        }
    }
    /// Called under the control lease only after launchd and the native owner
    /// journal confirm stopped. Status and attachment never rewrite the unit.
    fn upgrade_permission_identity(&self) -> Result<(), String> {
        let original = self.read_owned_unit()?.ok_or_else(invalid)?;
        let Some(updated) = self.permission_identity_upgrade(&original)? else { return Ok(()); };
        let directory = self.unit_path.parent().ok_or_else(invalid)?;
        let temporary = directory.join(format!(".blackcrab-service-identity-{}", random_secret()?));
        write_new(&temporary, &updated)?;
        let result = (|| {
            if self.read_owned_unit()?.as_deref() != Some(original.as_slice()) { return Err(invalid()); }
            fs::rename(&temporary, &self.unit_path).map_err(io_error)?;
            File::open(directory).and_then(|file| file.sync_all()).map_err(io_error)
        })();
        if fs::symlink_metadata(&temporary).is_ok() { let _ = fs::remove_file(&temporary); }
        result
    }
    fn directory_ready(&self) -> Result<bool, String> {
        let home = Path::new(&self.document.working_directory);
        let directory = home.join("Library/LaunchAgents");
        if self.unit_path.parent() != Some(directory.as_path()) { return Err(invalid()); }
        for directory in [home.join("Library"), directory] {
            let metadata = match fs::symlink_metadata(directory) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(_) => return Err(invalid()),
            };
            if !metadata.is_dir() || metadata.uid() != unsafe { libc::geteuid() }
                || metadata.mode() & 0o022 != 0 { return Err(invalid()); }
        }
        Ok(true)
    }
    pub(super) fn read_owned_unit(&self) -> Result<Option<Vec<u8>>, String> {
        if !self.directory_ready()? { return Ok(None); }
        let file = match OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(&self.unit_path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(invalid()),
        };
        let metadata = file.metadata().map_err(|_| invalid())?;
        if !metadata.is_file() || metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1
            || metadata.mode() & 0o777 != 0o600 || metadata.len() > UNIT_LIMIT as u64 { return Err(invalid()); }
        let mut bytes = Vec::new(); file.take(UNIT_LIMIT as u64 + 1).read_to_end(&mut bytes).map_err(|_| invalid())?;
        self.recognizes(&bytes)?; Ok(Some(bytes))
    }
    fn registered_output(&self, code:Option<i32>, stdout:&[u8], stderr:&[u8])->Result<bool,String>{
        let error=std::str::from_utf8(stderr).map_err(|_|invalid())?;
        if code==Some(113)&&error.contains("Could not find service")&&!error.contains("Could not find domain") {return Ok(false);}
        if code!=Some(0){return Err("Service-manager status could not be verified".into());}
        let text=std::str::from_utf8(stdout).map_err(|_|invalid())?;
        if !manager_value(text,"program"," = ",&self.document.program_arguments[0])
            || !manager_value(text,"path"," = ",self.unit_path.to_str().ok_or_else(invalid)?)
            || !manager_value(text,"T3CODE_HOME"," => ",&self.document.environment_variables["T3CODE_HOME"])
            || !manager_value(text,"BLACKCRAB_NATIVE_SERVICE_OWNER"," => ",&self.document.environment_variables["BLACKCRAB_NATIVE_SERVICE_OWNER"]) {
            return Err(invalid());
        }
        Ok(true)
    }
    pub(super) async fn registration(&self)->Result<Registration,String>{
        let installed=self.read_owned_unit()?.is_some();
        let requests=self.requests(Action::Status);
        let output=manager_io::launchctl(&requests[0],Path::new(&self.document.working_directory),Duration::from_secs(5)).await?;
        let loaded=self.registered_output(output.status.code(),&output.stdout,&output.stderr)?;
        if loaded&&!installed{return Err(invalid());}
        Ok(Registration{installed,loaded})
    }
    fn publish_unit(&self) -> Result<(), String> {
        use std::os::unix::fs::DirBuilderExt;
        if self.read_owned_unit()?.is_some() { return Ok(()); }
        let home=Path::new(&self.document.working_directory);
        for directory in [home.join("Library"),home.join("Library/LaunchAgents")] {
            match fs::DirBuilder::new().mode(0o700).create(&directory) {
                Ok(())=>{},Err(error) if error.kind()==std::io::ErrorKind::AlreadyExists=>{},Err(_)=>return Err(invalid()),
            }
            let metadata=fs::symlink_metadata(&directory).map_err(|_|invalid())?;
            if !metadata.is_dir()||metadata.uid()!=unsafe{libc::geteuid()}||metadata.mode()&0o022!=0{return Err(invalid());}
        }
        if !self.directory_ready()? {return Err(invalid());}
        let directory=self.unit_path.parent().ok_or_else(invalid)?;
        let temporary=directory.join(format!(".blackcrab-service-{}",random_secret()?));
        write_new(&temporary,&self.render()?)?;
        let result=(||{
            crate::managed_payload::publish_no_replace(&temporary,&self.unit_path)?;
            File::open(directory).and_then(|file|file.sync_all()).map_err(io_error)
        })();
        if fs::symlink_metadata(&temporary).is_ok(){let _=fs::remove_file(&temporary);}
        result
    }
    async fn checked_step(&self,args:&[String],timeout:Duration)->Result<(),String>{
        if self.read_owned_unit()?.is_none(){return Err(invalid());}
        let output=manager_io::launchctl(args,Path::new(&self.document.working_directory),timeout).await?;
        if !output.status.success(){return Err("The service manager did not complete the requested operation".into());}
        Ok(())
    }
    pub(super) async fn apply(&self,action:Action)->Result<Registration,String>{
        let _control=control_lease(&self.root).await?;
        let host=ManagedHost::new(self.root.clone());
        {
            let _lease=host.lease().await?;
            let current=host.read_config()?.ok_or_else(invalid)?;
            if serde_json::to_value(&current).map_err(io_error)?!=serde_json::to_value(&self.configuration).map_err(io_error)?
                || service_issuer::control_generation(&host,&current)?!=self.generation{return Err(invalid());}
        }
        // No configuration lease is held while launchd starts/stops an issuer.
        let mut registration=self.registration().await?;
        if action==Action::Status{return Ok(registration);}
        if matches!(action,Action::Stop|Action::Restart|Action::Uninstall){
            if registration.loaded{
                for args in self.requests(Action::Stop){self.checked_step(&args,Duration::from_secs(130)).await?;}
                registration=self.registration().await?;
                if registration.loaded{return Err("The service manager has not confirmed shutdown".into());}
            }
            service_issuer::require_stopped_for_control(&host,&self.configuration)?;
            if action==Action::Uninstall{
                if registration.installed{
                    if self.read_owned_unit()?.is_none(){return Err(invalid());}
                    fs::remove_file(&self.unit_path).map_err(io_error)?;
                    File::open(self.unit_path.parent().ok_or_else(invalid)?).and_then(|file|file.sync_all()).map_err(io_error)?;
                }
                // Runtime, identity, history, credentials and native epoch remain.
                return self.registration().await;
            }
            if action==Action::Stop{return Ok(registration);}
        }
        if !registration.installed{
            if action!=Action::Install{return Err("Install the background service before starting it".into());}
            service_issuer::require_stopped_for_control(&host,&self.configuration)?;
            self.publish_unit()?;
            registration.installed=true;
        }
        if !registration.loaded {
            service_issuer::require_stopped_for_control(&host, &self.configuration)?;
            self.upgrade_permission_identity()?;
            service_issuer::refresh_bundled_issuer(&host, &self.configuration)?;
        }
        if registration.loaded{return Ok(registration);}
        service_issuer::require_stopped_for_control(&host,&self.configuration)?;
        let requests=self.requests(Action::Start);
        for args in &requests{self.checked_step(args,Duration::from_secs(30)).await?;}
        let result=self.registration().await;
        if result.is_err(){
            // Bootstrap succeeded from an absent slot under this retained plan.
            // Roll back only that newly created registration, never a discovered PID.
            for args in self.requests(Action::Stop){let _=self.checked_step(&args,Duration::from_secs(130)).await;}
        }
        result
    }
    pub(super) fn requests(&self, action: Action) -> Vec<Vec<String>> {
        let target = format!("{}/{}", self.domain, LABEL);
        let start = || vec![vec!["enable".into(), target.clone()],vec!["bootstrap".into(), self.domain.clone(), self.unit_path.to_string_lossy().into_owned()]];
        match action {
            Action::Status => vec![vec!["print".into(), target]],
            Action::Install | Action::Start => start(),
            Action::Stop | Action::Uninstall => vec![vec!["bootout".into(), "--wait".into(), target]],
            Action::Restart => { let mut requests = vec![vec!["bootout".into(), "--wait".into(), target.clone()]];requests.extend(start());requests },
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn plan() -> ServiceUnitPlan {
        let config = Configuration {schema:1,ownership:OwnershipMode::Service,artifact_path:PathBuf::from("/private/owner/host/runtime/versions/0.1.7/payload"),
            manifest_digest:"a".repeat(64),bootstrap_secret:"b".repeat(64),environment_id:Some("legacy-env".into()),browser:None};
        ServiceUnitPlan::build(Path::new("/private/owner"), &config, 42, Path::new("/Users/test & viewer"), 501, "/opt/homebrew/bin:/usr/bin".into()).unwrap()
    }
    fn encode(document: &UnitDocument) -> Vec<u8> {let mut bytes=Vec::new();plist::to_writer_xml(&mut bytes, document).unwrap();bytes}
    #[test]
    fn plist_preserves_original_launchd_lifecycle_and_native_owner_binding() {
        let plan = plan(); let bytes = plan.render().unwrap(); plan.recognizes(&bytes).unwrap();
        let document: UnitDocument = plist::from_bytes(&bytes).unwrap();
        let app: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(document.associated_bundle_identifiers, Some(vec![app["identifier"].as_str().unwrap().into()]));
        assert_eq!(document.working_directory, "/Users/test & viewer");
        assert_eq!(document.program_arguments[1], "__service-launcher");
        assert!(document.keep_alive && document.run_at_load); assert_eq!(document.exit_time_out,90);
        let owner: OwnerStamp = serde_json::from_str(&document.environment_variables["BLACKCRAB_NATIVE_SERVICE_OWNER"]).unwrap();
        assert_eq!(owner.generation,42);
        assert!(!String::from_utf8(bytes).unwrap().contains(&"b".repeat(64)));
        let mut changed = document.clone(); changed.environment_variables.insert("PATH".into(),"/new/installer/path:/usr/bin".into());
        assert!(plan.recognizes(&encode(&changed)).is_ok());
        for change in 0..10 {
            let mut bad = document.clone();
            let mut stamp = owner.clone();
            match change {
                0 => bad.program_arguments[0]="/foreign/program".into(),
                1 => stamp.generation+=1,
                2 => stamp.manifest_sha256="c".repeat(64),
                3 => {bad.environment_variables.insert("T3CODE_HOME".into(),"/foreign/home".into());},
                4 => {bad.environment_variables.insert("NODE_OPTIONS".into(),"--require /foreign".into());},
                5 => bad.label="com.t3tools.t3code.service".into(),
                6 => stamp.root="/foreign/root".into(),
                7 => stamp.environment_id="foreign-environment".into(),
                8 => bad.program_arguments[1]="foreign-action".into(),
                _ => bad.keep_alive=false,
            }
            bad.environment_variables.insert("BLACKCRAB_NATIVE_SERVICE_OWNER".into(),serde_json::to_string(&stamp).unwrap());
            assert!(plan.recognizes(&encode(&bad)).is_err());
        }
    }
    #[test]
    fn registered_job_binds_kernel_program_path_and_native_owner_without_pid_import() {
        let plan=plan();
        let text=format!("program = {}\npath = {}\nT3CODE_HOME => {}\nBLACKCRAB_NATIVE_SERVICE_OWNER => {}\npid = 12345\n",
            plan.document.program_arguments[0],plan.unit_path.display(),plan.document.environment_variables["T3CODE_HOME"],plan.document.environment_variables["BLACKCRAB_NATIVE_SERVICE_OWNER"]);
        assert_eq!(plan.registered_output(Some(0),text.as_bytes(),b"").unwrap(),true);
        assert!(plan.registered_output(Some(0),text.replace("program = /private/owner","program = /foreign").as_bytes(),b"").is_err());
        assert!(plan.registered_output(Some(0),format!("{text}program = /duplicate\n").as_bytes(),b"").is_err());
        assert_eq!(plan.registered_output(Some(113),b"",b"Could not find service blackcrab").unwrap(),false);
        assert!(plan.registered_output(Some(113),b"",b"Could not find domain gui/501").is_err());
        assert!(plan.registered_output(Some(1),b"",b"permission denied").is_err());
    }
    #[test]
    fn manager_requests_use_only_fixed_service_targets_without_pid_authority() {
        let plan = plan();
        assert_eq!(plan.requests(Action::Stop),vec![vec!["bootout","--wait","gui/501/com.blackcrab.desktop.managed.service"]]);
        assert_eq!(plan.requests(Action::Restart).len(),3);
        assert_eq!(plan.requests(Action::Install),plan.requests(Action::Start));
        assert_eq!(plan.requests(Action::Uninstall),plan.requests(Action::Stop));
        assert_eq!(plan.requests(Action::Status),vec![vec!["print","gui/501/com.blackcrab.desktop.managed.service"]]);
    }
    #[tokio::test]
    async fn overlapping_requests_wait_for_the_retained_control_lease(){
        let root=std::env::temp_dir().join(format!("blackcrab-control-lease-{}",random_secret().unwrap()));fs::create_dir(&root).unwrap();
        let first=control_lease(&root).await.unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(100),control_lease(&root)).await.is_err());
        drop(first);let second=control_lease(&root).await.unwrap();drop(second);
        fs::remove_file(root.join("service-control.lock")).unwrap();fs::remove_dir(root).unwrap();
    }
    #[test]
    fn unit_publication_never_overwrites_a_foreign_unit_or_workspace_data() {
        let mut plan=plan();let root=std::env::temp_dir().join(format!("blackcrab-unit-publish-{}",random_secret().unwrap()));
        fs::create_dir(&root).unwrap();plan.document.working_directory=root.to_str().unwrap().into();
        plan.unit_path=root.join("Library/LaunchAgents").join(format!("{LABEL}.plist"));
        let history=root.join("history");write_new(&history,b"retained workspace history").unwrap();
        plan.publish_unit().unwrap();let original=fs::read(&plan.unit_path).unwrap();
        plan.publish_unit().unwrap();assert_eq!(fs::read(&plan.unit_path).unwrap(),original);
        let mut foreign=plan.document.clone();foreign.program_arguments[0]="/foreign/runtime".into();
        let foreign=encode(&foreign);fs::write(&plan.unit_path,&foreign).unwrap();
        assert!(plan.publish_unit().is_err());assert_eq!(fs::read(&plan.unit_path).unwrap(),foreign);
        assert_eq!(fs::read(&history).unwrap(),b"retained workspace history");
        fs::remove_file(&plan.unit_path).unwrap();fs::remove_file(history).unwrap();
        fs::remove_dir(root.join("Library/LaunchAgents")).unwrap();fs::remove_dir(root.join("Library")).unwrap();fs::remove_dir(root).unwrap();
    }
    #[test]
    fn legacy_permission_identity_upgrade_preserves_installed_path_and_owner() {
        let plan = plan();
        let mut legacy = plan.document.clone();
        legacy.associated_bundle_identifiers = None;
        legacy.environment_variables.insert("PATH".into(), "/existing/custom/bin:/usr/bin".into());
        let before = encode(&legacy);
        plan.recognizes(&before).unwrap();
        let after = plan.permission_identity_upgrade(&before).unwrap().unwrap();
        let mut expected = legacy.clone();
        expected.associated_bundle_identifiers = Some(vec![RESPONSIBLE_BUNDLE.into()]);
        assert!(plist::from_bytes::<UnitDocument>(&after).unwrap() == expected);
        assert!(plan.permission_identity_upgrade(&after).unwrap().is_none());
        for association in [vec![], vec!["com.t3tools.t3code".into()], vec![RESPONSIBLE_BUNDLE.into(), "foreign.app".into()]] {
            legacy.associated_bundle_identifiers = Some(association);
            assert!(plan.permission_identity_upgrade(&encode(&legacy)).is_err());
        }
        legacy.associated_bundle_identifiers = None;
        legacy.program_arguments[0] = "/foreign/runtime".into();
        assert!(plan.permission_identity_upgrade(&encode(&legacy)).is_err());
    }
    #[test]
    fn permission_identity_upgrade_changes_only_the_owned_unit_and_keeps_private_mode() {
        let mut plan = plan();
        let root = std::env::temp_dir().join(format!("blackcrab-unit-identity-{}", random_secret().unwrap()));
        fs::create_dir(&root).unwrap();
        plan.document.working_directory = root.to_str().unwrap().into();
        plan.unit_path = root.join("Library/LaunchAgents").join(format!("{LABEL}.plist"));
        let history = root.join("history");
        write_new(&history, b"retained workspace history").unwrap();
        plan.publish_unit().unwrap();
        let mut legacy = plan.document.clone();
        legacy.associated_bundle_identifiers = None;
        legacy.environment_variables.insert("PATH".into(), "/custom/provider/bin:/usr/bin".into());
        fs::write(&plan.unit_path, encode(&legacy)).unwrap();
        assert!(plan.needs_permission_identity_upgrade().unwrap());
        plan.upgrade_permission_identity().unwrap();
        assert!(!plan.needs_permission_identity_upgrade().unwrap());
        let updated = fs::read(&plan.unit_path).unwrap();
        let document: UnitDocument = plist::from_bytes(&updated).unwrap();
        assert_eq!(document.environment_variables, legacy.environment_variables);
        assert_eq!(document.program_arguments, legacy.program_arguments);
        assert_eq!(fs::metadata(&plan.unit_path).unwrap().mode() & 0o777, 0o600);
        plan.upgrade_permission_identity().unwrap();
        assert_eq!(fs::read(&plan.unit_path).unwrap(), updated);
        assert_eq!(fs::read(&history).unwrap(), b"retained workspace history");
        legacy.label = "foreign.service".into();
        let foreign = encode(&legacy);
        fs::write(&plan.unit_path, &foreign).unwrap();
        assert!(plan.upgrade_permission_identity().is_err());
        assert_eq!(fs::read(&plan.unit_path).unwrap(), foreign);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unit_file_rejects_links_loose_modes_and_changed_owner_records() {
        let mut plan=plan();let root=std::env::temp_dir().join(format!("blackcrab-unit-policy-{}",random_secret().unwrap()));
        fs::create_dir(&root).unwrap();fs::create_dir(root.join("Library")).unwrap();fs::create_dir(root.join("Library/LaunchAgents")).unwrap();
        plan.document.working_directory=root.to_str().unwrap().into();plan.unit_path=root.join("Library/LaunchAgents/unit.plist");
        assert!(plan.read_owned_unit().unwrap().is_none());write_new(&plan.unit_path,&plan.render().unwrap()).unwrap();
        assert!(plan.read_owned_unit().unwrap().is_some());fs::set_permissions(&plan.unit_path,fs::Permissions::from_mode(0o644)).unwrap();
        assert!(plan.read_owned_unit().is_err());fs::set_permissions(&plan.unit_path,fs::Permissions::from_mode(0o600)).unwrap();
        let alias=root.join("alias");fs::hard_link(&plan.unit_path,&alias).unwrap();assert!(plan.read_owned_unit().is_err());fs::remove_file(alias).unwrap();
        fs::remove_file(&plan.unit_path).unwrap();std::os::unix::fs::symlink("foreign",&plan.unit_path).unwrap();assert!(plan.read_owned_unit().is_err());
        fs::remove_file(&plan.unit_path).unwrap();fs::remove_dir(root.join("Library/LaunchAgents")).unwrap();fs::remove_dir(root.join("Library")).unwrap();fs::remove_dir(root).unwrap();
    }
}

pub(super) async fn control(host:&ManagedHost,action:Action)->Result<super::ServiceStatus,String>{
    {
        let _operation=host.operation.lock().await;
        host.prepare()?;let _lease=host.lease().await?;host.initialize_locked()?;
        match host.read_config()?{
            None=>{
                if action!=Action::Status{return Err("Set up the background service first".into());}
                let profile=option_env!("BLACKCRAB_EMBEDDED_HOST_SERVICE_PROFILE")==Some("blackcrab-local-service-layout-v1");
                let expected=option_env!("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256");
                let bundled=expected.is_some()&&host.bundled_payload.as_ref().is_some_and(|payload|payload.expected_host_manifest_sha256()==expected);
                let available=profile&&bundled;
                let fresh=super::service_initialization::fresh_owner(host).is_ok();
                return Ok(super::ServiceStatus{state:if available{"notConfigured"}else{"notAvailable"},can_initialize:available&&fresh,installed:false,loaded:false,permission_identity_restart_required:false,error:None});
            }
            Some(config) if config.ownership==OwnershipMode::Direct=>{
                if action!=Action::Status{return Err("This workspace uses direct startup; background-service setup cannot replace it".into());}
                return Ok(super::ServiceStatus{state:"direct",can_initialize:false,installed:false,loaded:false,permission_identity_restart_required:false,error:None});
            }
            Some(_)=>{}
        }
    }
    let plan=ServiceUnitPlan::from_host(host).await?;
    let registration=plan.apply(action).await?;
    let (state,error)=if !registration.installed{("notInstalled",None)}else if !registration.loaded{("stopped",None)}else{
        let _operation=host.operation.lock().await;
        match host.probe(&plan.configuration).await{
            Ok(Probe::Attached(_))=>("running",None),Ok(Probe::Stopped)=>("starting",None),Err(error)=>("unavailable",Some(error)),
        }
    };
    let permission_identity_restart_required = registration.loaded && plan.needs_permission_identity_upgrade()?;
    Ok(super::ServiceStatus{state,can_initialize:false,installed:registration.installed,loaded:registration.loaded,permission_identity_restart_required,error})
}
