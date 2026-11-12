//! Passive, bounded diagnostics for the opt-in captured Native test only.
#[path = "managed_native_sampling.rs"]
mod sampling;
use super::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::Message;

// Exact production namespace: ManagedBootstrap sets appData=root/app-data;
// resolveUserDataPath selects the descriptor's blackcrab-managed-v1 namespace.
fn original_port_path(profile: &Path) -> PathBuf {
    profile.join("app-data/blackcrab-managed-v1/DevToolsActivePort")
}
fn private_ancestors(path: &Path) -> Result<bool, ()> {
    for ancestor in path.ancestors() {
        if ancestor.file_name().is_some_and(|name| name == "Root-QA") {
            return Ok(true);
        }
        let metadata = match fs::symlink_metadata(ancestor) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(()),
        };
        if !metadata.is_dir()
            || metadata.uid() != unsafe { libc::getuid() }
            || metadata.mode() & 0o777 != 0o700
            || ancestor.canonicalize().map_err(|_| ())? != ancestor
        {
            return Err(());
        }
    }
    Err(())
}
fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn permitted(method: &str) -> bool {
    matches!(
        method,
        "Runtime.enable"
            | "Log.enable"
            | "Network.enable"
            | "Page.enable"
            | "Page.setLifecycleEventsEnabled"
            | "Page.getResourceTree"
            | "DOM.getDocument"
    )
}
fn tag_counts(value: &Value, counts: &mut std::collections::BTreeMap<String, u64>) {
    if let Some(name) = value.get("nodeName").and_then(Value::as_str) {
        // Only HTML tag vocabulary; custom-element names are hashed.
        let tag = match name {
            "HTML" | "HEAD" | "BODY" | "SCRIPT" | "LINK" | "DIV" | "MAIN" | "SECTION"
            | "BUTTON" | "INPUT" | "SPAN" | "P" | "STYLE" | "META" | "TITLE" | "#document"
            | "#text" | "#comment" => name.to_owned(),
            _ => format!("sha256:{}", digest(name)),
        };
        *counts.entry(tag).or_default() += 1;
    }
    if let Some(children) = value.get("children").and_then(Value::as_array) {
        for child in children {
            tag_counts(child, counts);
        }
    }
}
const SNAPSHOT_SECONDS: [u64; 3] = [10, 30, 50];
fn mime_category(mime: &str) -> &'static str {
    match mime {
        "text/css" => "css",
        "text/javascript" | "application/javascript" | "application/x-javascript" => "javascript",
        "text/html" => "html",
        _ => "other",
    }
}
fn lifecycle_category(name: &str) -> &'static str {
    match name {
        "init" => "init",
        "DOMContentLoaded" => "dom-content-loaded",
        "load" => "load",
        "networkAlmostIdle" => "network-almost-idle",
        "networkIdle" => "network-idle",
        _ => "other",
    }
}
fn sanitized(value: &Value) -> Value {
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("response");
    let p = &value["params"];
    match method {
        "Runtime.exceptionThrown" => {
            let e = &p["exceptionDetails"];
            json!({"kind":"exception","messageHash":digest(e["text"].as_str().unwrap_or("")),"line":e["lineNumber"].as_u64(),"column":e["columnNumber"].as_u64(),"sourceHash":digest(e["url"].as_str().unwrap_or(""))})
        }
        "Runtime.consoleAPICalled" => {
            json!({"kind":"console","error":p["type"]=="error","warning":p["type"]=="warning","argumentCount":p["args"].as_array().map(Vec::len)})
        }
        "Log.entryAdded" => {
            json!({"kind":"log","error":p["entry"]["level"]=="error","messageHash":digest(p["entry"]["text"].as_str().unwrap_or("")),"sourceHash":digest(p["entry"]["url"].as_str().unwrap_or(""))})
        }
        "Network.loadingFailed" => {
            json!({"kind":"resource-failed","requestHash":digest(p["requestId"].as_str().unwrap_or("")),"messageHash":digest(p["errorText"].as_str().unwrap_or("")),"cancelled":p["canceled"].as_bool()})
        }
        "Network.responseReceived" => {
            json!({"kind":"resource-response","requestHash":digest(p["requestId"].as_str().unwrap_or("")),"mime":mime_category(p["response"]["mimeType"].as_str().unwrap_or("")),"status":p["response"]["status"].as_u64(),"sourceHash":digest(p["response"]["url"].as_str().unwrap_or(""))})
        }
        "Network.loadingFinished" => {
            json!({"kind":"resource-finished","requestHash":digest(p["requestId"].as_str().unwrap_or("")),"encodedBytes":p["encodedDataLength"].as_u64()})
        }
        "Page.lifecycleEvent" => {
            json!({"kind":"page-lifecycle","phase":lifecycle_category(p["name"].as_str().unwrap_or(""))})
        }
        "Page.domContentEventFired" => {
            json!({"kind":"page-lifecycle","phase":"dom-content-loaded"})
        }
        "Page.loadEventFired" => json!({"kind":"page-lifecycle","phase":"load"}),
        "Inspector.detached" | "Inspector.targetCrashed" => {
            json!({"kind":"renderer-detached-or-crashed"})
        }
        "response" => {
            let mut tags = std::collections::BTreeMap::new();
            if let Some(root) = value.pointer("/result/root") {
                tag_counts(root, &mut tags);
            }
            let resources = value
                .pointer("/result/frameTree/resources")
                .and_then(Value::as_array)
                .map(Vec::len);
            json!({"kind":"response","id":value["id"].as_u64(),"error":value.get("error").is_some(),"domTagCounts":tags,"resourceCount":resources})
        }
        _ => json!({"kind":"ignored"}),
    }
}
fn write_event(file: &mut fs::File, event: Value) -> Result<(), ()> {
    writeln!(file, "{event}").map_err(|_| ())
}

#[derive(Debug, PartialEq, Eq)]
enum ObserverStatus {
    Completed,
    Failed,
    Panicked,
    Cancelled,
    TimedOut,
}
fn joined_status(result: Result<Result<(), ()>, tokio::task::JoinError>) -> ObserverStatus {
    match result {
        Ok(Ok(())) => ObserverStatus::Completed,
        Ok(Err(())) => ObserverStatus::Failed,
        Err(error) if error.is_panic() => ObserverStatus::Panicked,
        Err(_) => ObserverStatus::Cancelled,
    }
}
fn record_status(profile: &Path, status: ObserverStatus) {
    let result = (|| -> Result<(), ()> {
        let mut file = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .open(profile.join("passive-renderer-status.jsonl"))
            .map_err(|_| ())?;
        let metadata = file.metadata().map_err(|_| ())?;
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::getuid() }
            || metadata.nlink() != 1
            || metadata.mode() & 0o777 != 0o600
        {
            return Err(());
        }
        write_event(&mut file, json!({"status":format!("{status:?}")}))
    })();
    let _ = result;
}
pub(super) fn start(child: Arc<Mutex<Child>>, identity: Identity, profile: PathBuf) {
    tokio::spawn(async move {
        // Retain the actual observer JoinHandle. A panic is diagnostic failure,
        // never evidence that Chromium discovery or the product stalled.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        let mut task = tokio::spawn(collect(child, identity, profile.clone(), deadline));
        let status = match tokio::time::timeout_at(deadline, &mut task).await {
            Ok(result) => joined_status(result),
            Err(_) => {
                task.abort();
                let _ = task.await;
                ObserverStatus::TimedOut
            }
        };
        record_status(&profile, status);
    });
}

async fn collect(
    child: Arc<Mutex<Child>>,
    identity: Identity,
    profile: PathBuf,
    deadline: tokio::time::Instant,
) -> Result<(), ()> {
    let output = profile.join("passive-renderer-diagnostics.jsonl");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(output)
        .map_err(|_| ())?;
    let mut active_port = None;
    while active_port.is_none() {
        if !identity.current()
            || child
                .lock()
                .map_err(|_| ())?
                .try_wait()
                .map_err(|_| ())?
                .is_some()
        {
            return Err(());
        }
        // userData is selected by the original verified production bootstrap.
        let path = original_port_path(&profile);
        if !private_ancestors(path.parent().ok_or(())?)? {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if !meta.is_file()
                || meta.uid() != unsafe { libc::getuid() }
                || meta.nlink() != 1
                || meta.len() > 4096
            {
                return Err(());
            }
            let bytes = fs::read(&path).map_err(|_| ())?;
            let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
            active_port = text
                .lines()
                .next()
                .and_then(|line| line.parse::<u16>().ok())
                .filter(|p| *p > 0);
        }
        if active_port.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    let port = active_port.ok_or(())?;
    let sample = std::process::Command::new("/usr/sbin/lsof")
        .args([
            "-nP",
            "-a",
            "-p",
            &identity.pid.to_string(),
            "-iTCP",
            "-sTCP:LISTEN",
            "-Fn",
        ])
        .output()
        .map_err(|_| ())?;
    let lines = std::str::from_utf8(&sample.stdout).map_err(|_| ())?;
    if !sample.status.success()
        || !lines
            .lines()
            .any(|line| line == format!("n127.0.0.1:{port}"))
        || !identity.current()
    {
        return Err(());
    }
    write_event(
        &mut file,
        json!({"kind":"captured-loopback-listener-verified"}),
    )?;
    let client = http_client().map_err(|_| ())?;
    let mut connected = None;
    while connected.is_none() {
        if !identity.current() {
            return Err(());
        }
        let mut response = client
            .get(format!("http://127.0.0.1:{port}/json/list"))
            .send()
            .await
            .map_err(|_| ())?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
            if bytes.len() + chunk.len() > 262144 {
                return Err(());
            }
            bytes.extend_from_slice(&chunk);
        }
        let targets: Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
        for target in targets.as_array().ok_or(())? {
            if target["type"] != "page"
                || !target["url"]
                    .as_str()
                    .is_some_and(|u| u == "blackcrab://app" || u.starts_with("blackcrab://app/"))
            {
                continue;
            }
            let url = url::Url::parse(target["webSocketDebuggerUrl"].as_str().ok_or(())?)
                .map_err(|_| ())?;
            if url.scheme() != "ws"
                || url.host_str() != Some("127.0.0.1")
                || url.port() != Some(port)
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err(());
            }
            connected = Some(
                tokio_tungstenite::connect_async(url.as_str())
                    .await
                    .map_err(|_| ())?
                    .0,
            );
            break;
        }
        if connected.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    let mut socket = connected.ok_or(())?;
    write_event(&mut file, json!({"kind":"original-main-page-observed"}))?;
    let methods = [
        "Runtime.enable",
        "Log.enable",
        "Network.enable",
        "Page.enable",
        "Page.getResourceTree",
        "DOM.getDocument",
        "Page.setLifecycleEventsEnabled",
    ];
    for (index, method) in methods.iter().enumerate() {
        if !permitted(method) {
            return Err(());
        }
        let params = if *method == "DOM.getDocument" {
            json!({"depth":-1,"pierce":false})
        } else if *method == "Page.setLifecycleEventsEnabled" {
            json!({"enabled":true})
        } else {
            json!({})
        };
        socket
            .send(Message::Text(
                json!({"id":index+1,"method":method,"params":params})
                    .to_string()
                    .into(),
            ))
            .await
            .map_err(|_| ())?;
    }
    let mut count = 0;
    let observed_at = tokio::time::Instant::now();
    let mut snapshot = 0;
    let mut responses = std::collections::HashSet::<u64>::new();
    let mut sampling_decided = false;
    loop {
        if !identity.current() {
            return Err(());
        }
        let next = SNAPSHOT_SECONDS
            .get(snapshot)
            .map(|seconds| observed_at + Duration::from_secs(*seconds));
        let delayed = async {
            match next {
                Some(deadline) => tokio::time::sleep_until(deadline).await,
                None => std::future::pending::<()>().await,
            }
        };
        let sample_decided = sampling_decided;
        let sample_at = async move {
            if sample_decided {
                std::future::pending::<()>().await
            } else {
                tokio::time::sleep_until(observed_at + Duration::from_secs(15)).await
            }
        };
        tokio::select! {
            _ = sample_at => {
                let eligible=sampling::due(observed_at.elapsed(),snapshot>0,&responses,sampling_decided);
                sampling_decided=true;
                if eligible {
                    write_event(&mut file,json!({"kind":"thread-sample","status":"Started"}))?;
                    let status=sampling::run(child.clone(),identity.clone(),profile.clone(),deadline.saturating_duration_since(tokio::time::Instant::now())).await;
                    write_event(&mut file,json!({"kind":"thread-sample","status":format!("{status:?}")}))?;
                } else {write_event(&mut file,json!({"kind":"thread-sample","status":"SkippedResponsiveOrNotRequested"}))?;}
            },
            _ = delayed => {
                write_event(&mut file,json!({"kind":"scheduled-snapshot","seconds":SNAPSHOT_SECONDS[snapshot]}))?;
                for (offset,method) in ["Page.getResourceTree","DOM.getDocument"].iter().enumerate() {
                    if !permitted(method) {return Err(());}
                    let params=if *method=="DOM.getDocument" {json!({"depth":-1,"pierce":false})}else{json!({})};
                    socket.send(Message::Text(json!({"id":100+snapshot*2+offset,"method":method,"params":params}).to_string().into())).await.map_err(|_| ())?;
                }
                snapshot+=1;
            },
            message = socket.next() => {
                let Some(message)=message else {return Ok(());};
                if let Message::Text(text)=message.map_err(|_| ())? {
                    if text.len()>4*1024*1024 {return Err(());}
                    let value:Value=serde_json::from_str(&text).map_err(|_| ())?;
                    if let Some(id)=value["id"].as_u64(){responses.insert(id);}
                    let mut event=sanitized(&value);
                    if event["kind"]!="ignored" {
                        event["elapsedMs"]=json!(observed_at.elapsed().as_millis());
                        write_event(&mut file,event)?;count+=1;
                    }
                    if count>=2048{return Ok(());}
                }
            }
        }
    }
}
#[test]
fn passive_diagnostics_refuse_control_and_never_persist_payload_text() {
    for method in [
        "Runtime.evaluate",
        "Runtime.callFunctionOn",
        "Page.navigate",
        "Target.createTarget",
        "Input.dispatchMouseEvent",
    ] {
        assert!(!permitted(method));
    }
    for method in [
        "Runtime.enable",
        "Log.enable",
        "Network.enable",
        "Page.enable",
        "Page.setLifecycleEventsEnabled",
        "Page.getResourceTree",
        "DOM.getDocument",
    ] {
        assert!(permitted(method));
    }
    let secret = "private-grant-and-user-text";
    for v in [
        json!({"method":"Runtime.consoleAPICalled","params":{"args":[{"value":secret}]}}),
        json!({"method":"Runtime.exceptionThrown","params":{"exceptionDetails":{"text":secret,"url":secret}}}),
        json!({"id":1,"result":{"root":{"nodeName":"DIV","attributes":[secret],"nodeValue":secret,"children":[{"nodeName":secret}]}}}),
    ] {
        let s = sanitized(&v).to_string();
        assert!(!s.contains(secret));
        assert!(!s.contains("attributes"));
        assert!(!s.contains("nodeValue"));
    }
}

#[test]
fn passive_port_path_matches_original_bootstrap_namespace_and_refuses_aliases() {
    let profile = Path::new("/private/tmp/owned/Root-QA/fixture/profile");
    assert_eq!(
        original_port_path(profile),
        profile.join("app-data/blackcrab-managed-v1/DevToolsActivePort")
    );
    assert!(!original_port_path(profile).starts_with(profile.join("userdata")));
    let bootstrap = include_str!("../../managed-desktop/runtime/ManagedBootstrap.mjs");
    let descriptor = include_str!("../../managed-desktop/descriptor.mjs");
    assert!(bootstrap.contains("setPath('appData',path.join(root,'app-data'))"));
    assert!(descriptor.contains("profile: 'blackcrab-managed-v1'"));
    let temporary = std::env::temp_dir().join(format!(
        "blackcrab-passive-path-test-{}",
        std::process::id()
    ));
    fs::create_dir(&temporary).unwrap();
    fs::set_permissions(
        &temporary,
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )
    .unwrap();
    // Exercise the permission rejection even when TMPDIR is inside owned Root-QA.
    let non_private_parent = temporary.join("non-private-parent");
    fs::create_dir(&non_private_parent).unwrap();
    fs::set_permissions(
        &non_private_parent,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let private_leaf = non_private_parent.join("private-leaf");
    fs::create_dir(&private_leaf).unwrap();
    fs::set_permissions(
        &private_leaf,
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )
    .unwrap();
    assert!(private_ancestors(&private_leaf).is_err());
    let alias = temporary.join("alias");
    std::os::unix::fs::symlink(&private_leaf, &alias).unwrap();
    assert!(private_ancestors(&alias).is_err());
    fs::remove_file(alias).unwrap();
    fs::remove_dir(private_leaf).unwrap();
    fs::remove_dir(non_private_parent).unwrap();
    fs::remove_dir(temporary).unwrap();
}

#[tokio::test]
async fn passive_http_uses_explicit_tls_without_process_default_provider() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    assert!(rustls::crypto::CryptoProvider::get_default().is_none());
    let client = http_client().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0u8; 4096];
        let count = socket.read(&mut request).await.unwrap();
        assert!(request[..count].starts_with(b"GET /json/list HTTP/1.1\r\n"));
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]")
            .await
            .unwrap();
    });
    let response = tokio::time::timeout(
        Duration::from_secs(3),
        client.get(format!("http://{address}/json/list")).send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"[]");
    server.await.unwrap();
    assert!(rustls::crypto::CryptoProvider::get_default().is_none());
}
#[tokio::test]
async fn passive_observer_status_distinguishes_panic_failure_and_success() {
    assert_eq!(
        joined_status(tokio::spawn(async { Ok(()) }).await),
        ObserverStatus::Completed
    );
    assert_eq!(
        joined_status(tokio::spawn(async { Err(()) }).await),
        ObserverStatus::Failed
    );
    let panicked = tokio::spawn(async {
        panic!("private diagnostic test panic");
        #[allow(unreachable_code)]
        Ok(())
    })
    .await;
    assert_eq!(joined_status(panicked), ObserverStatus::Panicked);
    let task = tokio::spawn(std::future::pending::<Result<(), ()>>());
    task.abort();
    assert_eq!(joined_status(task.await), ObserverStatus::Cancelled);
}

#[test]
fn passive_completion_schedule_and_metadata_are_bounded_and_nonsecret() {
    assert_eq!(SNAPSHOT_SECONDS, [10, 30, 50]);
    assert!(SNAPSHOT_SECONDS.iter().all(|s| *s < 60));
    let secret = "private-request-url-header-mime-lifecycle";
    let response = sanitized(
        &json!({"method":"Network.responseReceived","params":{"requestId":secret,"response":{"url":secret,"headers":{"secret":secret},"mimeType":secret,"status":200}}}),
    );
    let finished = sanitized(
        &json!({"method":"Network.loadingFinished","params":{"requestId":secret,"encodedDataLength":123}}),
    );
    assert_eq!(response["requestHash"], finished["requestHash"]);
    assert_eq!(response["mime"], "other");
    assert!(!response.to_string().contains(secret));
    assert!(!finished.to_string().contains(secret));
    assert_eq!(mime_category("text/css"), "css");
    assert_eq!(mime_category("application/javascript"), "javascript");
    assert_eq!(
        sanitized(&json!({"method":"Page.lifecycleEvent","params":{"name":secret}}))["phase"],
        "other"
    );
    assert!(permitted("Page.setLifecycleEventsEnabled"));
    assert!(!permitted("Page.navigate"));
}
