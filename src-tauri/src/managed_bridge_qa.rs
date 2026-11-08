//! Explicitly opt-in, disposable-app WKWebView boundary test. Never compiled in production.
//! Tests cross-origin frames; an opaque sandbox retaining a same URL is a separate
//! WebKit security-origin question and is not certified by this fixture.
use crate::managed_host::ManagedHost;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
static ORIGINS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
static CAPTURED_HOST: Mutex<Option<Value>> = Mutex::new(None);
pub(crate) fn record_captured_host(pid: u32, data_root: &std::path::Path) {
    if let Ok(mut captured) = CAPTURED_HOST.lock() {
        *captured = Some(json!({"pid":pid,"dataRoot":data_root.to_string_lossy()}));
    }
}
pub(crate) fn allows_navigation(url: &url::Url) -> bool {
    ORIGINS
        .get()
        .and_then(|origins| origins.lock().ok())
        .is_some_and(|origins| origins.contains(&url.origin().ascii_serialization()))
}
struct Fixture {
    origin: String,
    reports: Arc<Mutex<Vec<Value>>>,
    stop: Arc<std::sync::atomic::AtomicBool>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}
fn fixture(nonce: &str) -> Result<Fixture, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let origin = format!(
        "http://127.0.0.1:{}",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let reports = Arc::new(Mutex::new(Vec::new()));
    let received = reports.clone();
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopped = stop.clone();
    let report_path = format!("/report/{nonce}");
    std::thread::spawn(move || {
        while !stopped.load(std::sync::atomic::Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = serve(&mut stream, &report_path, &received);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                Err(_) => break,
            }
        }
    });
    Ok(Fixture {
        origin,
        reports,
        stop,
    })
}
fn serve(
    stream: &mut TcpStream,
    report_path: &str,
    reports: &Mutex<Vec<Value>>,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 4096];
    let (header_end, length) = loop {
        let n = stream.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 || bytes.len() + n > 131072 {
            return Err("Invalid fixture request".into());
        }
        bytes.extend_from_slice(&buffer[..n]);
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]);
            let length = headers
                .lines()
                .find_map(|s| {
                    s.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|s| s.trim().parse::<usize>())
                })
                .transpose()
                .map_err(|_| "Invalid fixture length")?
                .unwrap_or(0);
            if length > 65536 {
                return Err("Oversized fixture report".into());
            }
            break (end + 4, length);
        }
    };
    while bytes.len() < header_end + length {
        let n = stream.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Incomplete fixture report".into());
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
    let head = String::from_utf8_lossy(&bytes[..header_end]);
    let first = head.lines().next().unwrap_or("");
    let (status, mime, body) = if first.starts_with("OPTIONS ") {
        ("204 No Content", "text/plain", String::new())
    } else if first.starts_with(&format!("POST {report_path} ")) {
        let report: Value = serde_json::from_slice(&bytes[header_end..header_end + length])
            .map_err(|_| "Invalid fixture JSON")?;
        let mut received = reports.lock().map_err(|_| "Fixture report unavailable")?;
        if received.len() >= 4 {
            return Err("Too many fixture reports".into());
        }
        received.push(report);
        ("200 OK", "application/json", "{}".into())
    } else if first.starts_with("GET /frame ") {
        ("200 OK", "text/html", FRAME.into())
    } else {
        ("404 Not Found", "text/plain", "missing".into())
    };
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n{body}",body.len()).map_err(|e| e.to_string())
}
const FRAME: &str = r#"<!doctype html><title>Blackcrab owned IPC adversarial fixture</title><script>
window.addEventListener('message', async event => {
  if (event.source !== parent || !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)) return;
  const p = event.data;
  if (p?.kind !== 'blackcrab-qa-start') return;
  const reply = value => parent.postMessage({kind:'blackcrab-qa-result',id:p.id,...value}, event.origin);
  if (p.mode === 'postMessage') {
    try { window.webkit.messageHandlers.ipc.postMessage(JSON.stringify({cmd:p.command,callback:p.callback,error:p.error,payload:p.payload,__TAURI_INVOKE_KEY__:p.key})); }
    catch (error) { reply({transportFailure:String(error)}); }
  } else {
    try {
      const response = await fetch('ipc://localhost/'+p.command, {method:'POST',headers:{'Content-Type':'application/json','Tauri-Callback':String(p.callback),'Tauri-Error':String(p.error),'Tauri-Invoke-Key':p.key},body:JSON.stringify(p.payload)});
      reply({response:await response.text(),responseKind:response.headers.get('Tauri-Response')});
    } catch(error) { reply({transportFailure:String(error)}); }
  }
});
parent.postMessage({kind:'blackcrab-qa-ready'}, '*');
</script>"#;

pub(crate) fn start(app: AppHandle) -> Result<(), String> {
    if !app
        .config()
        .identifier
        .starts_with("com.bonjenn.blackcrab.qa")
    {
        return Err("QA requires a disposable QA app identifier".into());
    }
    let artifact = PathBuf::from(
        std::env::var_os("BLACKCRAB_MANAGED_BRIDGE_QA_ARTIFACT").ok_or("Missing QA artifact")?,
    );
    let report = PathBuf::from(
        std::env::var_os("BLACKCRAB_MANAGED_BRIDGE_QA_REPORT").ok_or("Missing QA report path")?,
    );
    if !artifact.is_absolute() || !report.is_absolute() {
        return Err("QA paths must be absolute".into());
    }
    let mut random = [0u8; 32];
    getrandom::getrandom(&mut random).map_err(|_| "QA entropy unavailable")?;
    let nonce: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let first = fixture(&nonce)?;
    let second = fixture(&nonce)?;
    ORIGINS
        .set(Mutex::new(vec![
            first.origin.clone(),
            second.origin.clone(),
        ]))
        .map_err(|_| "QA already initialized")?;
    tauri::async_runtime::spawn(async move {
        let artifact_path = artifact.to_string_lossy().into_owned();
        let result = run(&app, artifact, &nonce, &first, &second).await;
        let mut output = match result {
            Ok(report) => report,
            Err(error) => json!({"passed":false,"error":error}),
        };
        output["capturedHost"] = CAPTURED_HOST
            .lock()
            .ok()
            .and_then(|captured| captured.clone())
            .unwrap_or(Value::Null);
        output["artifactPath"] = json!(artifact_path);
        let passed = output["passed"] == true;
        let keep_open =
            passed && std::env::var("BLACKCRAB_MANAGED_BRIDGE_QA_KEEP_OPEN").as_deref() == Ok("1");
        output["keptOpen"] = json!(keep_open);
        if let Some(parent) = report.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let written = std::fs::write(report, serde_json::to_vec_pretty(&output).unwrap()).is_ok();
        drop(first);
        drop(second);
        if !keep_open || !written {
            app.exit(if passed && written { 0 } else { 1 });
        }
    });
    Ok(())
}
async fn run(
    app: &AppHandle,
    artifact: PathBuf,
    nonce: &str,
    first: &Fixture,
    second: &Fixture,
) -> Result<Value, String> {
    let host = app.state::<ManagedHost>();
    host.start(Some(artifact)).await?;
    let main = app
        .get_webview_window("main")
        .ok_or("Missing QA main window")?;
    crate::managed_workspace_open(main.clone(), app.clone(), host.clone()).await?;
    let grant = host.bridge_grant()?;
    // Reproduce an origin that had authority only in a retired native window.
    // The current window must reject it even with valid QA-supplied invoke keys.
    let stale_grant = crate::managed_bridge::Grant::new(
        &url::Url::parse(&second.origin).map_err(|_| "Invalid QA origin")?,
        grant.environment_id.clone(),
    )?;
    crate::managed_bridge::install_capability(app, &stale_grant)?;
    let managed = app
        .get_webview_window(&grant.window_label())
        .ok_or("Missing QA managed window")?;
    let report_url = format!("{}/report/{nonce}", first.origin);
    let encoded = json!({"reportUrl":report_url,"origins":[first.origin,second.origin],"key":app.invoke_key(),"grant":grant}).to_string();
    let deadline = Instant::now() + Duration::from_secs(150);
    // eval waits for native initialization and actual authenticated page readiness.
    let main_script = format!(
        r#"(() => {{ if(window.__blackcrabQaMain) return; if(!window.__TAURI_INTERNALS__?.invoke)return; window.__blackcrabQaMain=true; const q={encoded}; window.__TAURI_INTERNALS__.invoke('default_cwd').then(value => fetch(q.reportUrl,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{kind:'main',passed:typeof value==='string',command:'default_cwd'}})}})).catch(error=>fetch(q.reportUrl,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{kind:'main',passed:false,error:String(error)}})}})); }})();"#
    );
    let managed_script = format!("const __blackcrabQaConfig = {encoded};\n{MANAGED}");
    loop {
        main.eval(&main_script)
            .map_err(|_| "Could not evaluate main QA fixture")?;
        // An IIFE avoids redeclaring config on repeated probes.
        managed
            .eval(format!("(() => {{ {managed_script} }})()"))
            .map_err(|_| "Could not evaluate managed QA fixture")?;
        let reports = first
            .reports
            .lock()
            .map_err(|_| "QA report unavailable")?
            .clone();
        if reports.len() >= 2 {
            let passed = reports
                .iter()
                .any(|r| r["kind"] == "main" && r["passed"] == true)
                && reports
                    .iter()
                    .any(|r| r["kind"] == "managed" && r["passed"] == true);
            return Ok(
                json!({"passed":passed,"reports":reports,"staleCapabilityOrigin":second.origin,"staleCapabilityWindow":stale_grant.window_label(),"limitations":["Cross-origin frames tested; opaque sandbox same-URL security origins are not certified.","No OS opener, folder dialog or provider calls are made by this IPC boundary fixture."]}),
            );
        }
        if Instant::now() > deadline {
            return Err(
                "QA timed out: missing reports are failures, never accepted as denial".into(),
            );
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}
const MANAGED: &str = r#"
if (window.__blackcrabQaManaged || !window.blackcrabNative || !document.body || location.hash.includes('token=')) return;
window.__blackcrabQaManaged = true;
(async () => {
 const q=__blackcrabQaConfig, results=[];
 const bounded = p => Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QA_TIMEOUT')),10000))]);
 const deny = value => /not allowed (?:on (?:window|origin)|by ACL)|explicitly denied on origin/i.test(String(value)) && !/QA_TIMEOUT/.test(String(value));
 const rejected = async (id,fn,check) => {try {const value=await bounded(fn());results.push({id,passed:false,error:'Unexpected success',value});}catch(error){results.push({id,passed:check(String(error)),error:String(error)});}};
 await rejected('managed-positive-validator',()=>window.blackcrabNative.openExternal('file:///tmp/blackcrab-qa-never-open'), e=>e.includes('External URL must use HTTP or HTTPS'));
 await rejected('managed-favicon-local-target-validator',()=>window.blackcrabNative.pickProjectFavicon({targetEnvironmentId:'env_remote'}),e=>e.includes('Folder selection requires the local managed environment'));
 for(const [cmd,args] of [['list_sessions',{}],['read_text_file',{path:'/tmp/blackcrab-qa-never-read'}],['plugin:dialog|open',{}]]) {
   await rejected('managed-denied-'+cmd,()=>window.__TAURI_INTERNALS__.invoke(cmd,args),deny);
 }
 const frameTest = async (origin,mode,index,command) => {
   const id=`cross-origin-${index}-${mode}-${command}`;
   const frame=document.createElement('iframe'); frame.src=origin+'/frame'; document.body.appendChild(frame);
   try { await bounded(new Promise((resolve,reject)=>{
     let started=false;
     const clean=()=>window.removeEventListener('message',onMessage);
     const success=value=>{clean();resolve(value);};
     const callback=window.__TAURI_INTERNALS__.transformCallback(value=>success({response:value,responseKind:'ok'}),true);
     const error=window.__TAURI_INTERNALS__.transformCallback(value=>success({response:value,responseKind:'error'}),true);
     function onMessage(event) {
       if(event.source!==frame.contentWindow || event.origin!==origin)return;
       if(event.data?.kind==='blackcrab-qa-ready' && !started) {
         started=true;frame.contentWindow.postMessage({kind:'blackcrab-qa-start',id,mode,command,key:q.key,payload:{generation:q.grant.generation,url:'file:///tmp/blackcrab-qa-never-open',options:{targetEnvironmentId:'env_remote'}},callback,error},origin);
       } else if(event.data?.kind==='blackcrab-qa-result' && event.data.id===id) success(event.data);
     }
     window.addEventListener('message',onMessage);
   })).then(value=>results.push({id,passed:value.responseKind==='error' && deny(value.response),responseKind:value.responseKind,error:String(value.response ?? value.transportFailure)}));
   }catch(error){results.push({id,passed:false,error:String(error)});}finally{frame.remove();}
 };
 for(let i=0;i<q.origins.length;i++)for(const mode of ['fetch','postMessage'])for(const command of ['managed_native_open_external','managed_native_pick_project_favicon'])await frameTest(q.origins[i],mode,i,command);
 await fetch(q.reportUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'managed',passed:results.length===13 && results.every(r=>r.passed),results})});
})().catch(async error=>{const q=__blackcrabQaConfig;await fetch(q.reportUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'managed',passed:false,error:String(error)})});});
"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_is_bounded_and_requires_report_nonce() {
        let fixture = fixture("test-nonce").unwrap();
        let request = |path: &str| {
            let mut stream =
                TcpStream::connect(fixture.origin.strip_prefix("http://").unwrap()).unwrap();
            write!(
                stream,
                "POST {path} HTTP/1.1\r\nContent-Length: 2\r\n\r\n{{}}"
            )
            .unwrap();
            let mut out = String::new();
            stream.read_to_string(&mut out).unwrap();
            out
        };
        assert!(request("/report/wrong").contains("404"));
        assert!(fixture.reports.lock().unwrap().is_empty());
        assert!(request("/report/test-nonce").contains("200"));
        assert_eq!(fixture.reports.lock().unwrap().len(), 1);
    }
}
