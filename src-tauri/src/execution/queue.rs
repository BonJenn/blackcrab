use super::*;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueItem {
    pub command_id: String,
    pub turn_id: String,
    pub text: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueSnapshot {
    pub thread_id: String,
    pub revision: i64,
    pub paused: bool,
    pub items: Vec<QueueItem>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum QueueChange {
    Edit {
        #[serde(rename = "commandId")]
        command_id: String,
        text: String,
    },
    Cancel {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    Reorder {
        #[serde(rename = "commandIds")]
        command_ids: Vec<String>,
    },
    Pause,
    Resume,
}

pub(crate) struct QueuedDispatch {
    pub receipt: TurnReceipt,
    pub text: String,
}

pub(super) fn migrate(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    tx.execute_batch(
        "
        CREATE TABLE queue_lanes (
            thread_id TEXT PRIMARY KEY REFERENCES threads(thread_id),
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            paused INTEGER NOT NULL CHECK(paused IN (0,1)),
            revision INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE queued_messages (
            command_id TEXT PRIMARY KEY,
            turn_id TEXT NOT NULL UNIQUE,
            thread_id TEXT NOT NULL REFERENCES queue_lanes(thread_id),
            original_prompt TEXT NOT NULL,
            prompt TEXT NOT NULL,
            position INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','cancelled','dispatched')),
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX pending_messages ON queued_messages(thread_id,status,position);
        PRAGMA user_version=2;
    ",
    )
    .map_err(|e| e.to_string())
}

pub(super) fn queued_receipt(
    db: &Connection,
    id: &str,
) -> Result<Option<(TurnReceipt, String)>, String> {
    db.query_row("SELECT q.command_id,q.thread_id,q.turn_id,CASE WHEN q.status='cancelled' THEN 'cancelled' WHEN l.paused=1 THEN 'held' ELSE 'queued' END,q.created_at_ms,q.updated_at_ms,NULL,q.original_prompt FROM queued_messages q JOIN queue_lanes l USING(thread_id) WHERE q.command_id=?1", [id], |r| Ok((row_receipt(r)?,r.get(7)?)))
        .optional().map_err(|e| e.to_string())
}

fn snapshot(db: &Connection, thread_id: &str) -> Result<QueueSnapshot, String> {
    let (revision, paused) = db
        .query_row(
            "SELECT revision,paused FROM queue_lanes WHERE thread_id=?1",
            [thread_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or((0, true));
    let mut statement = db.prepare("SELECT command_id,turn_id,prompt,created_at_ms,updated_at_ms FROM queued_messages WHERE thread_id=?1 AND status='pending' ORDER BY position,rowid").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([thread_id], |r| {
            Ok(QueueItem {
                command_id: r.get(0)?,
                turn_id: r.get(1)?,
                text: r.get(2)?,
                created_at_ms: r.get(3)?,
                updated_at_ms: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(QueueSnapshot {
        thread_id: thread_id.into(),
        revision,
        paused,
        items: rows
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?,
    })
}

impl ExecutionContext {
    pub fn queue_snapshot(&self) -> Result<QueueSnapshot, String> {
        let mut db = self.store.connection.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let result = snapshot(&tx, &self.thread_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn enqueue(&self, command_id: &str, text: &str) -> Result<TurnReceipt, String> {
        validate_message(command_id, text)?;
        let mut db = self.store.connection.lock().map_err(|e| e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        if let Some((receipt, original)) = queued_receipt(&tx, command_id)? {
            if receipt.thread_id != self.thread_id || original != text {
                return Err("command ID was already used for a different message or thread".into());
            }
            return tx
                .query_row(
                    &format!("SELECT {RECEIPT_COLUMNS} FROM turns WHERE command_id=?1"),
                    [command_id],
                    row_receipt,
                )
                .optional()
                .map_err(|e| e.to_string())
                .map(|turn| turn.unwrap_or(receipt));
        }
        let existing = tx
            .query_row(
                &format!("SELECT {RECEIPT_COLUMNS},prompt FROM turns WHERE command_id=?1"),
                [command_id],
                |r| Ok((row_receipt(r)?, r.get::<_, String>(7)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((receipt, original)) = existing {
            if receipt.thread_id != self.thread_id || original != text {
                return Err("command ID was already used for a different message or thread".into());
            }
            return Ok(receipt);
        }
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM queued_messages WHERE thread_id=?1 AND status='pending'",
                [&self.thread_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if count >= 100 {
            return Err(
                "queue is full (100 messages); remove or finish messages before adding more".into(),
            );
        }
        tx.execute(
            "INSERT OR IGNORE INTO queue_lanes(thread_id,host_id,run_id,paused) VALUES(?1,?2,?3,0)",
            params![self.thread_id, self.store.host_id, self.run_id],
        )
        .map_err(|e| e.to_string())?;
        let time = now_ms();
        tx.execute("INSERT INTO queued_messages(command_id,turn_id,thread_id,original_prompt,prompt,position,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,?4,?4,(SELECT COALESCE(MAX(position),-1)+1 FROM queued_messages WHERE thread_id=?3 AND status='pending'),'pending',?5,?5)",params![command_id,new_id("turn")?,self.thread_id,text,time]).map_err(|e|e.to_string())?;
        tx.execute(
            "UPDATE queue_lanes SET revision=revision+1 WHERE thread_id=?1",
            [&self.thread_id],
        )
        .map_err(|e| e.to_string())?;
        let receipt = queued_receipt(&tx, command_id)?
            .ok_or("missing queued receipt")?
            .0;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(receipt)
    }

    pub fn update_queue(
        &self,
        expected_revision: i64,
        change: QueueChange,
    ) -> Result<QueueSnapshot, String> {
        let mut db = self.store.connection.lock().map_err(|e| e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let current = snapshot(&tx, &self.thread_id)?;
        if current.revision != expected_revision {
            return Err("queue changed; reload it before editing".into());
        }
        if current.items.is_empty() {
            // Keep pause/resume meaningful for an existing empty lane as well.
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM queue_lanes WHERE thread_id=?1)",
                    [&self.thread_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err("queue is empty".into());
            }
        }
        match change {
            QueueChange::Edit { command_id, text } => {
                validate_message(&command_id, &text)?;
                let changed = tx.execute("UPDATE queued_messages SET prompt=?1,updated_at_ms=?2 WHERE command_id=?3 AND thread_id=?4 AND status='pending'",params![text,now_ms(),command_id,self.thread_id]).map_err(|e|e.to_string())?;
                if changed != 1 {
                    return Err("queued message already dispatched or removed".into());
                }
            }
            QueueChange::Cancel { command_id } => {
                let changed = tx.execute("UPDATE queued_messages SET status='cancelled',updated_at_ms=?1 WHERE command_id=?2 AND thread_id=?3 AND status='pending'",params![now_ms(),command_id,self.thread_id]).map_err(|e|e.to_string())?;
                if changed != 1 {
                    return Err("queued message already dispatched or removed".into());
                }
            }
            QueueChange::Reorder { command_ids } => {
                let actual: std::collections::HashSet<_> = current
                    .items
                    .iter()
                    .map(|m| m.command_id.as_str())
                    .collect();
                let desired: std::collections::HashSet<_> =
                    command_ids.iter().map(String::as_str).collect();
                if command_ids.len() != actual.len() || actual != desired {
                    return Err("reorder must contain every pending command exactly once".into());
                }
                for (position, id) in command_ids.iter().enumerate() {
                    tx.execute("UPDATE queued_messages SET position=?1 WHERE command_id=?2 AND thread_id=?3",params![position as i64,id,self.thread_id]).map_err(|e|e.to_string())?;
                }
            }
            QueueChange::Pause => {
                tx.execute(
                    "UPDATE queue_lanes SET paused=1 WHERE thread_id=?1",
                    [&self.thread_id],
                )
                .map_err(|e| e.to_string())?;
            }
            QueueChange::Resume => {
                let active: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM turns WHERE thread_id=?1 AND status IN ('dispatching','running'))",[&self.thread_id],|r|r.get(0)).map_err(|e|e.to_string())?;
                if active {
                    return Err(
                        "wait for the current turn to finish before resuming the queue".into(),
                    );
                }
                tx.execute(
                    "UPDATE queue_lanes SET paused=0,host_id=?1,run_id=?2 WHERE thread_id=?3",
                    params![self.store.host_id, self.run_id, self.thread_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.execute(
            "UPDATE queue_lanes SET revision=revision+1 WHERE thread_id=?1",
            [&self.thread_id],
        )
        .map_err(|e| e.to_string())?;
        let result = snapshot(&tx, &self.thread_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn claim_queued(&self) -> Result<Option<QueuedDispatch>, String> {
        let mut db = self.store.connection.lock().map_err(|e| e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let enabled: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM queue_lanes WHERE thread_id=?1 AND host_id=?2 AND run_id=?3 AND paused=0)",params![self.thread_id,self.store.host_id,self.run_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        let active: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM turns WHERE thread_id=?1 AND status IN ('dispatching','running'))",[&self.thread_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !enabled || active {
            return Ok(None);
        }
        let next = tx.query_row("SELECT command_id,turn_id,prompt,created_at_ms FROM queued_messages WHERE thread_id=?1 AND status='pending' ORDER BY position,rowid LIMIT 1",[&self.thread_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?))).optional().map_err(|e|e.to_string())?;
        let Some((command_id, turn_id, text, created)) = next else {
            return Ok(None);
        };
        let time = now_ms();
        tx.execute("INSERT INTO turns(turn_id,command_id,thread_id,run_id,host_id,prompt,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,?4,?5,?6,'dispatching',?7,?8)",params![turn_id,command_id,self.thread_id,self.run_id,self.store.host_id,text,created,time]).map_err(|e|e.to_string())?;
        tx.execute(
            "UPDATE queued_messages SET status='dispatched',updated_at_ms=?1 WHERE command_id=?2",
            params![time, command_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE queue_lanes SET revision=revision+1 WHERE thread_id=?1",
            [&self.thread_id],
        )
        .map_err(|e| e.to_string())?;
        let receipt = tx
            .query_row(
                &format!("SELECT {RECEIPT_COLUMNS} FROM turns WHERE command_id=?1"),
                [&command_id],
                row_receipt,
            )
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Some(QueuedDispatch { receipt, text }))
    }

    pub fn pause_owned_queue(&self) -> Result<(), String> {
        let db = self.store.connection.lock().map_err(|e| e.to_string())?;
        hold_run(&db, &self.run_id)
    }
}

pub(super) fn hold_run(db: &Connection, run_id: &str) -> Result<(), String> {
    db.execute(
        "UPDATE queue_lanes SET paused=1,revision=revision+1 WHERE run_id=?1 AND paused=0",
        [run_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

impl ExecutionStore {
    /// Confirm only a queue command with the same original payload and thread.
    /// Used after reconnect without requiring a new live process.
    pub fn confirm_queued(
        &self,
        thread_id: &str,
        command_id: &str,
        original: &str,
    ) -> Result<Option<TurnReceipt>, String> {
        let mut db = self.connection.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let turn = tx
            .query_row(
                &format!("SELECT {RECEIPT_COLUMNS} FROM turns WHERE command_id=?1"),
                [command_id],
                row_receipt,
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((queued, payload)) = queued_receipt(&tx, command_id)? else {
            return if turn.is_some() {
                Err("command ID belongs to a different command".into())
            } else {
                Ok(None)
            };
        };
        if queued.thread_id != thread_id || payload != original {
            return Err("command ID was already used for a different message or thread".into());
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Some(turn.unwrap_or(queued)))
    }

    pub fn session_for_thread(&self, thread_id: &str) -> Result<Option<String>, String> {
        let db = self.connection.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT provider_session_id FROM threads WHERE thread_id=?1 AND provider='claude'",
            [thread_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
        .map(Option::flatten)
    }

    pub fn queue_for_session(
        &self,
        provider: &str,
        session_id: &str,
    ) -> Result<Option<QueueSnapshot>, String> {
        let mut db = self.connection.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let thread: Option<String> = tx
            .query_row(
                "SELECT thread_id FROM threads WHERE provider=?1 AND provider_session_id=?2",
                params![provider, session_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let result = thread.map(|id| snapshot(&tx, &id)).transpose()?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(new_id("blackcrab_queue_test").unwrap()))
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
    fn change(context: &ExecutionContext, change: QueueChange) -> QueueSnapshot {
        context
            .update_queue(context.queue_snapshot().unwrap().revision, change)
            .unwrap()
    }

    #[test]
    fn edits_order_cancellation_and_retries_are_transactional() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        context.begin("active", "working").unwrap();
        for id in ["a", "b", "c"] {
            context.enqueue(id, id).unwrap();
        }
        store.connection.lock().unwrap().execute("UPDATE queued_messages SET created_at_ms=CASE command_id WHEN 'a' THEN 100 WHEN 'b' THEN 200 ELSE 300 END",[]).unwrap();
        let initial = context.queue_snapshot().unwrap();
        assert_eq!(initial.items.len(), 3);
        assert!(context.claim_queued().unwrap().is_none());
        context.enqueue("a", "a").unwrap();
        assert_eq!(initial.revision, context.queue_snapshot().unwrap().revision);
        let edited = change(
            &context,
            QueueChange::Edit {
                command_id: "b".into(),
                text: "edited b".into(),
            },
        );
        assert!(context
            .update_queue(
                initial.revision,
                QueueChange::Cancel {
                    command_id: "a".into()
                }
            )
            .is_err());
        assert_eq!(context.queue_snapshot().unwrap().revision, edited.revision);
        change(
            &context,
            QueueChange::Reorder {
                command_ids: vec!["b".into(), "a".into(), "c".into()],
            },
        );
        assert!(context
            .update_queue(
                context.queue_snapshot().unwrap().revision,
                QueueChange::Reorder {
                    command_ids: vec!["a".into(), "a".into(), "c".into()]
                }
            )
            .is_err());
        change(
            &context,
            QueueChange::Cancel {
                command_id: "c".into(),
            },
        );
        assert_eq!(store.receipt("c").unwrap().status, "cancelled");
        assert_eq!(context.enqueue("c", "c").unwrap().status, "cancelled");
        assert!(context.enqueue("c", "changed").is_err());
        assert!(context.begin("skip-queue", "must wait").is_err());
        context.finish("succeeded", None).unwrap();
        let first = context.claim_queued().unwrap().unwrap();
        assert_eq!(first.receipt.command_id, "b");
        assert_eq!(first.text, "edited b");
        assert_eq!(first.receipt.turn_id, initial.items[1].turn_id);
        assert_eq!(
            context.enqueue("b", "b").unwrap().turn_id,
            first.receipt.turn_id
        );
        assert!(context.claim_queued().unwrap().is_none());
        assert!(context
            .update_queue(
                context.queue_snapshot().unwrap().revision,
                QueueChange::Edit {
                    command_id: "b".into(),
                    text: "too late".into()
                }
            )
            .is_err());
        context.finish("succeeded", None).unwrap();
        assert_eq!(
            context.claim_queued().unwrap().unwrap().receipt.command_id,
            "a"
        );
        assert_eq!(
            store
                .history("claude", "session-a")
                .unwrap()
                .iter()
                .map(|r| r.command_id.as_str())
                .collect::<Vec<_>>(),
            ["active", "b", "a"]
        );
        context.enqueue("d", "after failure").unwrap();
        context.finish("failed", None).unwrap();
        assert!(context.queue_snapshot().unwrap().paused);
        assert_eq!(store.receipt("d").unwrap().status, "held");
        assert!(context.claim_queued().unwrap().is_none());
        change(&context, QueueChange::Resume);
        assert_eq!(
            context.claim_queued().unwrap().unwrap().text,
            "after failure"
        );
    }

    #[test]
    fn restart_holds_even_an_idle_queue_and_old_run_cannot_drain_a_resumed_lane() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        context.enqueue("a", "first").unwrap();
        let claimed = store
            .context("claude", "/other", Some("session-b"))
            .unwrap();
        claimed.enqueue("attempted", "possibly delivered").unwrap();
        claimed.enqueue("unattempted", "still pending").unwrap();
        claimed.claim_queued().unwrap().unwrap();
        let old_run = context.run_id.clone();
        let live_peer = fixture.open();
        assert!(
            !live_peer
                .queue_for_session("claude", "session-a")
                .unwrap()
                .unwrap()
                .paused
        );
        drop(claimed);
        drop(context);
        drop(store);
        let restarted = fixture.open();
        assert_eq!(
            restarted.receipt("attempted").unwrap().status,
            "interrupted"
        );
        let remaining = restarted
            .queue_for_session("claude", "session-b")
            .unwrap()
            .unwrap();
        assert!(remaining.paused);
        assert_eq!(
            remaining
                .items
                .iter()
                .map(|m| m.command_id.as_str())
                .collect::<Vec<_>>(),
            ["unattempted"]
        );
        let context = restarted
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        assert!(context.queue_snapshot().unwrap().paused);
        assert!(context.claim_queued().unwrap().is_none());
        change(&context, QueueChange::Resume);
        let old = ExecutionContext {
            store: restarted.clone(),
            thread_id: context.thread_id.clone(),
            run_id: old_run,
        };
        old.finish("interrupted", Some("late old stdout close"))
            .unwrap();
        assert!(!context.queue_snapshot().unwrap().paused);
        assert!(old.claim_queued().unwrap().is_none());
        assert_eq!(
            context.claim_queued().unwrap().unwrap().receipt.command_id,
            "a"
        );
        assert!(context.claim_queued().unwrap().is_none());
    }

    #[test]
    fn stop_and_interruption_hold_pending_work_until_explicit_resume() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        context.begin("active", "working").unwrap();
        context.enqueue("a", "next").unwrap();
        context.pause_owned_queue().unwrap();
        context.finish("succeeded", None).unwrap();
        assert!(context.claim_queued().unwrap().is_none());
        change(&context, QueueChange::Resume);
        context.claim_queued().unwrap().unwrap();
        context.enqueue("b", "later").unwrap();
        context.finish("uncertain", Some("broken pipe")).unwrap();
        assert!(context.queue_snapshot().unwrap().paused);
        assert!(context.claim_queued().unwrap().is_none());
        let replacement = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        assert!(replacement.claim_queued().unwrap().is_none());
        change(&replacement, QueueChange::Resume);
        assert!(context.claim_queued().unwrap().is_none());
        assert_eq!(
            replacement
                .claim_queued()
                .unwrap()
                .unwrap()
                .receipt
                .command_id,
            "b"
        );
    }

    #[test]
    fn permission_denials_hold_pending_work_even_when_the_cli_reports_success() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        context.begin("active", "working").unwrap();
        context.enqueue("next", "follow-up").unwrap();
        context.observe(&serde_json::json!({"type":"result","subtype":"success","permission_denials":[{"tool_name":"Bash"}]})).unwrap();
        let receipt = store.receipt("active").unwrap();
        assert_eq!(receipt.status, "succeeded");
        assert!(receipt.detail.unwrap().contains("review permissions"));
        assert!(context.queue_snapshot().unwrap().paused);
        assert!(context.claim_queued().unwrap().is_none());
        change(&context, QueueChange::Resume);
        assert_eq!(
            context.claim_queued().unwrap().unwrap().receipt.command_id,
            "next"
        );
    }

    #[test]
    fn simultaneous_claims_and_command_id_collisions_cannot_duplicate_dispatch() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        context.enqueue("a", "first").unwrap();
        let other = store
            .context("claude", "/other", Some("session-b"))
            .unwrap();
        assert!(other.enqueue("a", "first").is_err());
        assert!(other.begin("a", "first").is_err());
        assert!(!context.begin("a", "first").unwrap().dispatch);
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let context = context.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    context.claim_queued().unwrap().is_some()
                })
            })
            .collect();
        barrier.wait();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .filter(|claimed| *claimed)
                .count(),
            1
        );
    }

    #[test]
    fn v1_receipts_survive_migration_and_queue_reads_work_without_a_live_panel() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        let old = context.begin("legacy", "older message").unwrap().receipt;
        context.finish("succeeded", None).unwrap();
        drop(context);
        drop(store);
        let db = Connection::open(fixture.0.join("state.sqlite3")).unwrap();
        db.execute_batch(
            "DROP TABLE queued_messages; DROP TABLE queue_lanes; PRAGMA user_version=1;",
        )
        .unwrap();
        drop(db);
        let store = fixture.open();
        assert_eq!(store.receipt("legacy").unwrap().turn_id, old.turn_id);
        assert!(store
            .queue_for_session("claude", "unknown")
            .unwrap()
            .is_none());
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        context.enqueue("new", "queued").unwrap();
        context.finish("interrupted", None).unwrap();
        let queue = store
            .queue_for_session("claude", "session-a")
            .unwrap()
            .unwrap();
        assert!(queue.paused);
        assert_eq!(queue.items[0].text, "queued");
    }

    #[test]
    fn a_full_queue_accepts_retries_but_not_new_messages_until_space_is_freed() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let context = store
            .context("claude", "/project", Some("session-a"))
            .unwrap();
        for i in 0..100 {
            context.enqueue(&format!("message-{i}"), "queued").unwrap();
        }
        context.enqueue("message-0", "queued").unwrap();
        assert!(context.enqueue("extra", "queued").is_err());
        change(
            &context,
            QueueChange::Cancel {
                command_id: "message-0".into(),
            },
        );
        context.enqueue("extra", "queued").unwrap();
        assert_eq!(context.queue_snapshot().unwrap().items.len(), 100);
    }
}
