//! Unix-only feasibility probe, not a supported host or client protocol.
#![allow(dead_code)]
#[path = "../../../src-tauri/src/codex_rpc.rs"]
mod codex_rpc;
#[path = "../../../src-tauri/src/codex_runtime.rs"]
mod codex_runtime;
#[path = "reused/execution.rs"]
mod execution;

use codex_runtime::{Runtime, Sandbox, StartOptions};
use execution::ExecutionStore;
use serde::Deserialize;
use serde_json::json;
use std::{path::Path, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::UnixListener,
    process::Command,
};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Send { id: String, text: String },
    Receipt { id: String },
    Interrupt,
    Stop,
}

fn emit(value: serde_json::Value) {
    println!("{value}");
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("");
    let root = Path::new(
        args.get(2)
            .ok_or("usage: prototype serve ROOT FIXTURE | contend ROOT THREAD")?,
    );
    // This binary deliberately has no production path default or service installation.
    use std::os::unix::fs::PermissionsExt;
    if std::fs::metadata(root)
        .map_err(|e| e.to_string())?
        .permissions()
        .mode()
        & 0o077
        != 0
    {
        return Err("probe root must be a private directory (mode 0700)".into());
    }
    if std::fs::read_to_string(root.join(".blackcrab-host-probe"))
        .ok()
        .as_deref()
        != Some("isolated fixture experiment\n")
    {
        return Err("probe root must be created by the isolated smoke runner".into());
    }
    let store = Arc::new(ExecutionStore::open(&root.join("journal"))?);
    if mode == "contend" {
        let thread = args.get(3).ok_or("missing provider session")?;
        let context = store.context(
            "codex",
            &root.join("project").to_string_lossy(),
            Some(thread),
        )?;
        let excluded = context.lock_provider_session().is_err();
        let receipt = store.receipt("probe-command")?;
        emit(json!({"providerSessionExcluded":excluded,"receipt":receipt}));
        return if excluded && receipt.status == "running" {
            Ok(())
        } else {
            Err("live owner protection failed".into())
        };
    }
    if mode != "serve" {
        return Err("unknown probe mode".into());
    }
    let fixture = Path::new(args.get(3).ok_or("missing local fixture path")?)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(root.join("project")).map_err(|e| e.to_string())?;
    let socket_path = root.join("control.sock");
    // Existing paths are never removed to make an unrelated listener replaceable.
    let listener = UnixListener::bind(&socket_path).map_err(|e| e.to_string())?;
    let mut command = Command::new("python3");
    command
        .arg("-u")
        .arg(fixture)
        .env("BLACKCRAB_QA_STATE", root.join("fixture"))
        .env("BLACKCRAB_QA_JOURNAL", root.join("journal/state.sqlite3"));
    let (runtime, mut events) = Runtime::start(
        command,
        store.clone(),
        StartOptions {
            cwd: root.join("project").to_string_lossy().into_owned(),
            resume_id: None,
            model: Some("native-qa".into()),
            sandbox: Sandbox::ReadOnly,
            rpc: codex_rpc::Options {
                request_timeout: Duration::from_secs(5),
                ..Default::default()
            },
        },
    )
    .await
    .map_err(|e| format!("fixture runtime failed: {e:?}"))?;
    let event_log = root.join("events.jsonl");
    let drainer = tokio::spawn(async move {
        let mut output = tokio::fs::File::create(event_log).await.unwrap();
        while let Some(event) = events.recv().await {
            let line = format!("{}\n", serde_json::to_string(&event).unwrap());
            if output.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });
    emit(
        json!({"ready":true,"pid":std::process::id(),"socket":socket_path,"providerThread":runtime.info.provider_thread_id}),
    );
    loop {
        let (stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let (read, mut write) = stream.into_split();
        // A disconnected client does not own the runtime. Bound idle clients/frames.
        let mut reader = BufReader::new(read).take(4097);
        let mut line = String::new();
        let read = tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut line)).await;
        let request = match read {
            Ok(Ok(size)) if size > 0 && size <= 4096 && line.ends_with('\n') => {
                serde_json::from_str::<Request>(&line)
            }
            _ => continue,
        };
        let (result, stop) = match request {
            Ok(Request::Send { id, text }) => (
                match runtime.send(&id, &text).await {
                    Ok(receipt) => json!({"ok":true,"receipt":receipt}),
                    Err(error) => json!({"ok":false,"error":format!("{error:?}")}),
                },
                false,
            ),
            Ok(Request::Receipt { id }) => (
                match store.receipt(&id) {
                    Ok(receipt) => json!({"ok":true,"receipt":receipt}),
                    Err(error) => json!({"ok":false,"error":error}),
                },
                false,
            ),
            Ok(Request::Interrupt) => (json!({"ok":runtime.interrupt().await.is_ok()}), false),
            Ok(Request::Stop) => {
                runtime.stop().await;
                (json!({"ok":true}), true)
            }
            Err(_) => (json!({"ok":false,"error":"invalid probe command"}), false),
        };
        let _ = write.write_all(format!("{result}\n").as_bytes()).await;
        if stop {
            break;
        }
    }
    runtime.stop().await;
    let _ = tokio::time::timeout(Duration::from_secs(2), drainer).await;
    std::fs::remove_file(socket_path).map_err(|e| e.to_string())?;
    Ok(())
}
