//! Queue RPC shared by authenticated LAN and encrypted relay connections.
//! Never starts a process or routes work through the foreground webview.
use super::*;
use serde::{Deserialize, Serialize};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QueueRequest {
    pub host_id: String,
    pub session_id: String,
    pub request_id: String,
    pub operation: QueueOperation,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum QueueOperation {
    Get {},
    Enqueue {
        #[serde(rename = "commandId")]
        command_id: String,
        body: String,
    },
    Update {
        #[serde(rename = "expectedRevision")]
        expected_revision: i64,
        change: QueueChange,
    },
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.trim() == id
        && id.bytes().all(|byte| (b' '..=b'~').contains(&byte))
}

impl QueueRequest {
    fn validate(&self) -> bool {
        !self.host_id.trim().is_empty()
            && self.host_id.chars().count() <= 1024
            && valid_id(&self.session_id)
            && valid_id(&self.request_id)
            && match &self.operation {
                QueueOperation::Get {} => true,
                QueueOperation::Enqueue { command_id, body } => {
                    valid_id(command_id) && !body.trim().is_empty()
                }
                QueueOperation::Update {
                    expected_revision,
                    change,
                } => {
                    (0..=MAX_SAFE_INTEGER).contains(expected_revision)
                        && match change {
                            QueueChange::Edit { command_id, text } => {
                                valid_id(command_id) && !text.trim().is_empty()
                            }
                            QueueChange::Cancel { command_id } => valid_id(command_id),
                            QueueChange::Reorder { command_ids } => {
                                command_ids.len() <= 100
                                    && command_ids.iter().all(|id| valid_id(id))
                                    && command_ids
                                        .iter()
                                        .collect::<std::collections::HashSet<_>>()
                                        .len()
                                        == command_ids.len()
                            }
                            QueueChange::Pause | QueueChange::Resume => true,
                        }
                }
            }
    }
}

/// Only called after transport authentication. Unknown/malformed/version-skewed
/// queue envelopes cannot fall back to legacy send or webview actions.
pub(crate) fn decode(plaintext: &str) -> Option<QueueRequest> {
    let envelope: serde_json::Value = serde_json::from_str(plaintext).ok()?;
    if envelope.get("v")?.as_u64()? != 1 {
        return None;
    }
    let mut msg = envelope.get("msg")?.as_object()?.clone();
    if msg.remove("type")?.as_str()? != "queue_request" {
        return None;
    }
    let request: QueueRequest = serde_json::from_value(msg.into()).ok()?;
    request.validate().then_some(request)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueResult {
    #[serde(rename = "type")]
    kind: &'static str,
    host_id: String,
    session_id: String,
    request_id: String,
    ok: bool,
    error: Option<String>,
    queue: Option<QueueSnapshot>,
    receipt: Option<TurnReceipt>,
}

pub(crate) async fn execute(
    request: QueueRequest,
    host_id: &str,
    store: Arc<ExecutionStore>,
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    owners: &Arc<Mutex<HashMap<String, String>>>,
    app: Option<&AppHandle>,
) -> QueueResult {
    let mut result = QueueResult {
        kind: "queue_result",
        host_id: host_id.into(),
        session_id: request.session_id.clone(),
        request_id: request.request_id.clone(),
        ok: false,
        error: None,
        queue: None,
        receipt: None,
    };
    // Check even for an internally constructed command, before reading data.
    if request.host_id != host_id || !request.validate() {
        result.error = Some("Queue request targets a different host or is invalid".into());
        return result;
    }
    let sid = request.session_id.clone();
    let read_store = store.clone();
    let initial = match execution::io(move || read_store.queue_for_session("claude", &sid)).await {
        Ok(queue) => queue,
        Err(error) => {
            result.error = Some(error);
            return result;
        }
    };
    if matches!(request.operation, QueueOperation::Get {}) {
        result.ok = true;
        result.queue = initial;
        return result;
    }
    let Some(initial) = initial else {
        result.error = Some("Unknown session queue. Open the session on the desktop first.".into());
        return result;
    };
    // A duplicate enqueue can be confirmed even after the process has stopped.
    // Compare the ORIGINAL body, not an edited pending payload.
    if let QueueOperation::Enqueue { command_id, body } = &request.operation {
        let check_store = store.clone();
        let id = command_id.clone();
        let thread = initial.thread_id.clone();
        let body = body.clone();
        match execution::io(move || check_store.confirm_queued(&thread, &id, &body)).await {
            Ok(Some(receipt)) => {
                result.ok = true;
                result.receipt = Some(receipt);
                result.queue = Some(initial);
                return result;
            }
            Ok(None) => {}
            Err(error) => {
                result.error = Some(error);
                result.queue = Some(initial);
                return result;
            }
        }
    }
    let panel = panel_for_session(owners, &request.session_id).await;
    let applied = async {
        let panel = panel.ok_or("Resume this session on the desktop before changing its queue")?;
        let context = {
            let guard = sessions.lock().await;
            let session = guard
                .get(&panel)
                .ok_or("Session process is no longer available")?;
            if session.execution.thread_id != initial.thread_id {
                return Err("Session changed; refresh the queue before continuing".into());
            }
            if session.process_finished.load(Ordering::SeqCst) {
                return Err("Resume this session on the desktop before changing its queue".into());
            }
            let context = session.execution.clone();
            let edit = context.clone();
            match request.operation.clone() {
                QueueOperation::Enqueue { command_id, body } => {
                    execution::io(move || edit.enqueue(&command_id, &body)).await?;
                }
                QueueOperation::Update {
                    expected_revision,
                    change,
                } => {
                    execution::io(move || edit.update_queue(expected_revision, change)).await?;
                }
                QueueOperation::Get {} => unreachable!(),
            }
            context
        };
        let dispatched = dispatch_next_queued(sessions, &panel, &context.run_id, app).await;
        if let Some(app) = app {
            emit_queue_changed(app, &panel, &context);
        }
        dispatched?;
        Ok::<(), String>(())
    }
    .await;
    result.error = applied.err();
    // Always re-read after mutation, including errors after commit/dispatch.
    let sid = request.session_id.clone();
    let read_store = store.clone();
    match execution::io(move || read_store.queue_for_session("claude", &sid)).await {
        Ok(queue) => result.queue = queue,
        Err(error) => {
            result.error.get_or_insert(error);
        }
    }
    if let QueueOperation::Enqueue { command_id, body } = request.operation {
        let thread = initial.thread_id;
        match execution::io(move || store.confirm_queued(&thread, &command_id, &body)).await {
            Ok(receipt) => result.receipt = receipt,
            Err(error) => {
                result.error.get_or_insert(error);
            }
        }
    }
    result.ok = result.error.is_none();
    result
}

pub(crate) fn snapshot_value(
    store: &ExecutionStore,
    session_id: &str,
) -> Result<serde_json::Value, String> {
    Ok(
        serde_json::json!({ "type":"queue_snapshot", "hostId":remote_host_id_for_pairing(), "sessionId":session_id, "queue":store.queue_for_session("claude", session_id)? }),
    )
}

static STORE: OnceLock<Arc<ExecutionStore>> = OnceLock::new();
pub(crate) fn initialize(store: Arc<ExecutionStore>) {
    let _ = STORE.set(store);
}
pub(crate) fn focused_snapshot() -> Option<serde_json::Value> {
    snapshot_value(STORE.get()?.as_ref(), &focused_session_id()?).ok()
}

pub(crate) fn changed(context: ExecutionContext) {
    // Avoid SQLite work in the provider reader's synchronous event callback.
    tauri::async_runtime::spawn(async move {
        let value = execution::io(move || {
            let sid = context.store.session_for_thread(&context.thread_id)?;
            sid.map(|sid| snapshot_value(&context.store, &sid))
                .transpose()
        })
        .await;
        if let Ok(Some(value)) = value {
            push_remote_event(value);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_contract_matches_shared_typescript_fixtures() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../packages/remote-protocol/fixtures/queue-requests.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                decode(&case["envelope"].to_string()).is_some(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
    }

    fn request(operation: QueueOperation) -> QueueRequest {
        QueueRequest {
            host_id: "host".into(),
            session_id: "native-queue".into(),
            request_id: "request".into(),
            operation,
        }
    }
    fn enqueue(id: &str, body: &str) -> QueueOperation {
        QueueOperation::Enqueue {
            command_id: id.into(),
            body: body.into(),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn remote_queue_uses_host_ordering_receipts_conflicts_and_explicit_recovery() {
        let root = std::env::temp_dir().join(execution::new_id("remote_queue_test").unwrap());
        let store = Arc::new(ExecutionStore::open(&root).unwrap());
        let context = store
            .context("claude", "/fixture", Some("native-queue"))
            .unwrap();
        let mut child = Command::new("sh")
            .args(["-c", "cat"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let sessions = Arc::new(Mutex::new(HashMap::from([(
            "panel".into(),
            Session {
                provider: Provider::Claude,
                execution: context.clone(),
                process_finished: Arc::new(AtomicBool::new(false)),
                io: SessionIo::Claude { child, stdin },
            },
        )])));
        let owners = Arc::new(Mutex::new(HashMap::from([(
            "native-queue".into(),
            "panel".into(),
        )])));
        deliver_user_message_command(&sessions, "panel", "active", Some("active".into()))
            .await
            .unwrap();
        lines.next_line().await.unwrap().unwrap();
        let run = |op| execute(request(op), "host", store.clone(), &sessions, &owners, None);
        let first = run(enqueue("a", "first")).await;
        assert!(first.ok);
        assert_eq!(first.receipt.unwrap().status, "queued");
        let second = run(enqueue("b", "second")).await;
        let revision = second.queue.unwrap().revision;
        let edited = run(QueueOperation::Update {
            expected_revision: revision,
            change: QueueChange::Edit {
                command_id: "a".into(),
                text: "edited first".into(),
            },
        })
        .await;
        assert!(edited.ok);
        let stale = run(QueueOperation::Update {
            expected_revision: revision,
            change: QueueChange::Cancel {
                command_id: "a".into(),
            },
        })
        .await;
        assert!(!stale.ok);
        assert!(stale.error.unwrap().contains("queue changed"));
        let queue = stale.queue.unwrap();
        assert_eq!(queue.items[0].text, "edited first");
        let reordered = run(QueueOperation::Update {
            expected_revision: queue.revision,
            change: QueueChange::Reorder {
                command_ids: vec!["b".into(), "a".into()],
            },
        })
        .await;
        let paused = run(QueueOperation::Update {
            expected_revision: reordered.queue.unwrap().revision,
            change: QueueChange::Pause,
        })
        .await;
        assert!(paused.queue.unwrap().paused);
        context.finish("succeeded", None).unwrap();
        let duplicate = run(enqueue("a", "first")).await;
        assert!(duplicate.ok);
        assert_eq!(duplicate.queue.as_ref().unwrap().items.len(), 2);
        assert_eq!(duplicate.receipt.unwrap().status, "held");
        assert!(!run(enqueue("a", "edited first")).await.ok);
        let queue = duplicate.queue.unwrap();
        let resumed = run(QueueOperation::Update {
            expected_revision: queue.revision,
            change: QueueChange::Resume,
        })
        .await;
        assert!(resumed.ok);
        assert_eq!(resumed.queue.unwrap().items.len(), 1);
        let line: serde_json::Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(line["message"]["content"], "second");
        let repeated = run(enqueue("b", "second")).await;
        assert!(repeated.ok);
        assert_eq!(repeated.receipt.unwrap().status, "running");
        let other = store
            .context("claude", "/fixture", Some("different-session"))
            .unwrap();
        sessions.lock().await.get_mut("panel").unwrap().execution = other;
        let retargeted = run(enqueue("wrong-thread", "must not reach replacement")).await;
        assert!(!retargeted.ok);
        assert!(retargeted.error.unwrap().contains("Session changed"));
        assert!(store.receipt("wrong-thread").is_err());
        sessions.lock().await.get_mut("panel").unwrap().execution = context.clone();
        // Stopping holds the last message; confirmation still works without a process.
        terminate_panel(&sessions, &owners, "panel").await.unwrap();
        let recovered = run(enqueue("b", "second")).await;
        assert!(recovered.ok);
        assert_eq!(recovered.receipt.unwrap().status, "interrupted");
        let held = run(QueueOperation::Get {}).await.queue.unwrap();
        assert!(held.paused);
        assert_eq!(held.items.len(), 1);
        let stopped = run(QueueOperation::Update {
            expected_revision: held.revision,
            change: QueueChange::Resume,
        })
        .await;
        assert!(!stopped.ok);
        assert!(stopped.queue.unwrap().paused);
        assert!(!run(enqueue("c", "must not start a process")).await.ok);
        assert!(store.receipt("c").is_err());
        let mut wrong_host = request(QueueOperation::Get {});
        wrong_host.host_id = "other".into();
        let rejected = execute(wrong_host, "host", store.clone(), &sessions, &owners, None).await;
        assert!(!rejected.ok);
        assert!(rejected.queue.is_none());
        let mut unknown = request(QueueOperation::Get {});
        unknown.session_id = "unknown".into();
        let missing = execute(unknown, "host", store.clone(), &sessions, &owners, None).await;
        assert!(missing.ok);
        assert!(missing.queue.is_none());
        assert_eq!(
            store
                .session_for_thread(&context.thread_id)
                .unwrap()
                .as_deref(),
            Some("native-queue")
        );
        drop(lines);
        drop(sessions);
        drop(context);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn failed_provider_write_returns_the_committed_uncertain_receipt() {
        let root =
            std::env::temp_dir().join(execution::new_id("remote_queue_failure_test").unwrap());
        let store = Arc::new(ExecutionStore::open(&root).unwrap());
        let context = store
            .context("claude", "/fixture", Some("native-queue"))
            .unwrap();
        let mut child = Command::new("sh")
            .args(["-c", "exit 0"])
            .stdin(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        child.wait().await.unwrap();
        let sessions = Arc::new(Mutex::new(HashMap::from([(
            "panel".into(),
            Session {
                provider: Provider::Claude,
                execution: context.clone(),
                process_finished: Arc::new(AtomicBool::new(false)),
                io: SessionIo::Claude { child, stdin },
            },
        )])));
        let owners = Arc::new(Mutex::new(HashMap::from([(
            "native-queue".into(),
            "panel".into(),
        )])));
        let failed = execute(
            request(enqueue("failed", "original")),
            "host",
            store.clone(),
            &sessions,
            &owners,
            None,
        )
        .await;
        assert!(!failed.ok);
        assert!(failed.error.is_some());
        assert_eq!(failed.receipt.unwrap().status, "uncertain");
        assert!(failed.queue.unwrap().paused);
        let retry = execute(
            request(enqueue("failed", "original")),
            "host",
            store.clone(),
            &sessions,
            &owners,
            None,
        )
        .await;
        assert!(retry.ok);
        assert_eq!(retry.receipt.unwrap().status, "uncertain");
        terminate_panel(&sessions, &owners, "panel").await.unwrap();
        drop(sessions);
        drop(context);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
