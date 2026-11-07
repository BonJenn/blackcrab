use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnReceipt {
    pub command_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub detail: Option<String>,
}

pub(crate) struct BeginTurn {
    pub receipt: TurnReceipt,
    pub dispatch: bool,
}

pub(crate) struct ExecutionStore {
    connection: Mutex<Connection>,
    host_id: String,
    // A different host must acquire this lease before recovering our turns.
    _lease: File,
}

#[derive(Clone)]
pub(crate) struct ExecutionContext {
    pub store: Arc<ExecutionStore>,
    pub thread_id: String,
    pub run_id: String,
}

pub(crate) fn new_id(prefix: &str) -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
    Ok(format!(
        "{prefix}_{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn lock_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|e| format!("execution lease: {e}"))
}

fn lease_path(root: &Path, host_id: &str) -> Result<PathBuf, String> {
    if !host_id.starts_with("host_")
        || !host_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err("invalid execution host identity".into());
    }
    Ok(root.join(format!("{host_id}.lock")))
}

fn row_receipt(row: &rusqlite::Row<'_>) -> rusqlite::Result<TurnReceipt> {
    Ok(TurnReceipt {
        command_id: row.get(0)?,
        thread_id: row.get(1)?,
        turn_id: row.get(2)?,
        status: row.get(3)?,
        created_at_ms: row.get(4)?,
        updated_at_ms: row.get(5)?,
        detail: row.get(6)?,
    })
}

const RECEIPT_COLUMNS: &str =
    "command_id, thread_id, turn_id, status, created_at_ms, updated_at_ms, detail";

impl ExecutionStore {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let host_id = new_id("host")?;
        let lease = lock_file(&lease_path(root, &host_id)?)?;
        lease.try_lock().map_err(|e| e.to_string())?;
        let db_path = root.join("state.sqlite3");
        let mut db = Connection::open(&db_path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )
        .map_err(|e| e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let version: i64 = tx
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err(format!(
                "execution store version {version} requires a newer Blackcrab"
            ));
        }
        if version == 0 {
            tx.execute_batch("
                CREATE TABLE threads (
                    thread_id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    cwd TEXT NOT NULL,
                    provider_session_id TEXT,
                    UNIQUE(provider, provider_session_id)
                );
                CREATE TABLE turns (
                    turn_id TEXT PRIMARY KEY,
                    command_id TEXT NOT NULL UNIQUE,
                    thread_id TEXT NOT NULL REFERENCES threads(thread_id),
                    run_id TEXT NOT NULL,
                    host_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('dispatching','running','succeeded','failed','interrupted','uncertain')),
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL,
                    detail TEXT
                );
                CREATE UNIQUE INDEX one_active_turn ON turns(thread_id) WHERE status IN ('dispatching','running');
                CREATE INDEX turn_history ON turns(thread_id, created_at_ms);
                PRAGMA user_version=1;
            ").map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;

        let hosts: Vec<String> = {
            let mut statement = db
                .prepare(
                    "SELECT DISTINCT host_id FROM turns WHERE status IN ('dispatching','running')",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<rusqlite::Result<_>>()
                .map_err(|e| e.to_string())?
        };
        for old_host in hosts {
            let old_lease = lock_file(&lease_path(root, &old_host)?)?;
            match old_lease.try_lock() {
                Ok(()) => {
                    db.execute("UPDATE turns SET status='interrupted', updated_at_ms=?1, detail='Host exited before a terminal result; review the transcript before retrying' WHERE host_id=?2 AND status IN ('dispatching','running')", params![now_ms(), old_host]).map_err(|e| e.to_string())?;
                }
                Err(TryLockError::WouldBlock) => {}
                Err(e) => return Err(format!("execution recovery lease: {e}")),
            }
        }
        Ok(Self {
            connection: Mutex::new(db),
            host_id,
            _lease: lease,
        })
    }

    pub fn context(
        self: &Arc<Self>,
        provider: &str,
        cwd: &str,
        session_id: Option<&str>,
    ) -> Result<ExecutionContext, String> {
        let mut db = self.connection.lock().map_err(|e| e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let existing = match session_id {
            Some(id) => tx
                .query_row(
                    "SELECT thread_id FROM threads WHERE provider=?1 AND provider_session_id=?2",
                    params![provider, id],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?,
            None => None,
        };
        let thread_id = match existing {
            Some(id) => id,
            None => {
                let id = new_id("thread")?;
                tx.execute("INSERT INTO threads(thread_id,provider,cwd,provider_session_id) VALUES(?1,?2,?3,?4)", params![id, provider, cwd, session_id]).map_err(|e| e.to_string())?;
                id
            }
        };
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ExecutionContext {
            store: self.clone(),
            thread_id,
            run_id: new_id("run")?,
        })
    }

    pub fn history(&self, provider: &str, session_id: &str) -> Result<Vec<TurnReceipt>, String> {
        let db = self.connection.lock().map_err(|e| e.to_string())?;
        let mut statement = db.prepare(&format!("SELECT {RECEIPT_COLUMNS} FROM turns WHERE thread_id=(SELECT thread_id FROM threads WHERE provider=?1 AND provider_session_id=?2) ORDER BY created_at_ms, rowid")).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![provider, session_id], row_receipt)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())
    }

    pub fn receipt(&self, command_id: &str) -> Result<TurnReceipt, String> {
        let db = self.connection.lock().map_err(|e| e.to_string())?;
        db.query_row(
            &format!("SELECT {RECEIPT_COLUMNS} FROM turns WHERE command_id=?1"),
            [command_id],
            row_receipt,
        )
        .map_err(|e| e.to_string())
    }
}

impl ExecutionContext {
    pub fn begin(&self, command_id: &str, text: &str) -> Result<BeginTurn, String> {
        if command_id.is_empty() || command_id.len() > 128 || command_id.trim() != command_id {
            return Err(
                "command ID must contain 1–128 bytes without surrounding whitespace".into(),
            );
        }
        if text.trim().is_empty() {
            return Err("message is empty".into());
        }
        let mut db = self.store.connection.lock().map_err(|e| e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let prior = tx
            .query_row(
                &format!("SELECT {RECEIPT_COLUMNS}, prompt FROM turns WHERE command_id=?1"),
                [command_id],
                |row| Ok((row_receipt(row)?, row.get::<_, String>(7)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((receipt, prompt)) = prior {
            if receipt.thread_id != self.thread_id || prompt != text {
                return Err("command ID was already used for a different message or thread".into());
            }
            return Ok(BeginTurn {
                receipt,
                dispatch: false,
            });
        }
        let busy: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM turns WHERE thread_id=?1 AND status IN ('dispatching','running'))", [&self.thread_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if busy {
            return Err("session has a running turn; wait for its result or stop it first".into());
        }
        let time = now_ms();
        let receipt = TurnReceipt {
            command_id: command_id.into(),
            thread_id: self.thread_id.clone(),
            turn_id: new_id("turn")?,
            status: "dispatching".into(),
            created_at_ms: time,
            updated_at_ms: time,
            detail: None,
        };
        tx.execute("INSERT INTO turns(turn_id,command_id,thread_id,run_id,host_id,prompt,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,?4,?5,?6,'dispatching',?7,?7)", params![receipt.turn_id, command_id, self.thread_id, self.run_id, self.store.host_id, text, time]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(BeginTurn {
            receipt,
            dispatch: true,
        })
    }

    pub fn sent(&self, command_id: &str) -> Result<TurnReceipt, String> {
        {
            let db = self.store.connection.lock().map_err(|e| e.to_string())?;
            db.execute("UPDATE turns SET status='running', updated_at_ms=?1 WHERE command_id=?2 AND run_id=?3 AND status='dispatching'", params![now_ms(), command_id, self.run_id]).map_err(|e| e.to_string())?;
        }
        self.store.receipt(command_id)
    }

    pub fn finish(&self, status: &str, detail: Option<&str>) -> Result<(), String> {
        if !["succeeded", "failed", "interrupted", "uncertain"].contains(&status) {
            return Err("invalid terminal turn state".into());
        }
        let db = self.store.connection.lock().map_err(|e| e.to_string())?;
        db.execute("UPDATE turns SET status=?1, detail=?2, updated_at_ms=?3 WHERE run_id=?4 AND status IN ('dispatching','running')", params![status, detail, now_ms(), self.run_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn observe(&self, event: &serde_json::Value) -> Result<(), String> {
        if event.get("type").and_then(|v| v.as_str()) == Some("system")
            && event.get("subtype").and_then(|v| v.as_str()) == Some("init")
        {
            if let Some(id) = event
                .get("session_id")
                .and_then(|v| v.as_str())
                .filter(|v| !v.trim().is_empty())
            {
                let db = self.store.connection.lock().map_err(|e| e.to_string())?;
                let existing: Option<String> = db
                    .query_row(
                        "SELECT provider_session_id FROM threads WHERE thread_id=?1",
                        [&self.thread_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if existing.as_deref().is_some_and(|old| old != id) {
                    return Err("provider changed the session identity during resume".into());
                }
                db.execute(
                    "UPDATE threads SET provider_session_id=?1 WHERE thread_id=?2",
                    params![id, self.thread_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        if event.get("type").and_then(|v| v.as_str()) == Some("result") {
            let success = event.get("subtype").and_then(|v| v.as_str()) == Some("success")
                && event.get("is_error").and_then(|v| v.as_bool()) != Some(true);
            self.finish(if success { "succeeded" } else { "failed" }, None)?;
        }
        Ok(())
    }
}

pub(crate) async fn io<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(new_id("blackcrab_execution_test").unwrap()))
        }
        fn open(&self) -> Arc<ExecutionStore> {
            Arc::new(ExecutionStore::open(&self.0).unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn dispatch_is_durable_and_retry_cannot_reexecute_or_change_its_payload() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        let begun = context.begin("request-a", "fix it").unwrap();
        assert!(begun.dispatch);
        assert_eq!(store.receipt("request-a").unwrap(), begun.receipt);
        assert!(!context.begin("request-a", "fix it").unwrap().dispatch);
        assert!(context.begin("request-a", "different").is_err());
        let other = store
            .context("claude", "/other", Some("session-b"))
            .unwrap();
        assert!(other.begin("request-a", "fix it").is_err());
        assert!(context.begin("next", "do more").is_err());
        context.sent("request-a").unwrap();
        context
            .observe(&serde_json::json!({"type":"result","subtype":"success"}))
            .unwrap();
        assert_eq!(store.receipt("request-a").unwrap().status, "succeeded");
        assert!(!context.begin("request-a", "fix it").unwrap().dispatch);
        assert!(context.begin("next", "do more").unwrap().dispatch);
    }

    #[test]
    fn recovery_waits_for_host_lease_and_never_redispatches() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        context.begin("request-a", "fix it").unwrap();
        context.sent("request-a").unwrap();
        let pending = store
            .context("claude", "/other", Some("session-b"))
            .unwrap();
        pending.begin("before-write", "not acknowledged").unwrap();
        let second = fixture.open();
        assert_eq!(second.receipt("request-a").unwrap().status, "running");
        drop(pending);
        drop(context);
        drop(store);
        let restarted = fixture.open();
        assert_eq!(
            restarted.receipt("before-write").unwrap().status,
            "interrupted"
        );
        let receipt = restarted.receipt("request-a").unwrap();
        assert_eq!(receipt.status, "interrupted");
        assert!(receipt.detail.unwrap().contains("review the transcript"));
        let resumed = restarted
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        assert!(!resumed.begin("request-a", "fix it").unwrap().dispatch);
        assert_eq!(resumed.thread_id, receipt.thread_id);
        assert!(
            resumed
                .begin("request-b", "new explicit action")
                .unwrap()
                .dispatch
        );
    }

    #[test]
    fn late_result_and_write_ack_cannot_change_another_run_or_terminal_state() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let old = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        old.begin("request-a", "fix it").unwrap();
        old.finish("interrupted", Some("stopped")).unwrap();
        assert_eq!(old.sent("request-a").unwrap().status, "interrupted");
        let next = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        next.begin("request-b", "next").unwrap();
        old.observe(&serde_json::json!({"type":"result","subtype":"success"}))
            .unwrap();
        assert_eq!(store.receipt("request-b").unwrap().status, "dispatching");
        next.observe(&serde_json::json!({"type":"result","subtype":"success"}))
            .unwrap();
        assert_eq!(next.sent("request-b").unwrap().status, "succeeded");
    }

    #[test]
    fn fresh_identity_binds_to_provider_history_and_failures_remain_terminal() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store.context("claude", "/project", None).unwrap();
        context.begin("request-a", "fix it").unwrap();
        context
            .observe(&serde_json::json!({"type":"system","subtype":"init","session_id":"native-a"}))
            .unwrap();
        context
            .observe(&serde_json::json!({"type":"result","subtype":"success","is_error":true}))
            .unwrap();
        let history = store.history("claude", "native-a").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].status, "failed");
        let resumed = store
            .context("claude", "/project", Some("native-a"))
            .unwrap();
        assert_eq!(resumed.thread_id, context.thread_id);
        assert!(context
            .observe(&serde_json::json!({"type":"system","subtype":"init","session_id":"wrong-id"}))
            .is_err());
        assert_eq!(store.history("claude", "native-a").unwrap().len(), 1);
    }

    #[test]
    fn concurrent_hosts_cannot_start_two_turns_in_one_thread() {
        let fixture = Fixture::new();
        let a = fixture.open();
        let b = fixture.open();
        let a = a.context("claude", "/project", Some("native-a")).unwrap();
        let b = b.context("claude", "/project", Some("native-a")).unwrap();
        assert_eq!(a.thread_id, b.thread_id);
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let a_worker = a.clone();
        let b_worker = b.clone();
        let a_ready = barrier.clone();
        let b_ready = barrier.clone();
        let first = std::thread::spawn(move || {
            a_ready.wait();
            a_worker.begin("request-a", "first")
        });
        let second = std::thread::spawn(move || {
            b_ready.wait();
            b_worker.begin("request-b", "second")
        });
        barrier.wait();
        let results = [first.join().unwrap(), second.join().unwrap()];
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        let winner = &results
            .iter()
            .find_map(|r| r.as_ref().ok())
            .unwrap()
            .receipt
            .command_id;
        let (owner, text) = if winner == "request-a" {
            (&a, "first")
        } else {
            (&b, "second")
        };
        owner
            .finish("uncertain", Some("write failed after possible delivery"))
            .unwrap();
        assert_eq!(a.store.receipt(winner).unwrap().status, "uncertain");
        assert!(!b.begin(winner, text).unwrap().dispatch);
    }

    #[test]
    fn unsupported_schema_and_corrupt_database_fail_closed() {
        let fixture = Fixture::new();
        drop(fixture.open());
        let db = Connection::open(fixture.0.join("state.sqlite3")).unwrap();
        db.execute_batch("PRAGMA user_version=99").unwrap();
        drop(db);
        assert!(ExecutionStore::open(&fixture.0)
            .err()
            .unwrap()
            .contains("newer Blackcrab"));
        std::fs::write(fixture.0.join("state.sqlite3"), b"not a database").unwrap();
        assert!(ExecutionStore::open(&fixture.0).is_err());
    }
}
