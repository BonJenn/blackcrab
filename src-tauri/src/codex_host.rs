//! Native session registry bridge. The runtime owns its journal/queue dispatch;
//! the host must not prepare a second turn or feed Claude framing into it.
use super::*;
use crate::codex_runtime::{Decision, Event, Runtime, Sandbox, StartOptions};

pub(crate) type EventSink = Arc<dyn Fn(&Event, &ExecutionContext) + Send + Sync>;
fn owner_key(id: &str) -> String {
    format!("codex:{id}")
}
pub(crate) fn error(error: codex_runtime::Error) -> String {
    match error {
        codex_runtime::Error::Journal(message) => message,
        codex_runtime::Error::Protocol(message) => message.into(),
        codex_runtime::Error::Busy => "Codex session is busy; refresh before trying again".into(),
        codex_runtime::Error::Closed => {
            "Codex runtime closed; resume the session before continuing".into()
        }
        codex_runtime::Error::Rpc(_) => {
            "Codex request failed; delivery may be uncertain. Review the receipt before retrying"
                .into()
        }
    }
}
pub(crate) async fn runtime(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    panel: &str,
) -> Option<Runtime> {
    sessions.lock().await.get(panel).and_then(Session::codex)
}
pub(crate) async fn answer(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    panel: &str,
    id: &str,
    decision: &str,
) -> Result<(), String> {
    let decision = match decision {
        "accept" => Decision::Accept,
        "decline" => Decision::Decline,
        "cancel" => Decision::Cancel,
        _ => return Err("unsupported approval decision; use accept, decline or cancel".into()),
    };
    let runtime = runtime(sessions, panel)
        .await
        .ok_or("panel does not have a Codex runtime")?;
    runtime.answer(id, decision).await.map_err(error)
}

/// UI writes target a particular runtime, never whichever run later occupies a panel.
#[derive(serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Action {
    Submit {
        command_id: String,
        text: String,
        #[serde(default)]
        queued: bool,
    },
    Queue {},
    ChangeQueue {
        expected_revision: i64,
        change: QueueChange,
    },
    Interrupt {},
    Answer {
        approval_id: String,
        decision: Decision,
    },
    Stop {},
}
#[derive(serde::Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub(crate) enum ControlReply {
    Receipt(TurnReceipt),
    Queue(QueueSnapshot),
    Done,
}

pub(crate) async fn control(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    owners: &Arc<Mutex<HashMap<String, String>>>,
    panel: &str,
    expected_run: &str,
    action: Action,
) -> Result<ControlReply, String> {
    let mut guard = sessions.lock().await;
    let session = guard.get(panel).ok_or("no Codex session for this panel")?;
    if session.provider != Provider::Codex || session.execution.run_id != expected_run {
        return Err("Codex session changed; refresh before trying again".into());
    }
    let runtime = session
        .codex()
        .ok_or("panel does not have a Codex runtime")?;
    if matches!(action, Action::Stop {}) {
        // Keep the registry locked through stop and ownership release. A stale
        // stop can neither remove a replacement nor release its writer lease.
        let session = guard.remove(panel).expect("validated session");
        session.process_finished.store(true, Ordering::SeqCst);
        runtime.stop().await;
        let result = execution::io(move || {
            session
                .execution
                .finish("interrupted", Some("Session stopped"))
        })
        .await;
        owners.lock().await.retain(|_, owner| owner != panel);
        result?;
        return Ok(ControlReply::Done);
    }
    if session.process_finished.load(Ordering::SeqCst) {
        if matches!(action, Action::Queue {}) {
            let context = session.execution.clone();
            return execution::io(move || context.queue_snapshot())
                .await
                .map(ControlReply::Queue);
        }
        return Err("Codex runtime ended; resume the original session before continuing".into());
    }
    // Clone the validated runtime while holding the registry lock. Replacements
    // may close this handle; they cannot redirect it to the new runtime.
    drop(guard);
    match action {
        Action::Submit {
            command_id,
            text,
            queued,
        } => {
            let result = if queued {
                runtime.enqueue(&command_id, &text).await
            } else {
                runtime.send(&command_id, &text).await
            };
            result.map(ControlReply::Receipt).map_err(error)
        }
        Action::Queue {} => runtime
            .queue()
            .await
            .map(ControlReply::Queue)
            .map_err(error),
        Action::ChangeQueue {
            expected_revision,
            change,
        } => runtime
            .change_queue(expected_revision, change)
            .await
            .map(ControlReply::Queue)
            .map_err(error),
        Action::Interrupt {} => runtime
            .interrupt()
            .await
            .map(|_| ControlReply::Done)
            .map_err(error),
        Action::Answer {
            approval_id,
            decision,
        } => runtime
            .answer(&approval_id, decision)
            .await
            .map(|_| ControlReply::Done)
            .map_err(error),
        Action::Stop {} => unreachable!("stop handled under registry lock"),
    }
}

pub(crate) async fn start(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    owners: &Arc<Mutex<HashMap<String, String>>>,
    store: Arc<ExecutionStore>,
    panel: String,
    launch: provider::LaunchSpec,
    command: Option<Command>,
    sink: EventSink,
) -> Result<(), String> {
    // Validate even when invoked internally instead of through start_session.
    if launch.provider != Provider::Codex
        || !["default", "readOnly"].contains(&launch.permission_mode.as_str())
    {
        return Err("invalid Codex launch specification".into());
    }
    // Missing executables fail before replacing a running panel.
    let mut command = match command {
        Some(command) => command,
        None => {
            let path = find_executable_in_path(Provider::Codex.executable(), &claude_path_env())
                .ok_or("Codex CLI is not installed or not on PATH")?;
            let mut command = Command::new(path);
            command.args(&launch.args);
            command.env("PATH", claude_path_env());
            command
        }
    };
    let mut guard = sessions.lock().await;
    if let Some(mut old) = guard.remove(&panel) {
        old.process_finished.store(true, Ordering::SeqCst);
        old.stop_io().await;
        execution::io(move || {
            old.execution
                .finish("interrupted", Some("Panel process replaced"))
        })
        .await?;
    }
    release_panel_session_owners(owners, &panel).await;
    let known = launch.resume_id.as_ref().map(|id| owner_key(id));
    reserve_session_owner(owners, known.as_deref(), &panel).await?;
    // Configuration/account belongs to Codex. Never inject Claude's stored token.
    command.kill_on_drop(true);
    let started = Runtime::start(
        command,
        store,
        StartOptions {
            cwd: launch.cwd,
            resume_id: launch.resume_id,
            model: launch.model,
            sandbox: if launch.permission_mode == "readOnly" {
                Sandbox::ReadOnly
            } else {
                Sandbox::WorkspaceWrite
            },
            rpc: codex_rpc::Options::default(),
        },
    )
    .await;
    let (runtime, events) = match started {
        Ok(value) => value,
        Err(failure) => {
            if let Some(key) = known.as_deref() {
                release_session_owner_if_matches(owners, key, &panel).await;
            }
            return Err(match failure {
                codex_runtime::Error::Rpc(_) => {
                    "Codex app-server could not start; check its CLI configuration and account"
                        .into()
                }
                failure => error(failure),
            });
        }
    };
    let key = owner_key(&runtime.info.provider_thread_id);
    if let Err(failure) = reserve_session_owner(owners, Some(&key), &panel).await {
        runtime.stop().await;
        return Err(failure);
    }
    let context = runtime.execution.clone();
    let finished = Arc::new(AtomicBool::new(false));
    guard.insert(
        panel.clone(),
        Session {
            provider: Provider::Codex,
            execution: context.clone(),
            process_finished: finished.clone(),
            io: SessionIo::Codex(runtime),
        },
    );
    drop(guard);
    tokio::spawn(forward(
        events,
        sessions.clone(),
        owners.clone(),
        panel,
        key,
        context,
        finished,
        sink,
    ));
    Ok(())
}
async fn forward(
    mut events: tokio::sync::mpsc::Receiver<Event>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    owners: Arc<Mutex<HashMap<String, String>>>,
    panel: String,
    key: String,
    context: ExecutionContext,
    finished: Arc<AtomicBool>,
    sink: EventSink,
) {
    let mut closed = false;
    while let Some(event) = events.recv().await {
        if finished.load(Ordering::SeqCst) {
            break;
        }
        closed = matches!(event, Event::Closed { .. });
        sink(&event, &context);
        if closed {
            break;
        }
    }
    finished.store(true, Ordering::SeqCst);
    // Hold the registry lock through owner cleanup, as in the Claude reader.
    let guard = sessions.lock().await;
    if guard
        .get(&panel)
        .is_none_or(|session| session.execution.run_id == context.run_id)
    {
        release_session_owner_if_matches(&owners, &key, &panel).await;
        if !closed {
            sink(
                &Event::Closed {
                    reason: "Codex event stream ended".into(),
                },
                &context,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
        store: Arc<ExecutionStore>,
        sessions: Arc<Mutex<HashMap<String, Session>>>,
        owners: Arc<Mutex<HashMap<String, String>>>,
        sink: EventSink,
        events: tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(execution::new_id("codex_host_test").unwrap());
            let store = Arc::new(ExecutionStore::open(&root.join("journal")).unwrap());
            let (tx, events) = tokio::sync::mpsc::unbounded_channel();
            let sink: EventSink = Arc::new(move |event, context| {
                let _ = tx.send(serde_json::json!({"runId":context.run_id,"event":event}));
            });
            Self {
                root,
                store,
                sessions: Arc::new(Mutex::new(HashMap::new())),
                owners: Arc::new(Mutex::new(HashMap::new())),
                sink,
                events,
            }
        }
        fn launch(&self, resume: Option<&str>) -> provider::LaunchSpec {
            prepare_launch(
                LaunchRequest {
                    provider: Some("codex".into()),
                    cwd: self.root.to_string_lossy().into_owned(),
                    permission_mode: Some("default".into()),
                    model: Some("fixture-model".into()),
                    resume_id: resume.map(String::from),
                    use_worktree: false,
                },
                None,
            )
            .unwrap()
        }
        fn command(&self) -> Command {
            let mut command = Command::new("python3");
            command
                .arg("-u")
                .arg(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/codex_runtime.py"
                ))
                .arg(self.root.join("journal/state.sqlite3"))
                .arg(self.root.join("wire.jsonl"))
                .arg("normal");
            command
        }
        async fn start(&self, panel: &str, resume: Option<&str>) -> Result<(), String> {
            start(
                &self.sessions,
                &self.owners,
                self.store.clone(),
                panel.into(),
                self.launch(resume),
                Some(self.command()),
                self.sink.clone(),
            )
            .await
        }
        async fn event(&mut self, kind: &str) -> serde_json::Value {
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                loop {
                    let value = self.events.recv().await.expect("host event stream");
                    if value["event"]["type"] == kind {
                        return value;
                    }
                }
            })
            .await
            .unwrap()
        }
        fn starts(&self) -> Vec<serde_json::Value> {
            std::fs::read_to_string(self.root.join("wire.jsonl"))
                .unwrap_or_default()
                .lines()
                .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
                .filter(|row| row["phase"] == "turn/start")
                .collect()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn shared_host_send_routes_once_and_never_uses_claude_framing() {
        let mut f = Fixture::new();
        f.start("panel", None).await.unwrap();
        let ready = f.event("ready").await;
        assert_eq!(
            ready["event"]["info"]["providerThreadId"],
            "fixture-codex-thread"
        );
        assert!(deliver_user_message(&f.sessions, "panel", "legacy bypass")
            .await
            .is_err());
        assert!(
            terminate_panel_checked(&f.sessions, &f.owners, "panel", Some(Provider::Claude))
                .await
                .is_err()
        );
        assert!(f.sessions.lock().await.contains_key("panel"));
        let receipt =
            deliver_user_message_command(&f.sessions, "panel", "complete", Some("command".into()))
                .await
                .unwrap();
        assert_eq!(receipt.status, "running");
        assert_eq!(
            f.event("turn_completed").await["event"]["receipt"]["status"],
            "succeeded"
        );
        assert_eq!(
            deliver_user_message_command(&f.sessions, "panel", "complete", Some("command".into()))
                .await
                .unwrap()
                .status,
            "succeeded"
        );
        assert!(deliver_raw_line(
            &f.sessions,
            "panel",
            r#"{"type":"user","message":{"content":"bypass"}}"#
        )
        .await
        .is_err());
        assert!(
            deliver_raw_line(&f.sessions, "panel", r#"{"type":"control_request"}"#)
                .await
                .is_err()
        );
        assert_eq!(
            f.store.provider_turn_id("command").unwrap().as_deref(),
            Some("provider-turn-1")
        );
        terminate_panel(&f.sessions, &f.owners, "panel")
            .await
            .unwrap();
        assert_eq!(f.starts().len(), 1);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn shared_queue_interrupt_and_resume_use_only_the_runtime_dispatcher() {
        let mut f = Fixture::new();
        f.start("panel", None).await.unwrap();
        f.event("ready").await;
        deliver_user_message_command(&f.sessions, "panel", "hold", Some("active".into()))
            .await
            .unwrap();
        enqueue_panel_message(
            &f.sessions,
            "panel".into(),
            "queued-one".into(),
            "next".into(),
            None,
        )
        .await
        .unwrap();
        interrupt_panel(&f.sessions, "panel".into(), None)
            .await
            .unwrap();
        assert_eq!(
            f.event("turn_completed").await["event"]["receipt"]["status"],
            "interrupted"
        );
        let snapshot = runtime(&f.sessions, "panel")
            .await
            .unwrap()
            .queue()
            .await
            .unwrap();
        assert!(snapshot.paused);
        assert_eq!(snapshot.items.len(), 1);
        change_panel_queue(
            &f.sessions,
            "panel".into(),
            snapshot.revision,
            QueueChange::Resume,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            f.event("turn_completed").await["event"]["receipt"]["commandId"],
            "next"
        );
        terminate_panel(&f.sessions, &f.owners, "panel")
            .await
            .unwrap();
        assert_eq!(f.starts().len(), 2);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn native_approval_endpoint_accepts_only_a_current_opaque_one_time_decision() {
        let mut f = Fixture::new();
        f.start("panel", None).await.unwrap();
        f.event("ready").await;
        deliver_user_message_command(
            &f.sessions,
            "panel",
            "approval",
            Some("approval-command".into()),
        )
        .await
        .unwrap();
        let request = f.event("approval_requested").await;
        let id = request["event"]["approvalId"].as_str().unwrap();
        assert!(answer(&f.sessions, "panel", id, "acceptForSession")
            .await
            .is_err());
        assert!(answer(&f.sessions, "other", id, "accept").await.is_err());
        answer(&f.sessions, "panel", id, "decline").await.unwrap();
        f.event("turn_completed").await;
        assert!(answer(&f.sessions, "panel", id, "accept").await.is_err());
        terminate_panel(&f.sessions, &f.owners, "panel")
            .await
            .unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn stop_restart_and_stale_reader_cleanup_preserve_the_replacement_owner() {
        let mut f = Fixture::new();
        f.start("panel", None).await.unwrap();
        let old = f.event("ready").await["runId"]
            .as_str()
            .unwrap()
            .to_string();
        terminate_panel(&f.sessions, &f.owners, "panel")
            .await
            .unwrap();
        f.start("panel", Some("fixture-codex-thread"))
            .await
            .unwrap();
        let new = f.event("ready").await["runId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_ne!(old, new);
        assert_eq!(
            f.owners
                .lock()
                .await
                .get("codex:fixture-codex-thread")
                .map(String::as_str),
            Some("panel")
        );
        assert!(f
            .start("second", Some("fixture-codex-thread"))
            .await
            .is_err());
        assert_eq!(
            f.sessions
                .lock()
                .await
                .get("panel")
                .unwrap()
                .execution
                .run_id,
            new
        );
        let mut invalid = f.launch(None);
        invalid.permission_mode = "bypassPermissions".into();
        assert!(start(
            &f.sessions,
            &f.owners,
            f.store.clone(),
            "panel".into(),
            invalid,
            Some(f.command()),
            f.sink.clone()
        )
        .await
        .is_err());
        assert_eq!(
            f.sessions
                .lock()
                .await
                .get("panel")
                .unwrap()
                .execution
                .run_id,
            new
        );
        terminate_panel(&f.sessions, &f.owners, "panel")
            .await
            .unwrap();
    }
    #[test]
    fn typed_control_rejects_raw_actions_unknown_fields_and_broad_approval_grants() {
        for value in [
            serde_json::json!({"type":"send_raw","text":"bypass"}),
            serde_json::json!({"type":"stop","extra":true}),
            serde_json::json!({"type":"submit","commandId":"id","text":"body","method":"turn/start"}),
            serde_json::json!({"type":"answer","approvalId":"id","decision":"acceptForSession"}),
        ] {
            assert!(serde_json::from_value::<Action>(value).is_err());
        }
        for value in [
            serde_json::json!({"type":"submit","commandId":"id","text":"body"}),
            serde_json::json!({"type":"submit","commandId":"id","text":"body","queued":true}),
            serde_json::json!({"type":"queue"}),
            serde_json::json!({"type":"changeQueue","expectedRevision":1,"change":{"type":"pause"}}),
            serde_json::json!({"type":"interrupt"}),
            serde_json::json!({"type":"answer","approvalId":"opaque","decision":"cancel"}),
            serde_json::json!({"type":"stop"}),
        ] {
            assert!(serde_json::from_value::<Action>(value).is_ok());
        }
        assert_eq!(
            serde_json::to_value(ControlReply::Done).unwrap(),
            serde_json::json!({"type":"done"})
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn run_guard_rejects_every_stale_action_and_preserves_the_replacement() {
        let mut f = Fixture::new();
        f.start("panel", None).await.unwrap();
        let old = f.event("ready").await["runId"]
            .as_str()
            .unwrap()
            .to_string();
        control(&f.sessions, &f.owners, "panel", &old, Action::Stop {})
            .await
            .unwrap();
        f.start("panel", Some("fixture-codex-thread"))
            .await
            .unwrap();
        let current = f.event("ready").await["runId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_ne!(old, current);
        for action in [
            Action::Submit {
                command_id: "stale-send".into(),
                text: "complete".into(),
                queued: false,
            },
            Action::Submit {
                command_id: "stale-queue".into(),
                text: "complete".into(),
                queued: true,
            },
            Action::Queue {},
            Action::ChangeQueue {
                expected_revision: 0,
                change: QueueChange::Resume,
            },
            Action::Interrupt {},
            Action::Answer {
                approval_id: "stale-approval".into(),
                decision: Decision::Accept,
            },
            Action::Stop {},
        ] {
            assert!(control(&f.sessions, &f.owners, "panel", &old, action)
                .await
                .err()
                .unwrap()
                .contains("changed"));
        }
        assert!(f.store.receipt("stale-send").is_err());
        assert!(f.store.receipt("stale-queue").is_err());
        assert!(f.starts().is_empty());
        assert_eq!(f.sessions.lock().await["panel"].execution.run_id, current);
        assert_eq!(
            f.owners
                .lock()
                .await
                .get("codex:fixture-codex-thread")
                .map(String::as_str),
            Some("panel")
        );
        // Matching another panel's run also cannot control this panel.
        assert!(
            control(&f.sessions, &f.owners, "other", &current, Action::Stop {})
                .await
                .is_err()
        );
        control(&f.sessions, &f.owners, "panel", &current, Action::Stop {})
            .await
            .unwrap();
        assert!(!f.sessions.lock().await.contains_key("panel"));
        assert!(f.owners.lock().await.is_empty());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn matching_run_controls_share_receipts_queues_interrupts_and_one_time_approvals() {
        let mut f = Fixture::new();
        f.start("panel", None).await.unwrap();
        let run = f.event("ready").await["runId"]
            .as_str()
            .unwrap()
            .to_string();
        let receipt = control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::Submit {
                command_id: "command".into(),
                text: "hold".into(),
                queued: false,
            },
        )
        .await
        .unwrap();
        assert!(
            matches!(receipt,ControlReply::Receipt(ref receipt) if receipt.status == "running")
        );
        control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::Submit {
                command_id: "queued".into(),
                text: "queued-one".into(),
                queued: true,
            },
        )
        .await
        .unwrap();
        control(&f.sessions, &f.owners, "panel", &run, Action::Interrupt {})
            .await
            .unwrap();
        assert_eq!(
            f.event("turn_completed").await["event"]["receipt"]["status"],
            "interrupted"
        );
        assert!(control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::Submit {
                command_id: "command".into(),
                text: "changed body".into(),
                queued: false
            }
        )
        .await
        .is_err());
        let duplicate = control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::Submit {
                command_id: "command".into(),
                text: "hold".into(),
                queued: false,
            },
        )
        .await
        .unwrap();
        assert!(
            matches!(duplicate,ControlReply::Receipt(ref receipt) if receipt.status == "interrupted")
        );
        assert_eq!(f.starts().len(), 1);
        let snapshot = control(&f.sessions, &f.owners, "panel", &run, Action::Queue {})
            .await
            .unwrap();
        let ControlReply::Queue(snapshot) = snapshot else {
            panic!("expected queue");
        };
        assert!(snapshot.paused);
        assert_eq!(snapshot.items.len(), 1);
        control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::ChangeQueue {
                expected_revision: snapshot.revision,
                change: QueueChange::Resume,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            f.event("turn_completed").await["event"]["receipt"]["commandId"],
            "queued"
        );

        control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::Submit {
                command_id: "approval".into(),
                text: "approval".into(),
                queued: false,
            },
        )
        .await
        .unwrap();
        let event = f.event("approval_requested").await;
        let approval = event["event"]["approvalId"].as_str().unwrap().to_string();
        assert!(control(
            &f.sessions,
            &f.owners,
            "panel",
            "foreign-run",
            Action::Answer {
                approval_id: approval.clone(),
                decision: Decision::Accept
            }
        )
        .await
        .is_err());
        control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::Answer {
                approval_id: approval.clone(),
                decision: Decision::Decline,
            },
        )
        .await
        .unwrap();
        f.event("turn_completed").await;
        assert!(control(
            &f.sessions,
            &f.owners,
            "panel",
            &run,
            Action::Answer {
                approval_id: approval,
                decision: Decision::Accept
            }
        )
        .await
        .is_err());
        let result = control(&f.sessions, &f.owners, "panel", &run, Action::Queue {})
            .await
            .unwrap();
        assert!(
            matches!(result,ControlReply::Queue(ref snapshot) if snapshot.paused && snapshot.items.is_empty())
        );
        control(&f.sessions, &f.owners, "panel", &run, Action::Stop {})
            .await
            .unwrap();
        assert_eq!(f.starts().len(), 3);
    }
}
