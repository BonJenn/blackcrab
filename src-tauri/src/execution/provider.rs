//! Provider identity correlation, independent of any stream format.
use super::*;

pub(super) fn migrate(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    tx.execute_batch(
        "CREATE TABLE provider_turns (
        turn_id TEXT PRIMARY KEY REFERENCES turns(turn_id),
        thread_id TEXT NOT NULL REFERENCES threads(thread_id),
        provider_turn_id TEXT NOT NULL,
        UNIQUE(thread_id,provider_turn_id)
    ); PRAGMA user_version=3;",
    )
    .map_err(|error| error.to_string())
}
pub(crate) struct ProviderSessionLock(File);
impl Drop for ProviderSessionLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}
impl ExecutionContext {
    /// One Blackcrab runtime may own a provider thread, including while idle.
    /// The OS releases the lock on process exit, without a database lease timeout.
    pub fn lock_provider_session(&self) -> Result<ProviderSessionLock, String> {
        if !self.thread_id.starts_with("thread_")
            || !self
                .thread_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err("invalid provider thread identity".into());
        }
        let file = lock_file(
            &self
                .store
                .root
                .join(format!("{}.provider.lock", self.thread_id)),
        )?;
        file.try_lock()
            .map_err(|_| "provider session already has an open Blackcrab runtime".to_string())?;
        Ok(ProviderSessionLock(file))
    }
    pub fn bind_provider_session(&self, id: &str) -> Result<(), String> {
        if id.trim().is_empty() {
            return Err("provider session identity is empty".into());
        }
        let db = self
            .store
            .connection
            .lock()
            .map_err(|error| error.to_string())?;
        let existing: Option<String> = db
            .query_row(
                "SELECT provider_session_id FROM threads WHERE thread_id=?1",
                [&self.thread_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if existing.as_deref().is_some_and(|old| old != id) {
            return Err("provider changed the session identity during resume".into());
        }
        db.execute(
            "UPDATE threads SET provider_session_id=?1 WHERE thread_id=?2",
            params![id, self.thread_id],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }
    pub fn bind_provider_turn(
        &self,
        command_id: &str,
        provider_turn_id: &str,
    ) -> Result<TurnReceipt, String> {
        if provider_turn_id.trim().is_empty() {
            return Err("provider turn identity is empty".into());
        }
        let mut db = self
            .store
            .connection
            .lock()
            .map_err(|error| error.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let (turn_id, thread_id, run_id, status): (String, String, String, String) = tx
            .query_row(
                "SELECT turn_id,thread_id,run_id,status FROM turns WHERE command_id=?1",
                [command_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|error| error.to_string())?;
        if thread_id != self.thread_id || run_id != self.run_id {
            return Err("turn belongs to a different thread or run".into());
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT provider_turn_id FROM provider_turns WHERE turn_id=?1",
                [&turn_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(existing) = existing {
            if existing != provider_turn_id {
                return Err("provider changed the turn identity".into());
            }
        } else {
            if !["dispatching", "running"].contains(&status.as_str()) {
                return Err("cannot bind a terminal turn".into());
            }
            tx.execute(
                "INSERT INTO provider_turns(turn_id,thread_id,provider_turn_id) VALUES(?1,?2,?3)",
                params![turn_id, self.thread_id, provider_turn_id],
            )
            .map_err(|error| error.to_string())?;
        }
        tx.execute("UPDATE turns SET status='running',updated_at_ms=?1 WHERE command_id=?2 AND run_id=?3 AND status='dispatching'",params![now_ms(),command_id,self.run_id]).map_err(|error|error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        drop(db);
        self.store.receipt(command_id)
    }
    /// A late/duplicate completion cannot finish a different command in this run.
    pub fn finish_provider_turn(
        &self,
        command_id: &str,
        provider_turn_id: &str,
        status: &str,
        detail: Option<&str>,
        hold: bool,
    ) -> Result<Option<TurnReceipt>, String> {
        if !["succeeded", "failed", "interrupted", "uncertain"].contains(&status) {
            return Err("invalid terminal turn state".into());
        }
        let mut db = self
            .store
            .connection
            .lock()
            .map_err(|error| error.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed=tx.execute("UPDATE turns SET status=?1,detail=?2,updated_at_ms=?3 WHERE command_id=?4 AND thread_id=?5 AND run_id=?6 AND status IN ('dispatching','running') AND turn_id IN (SELECT turn_id FROM provider_turns WHERE thread_id=?5 AND provider_turn_id=?7)",params![status,detail,now_ms(),command_id,self.thread_id,self.run_id,provider_turn_id]).map_err(|error|error.to_string())?;
        if changed > 0 && (hold || status != "succeeded") {
            queue::hold_run(&tx, &self.run_id)?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        drop(db);
        if changed == 0 {
            Ok(None)
        } else {
            self.store.receipt(command_id).map(Some)
        }
    }
}
impl ExecutionStore {
    pub fn provider_turn_id(&self, command_id: &str) -> Result<Option<String>, String> {
        let db = self.connection.lock().map_err(|error| error.to_string())?;
        db.query_row("SELECT p.provider_turn_id FROM provider_turns p JOIN turns t USING(turn_id) WHERE t.command_id=?1",[command_id],|row|row.get(0)).optional().map_err(|error|error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn correlated_completions_cannot_finish_another_command_or_run() {
        let root = std::env::temp_dir().join(new_id("provider_identity_test").unwrap());
        let store = Arc::new(ExecutionStore::open(&root).unwrap());
        let context = store
            .context("codex", "/fixture", Some("provider-thread"))
            .unwrap();
        context.begin("a", "first").unwrap();
        context.bind_provider_turn("a", "provider-a").unwrap();
        assert!(context.bind_provider_turn("a", "changed-id").is_err());
        context
            .finish_provider_turn("a", "provider-a", "succeeded", None, false)
            .unwrap()
            .unwrap();
        context.begin("b", "second").unwrap();
        context.bind_provider_turn("b", "provider-b").unwrap();
        assert!(context
            .finish_provider_turn("a", "provider-a", "failed", None, true)
            .unwrap()
            .is_none());
        assert!(context
            .finish_provider_turn("b", "provider-a", "failed", None, true)
            .unwrap()
            .is_none());
        let other = store
            .context("codex", "/fixture", Some("provider-thread"))
            .unwrap();
        assert!(other.bind_provider_turn("b", "provider-b").is_err());
        assert!(other
            .finish_provider_turn("b", "provider-b", "failed", None, true)
            .unwrap()
            .is_none());
        assert_eq!(store.receipt("b").unwrap().status, "running");
        context
            .finish_provider_turn("b", "provider-b", "interrupted", None, true)
            .unwrap()
            .unwrap();
        assert_eq!(
            store.provider_turn_id("a").unwrap().as_deref(),
            Some("provider-a")
        );
        drop(other);
        drop(context);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn version_two_receipts_and_queues_survive_the_provider_mapping_migration() {
        let root = std::env::temp_dir().join(new_id("provider_migration_test").unwrap());
        let store = Arc::new(ExecutionStore::open(&root).unwrap());
        let context = store
            .context("claude", "/fixture", Some("legacy-session"))
            .unwrap();
        context.begin("legacy", "message").unwrap();
        context.finish("succeeded", None).unwrap();
        context.enqueue("queued", "pending").unwrap();
        context.pause_owned_queue().unwrap();
        drop(context);
        drop(store);
        let db = Connection::open(root.join("state.sqlite3")).unwrap();
        db.execute_batch("DROP TABLE provider_turns; PRAGMA user_version=2;")
            .unwrap();
        drop(db);
        let store = ExecutionStore::open(&root).unwrap();
        assert_eq!(
            store.history("claude", "legacy-session").unwrap()[0].status,
            "succeeded"
        );
        let queue = store
            .queue_for_session("claude", "legacy-session")
            .unwrap()
            .unwrap();
        assert!(queue.paused);
        assert_eq!(queue.items[0].command_id, "queued");
        assert_eq!(
            store
                .connection
                .lock()
                .unwrap()
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            3
        );
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn logical_session_ownership_ends_even_if_a_descriptor_was_duplicated() {
        let root = std::env::temp_dir().join(new_id("provider_lock_test").unwrap());
        let store = Arc::new(ExecutionStore::open(&root).unwrap());
        let context = store.context("codex", "/fixture", Some("session")).unwrap();
        let owner = context.lock_provider_session().unwrap();
        let inherited = owner.0.try_clone().unwrap();
        assert!(context.lock_provider_session().is_err());
        drop(owner);
        let replacement = context.lock_provider_session().unwrap();
        drop(inherited);
        // Closing the old duplicate cannot unlock the replacement's distinct description.
        assert!(context.lock_provider_session().is_err());
        drop(replacement);
        drop(context);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
