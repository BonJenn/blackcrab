//! Bounded discovery/history reads. Never creates, resumes or mutates a thread.
use crate::codex_rpc::{Client, Options, RpcError, RpcEvent};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::{process::Command, sync::Semaphore};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageRequest {
    cursor: Option<String>,
    limit: Option<u32>,
}
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Query {
    Account {},
    Models {
        page: PageRequest,
    },
    Threads {
        page: PageRequest,
        cwd: Option<String>,
        #[serde(default)]
        archived: bool,
    },
    Thread {
        thread_id: String,
    },
    Turns {
        thread_id: String,
        page: PageRequest,
        #[serde(default)]
        items_view: ItemsView,
    },
    Items {
        thread_id: String,
        turn_id: Option<String>,
        page: PageRequest,
    },
}
impl Query {
    fn wire(&self) -> Result<(&'static str, Value), String> {
        let with_page = |page: &PageRequest, mut params: Value| -> Result<Value, String> {
            let limit = page.limit.unwrap_or(50);
            if !(1..=100).contains(&limit) {
                return Err("page limit must be between 1 and 100".into());
            }
            if let Some(cursor) = &page.cursor {
                bounded(cursor, 8192, "cursor")?;
            }
            params["cursor"] = json!(page.cursor);
            params["limit"] = json!(limit);
            Ok(params)
        };
        Ok(match self {
            Self::Account {} => ("account/read", json!({"refreshToken":false})),
            Self::Models { page } => (
                "model/list",
                with_page(page, json!({"includeHidden":false}))?,
            ),
            Self::Threads {
                page,
                cwd,
                archived,
            } => {
                if let Some(cwd) = cwd {
                    bounded(cwd, 32768, "cwd")?;
                    if !std::path::Path::new(cwd).is_absolute() {
                        return Err("history cwd must be absolute".into());
                    }
                }
                (
                    "thread/list",
                    with_page(
                        page,
                        json!({"cwd":cwd,"archived":archived,"sortKey":"updated_at","sortDirection":"desc","modelProviders":[],"sourceKinds":["cli","vscode","appServer"],"useStateDbOnly":true}),
                    )?,
                )
            }
            Self::Thread { thread_id } => {
                identifier(thread_id)?;
                (
                    "thread/read",
                    json!({"threadId":thread_id,"includeTurns":false}),
                )
            }
            Self::Turns {
                thread_id,
                page,
                items_view,
            } => {
                identifier(thread_id)?;
                (
                    "thread/turns/list",
                    with_page(
                        page,
                        json!({"threadId":thread_id,"itemsView":items_view,"sortDirection":"desc"}),
                    )?,
                )
            }
            Self::Items {
                thread_id,
                turn_id,
                page,
            } => {
                identifier(thread_id)?;
                if let Some(id) = turn_id {
                    identifier(id)?;
                }
                (
                    "thread/items/list",
                    with_page(
                        page,
                        json!({"threadId":thread_id,"turnId":turn_id,"sortDirection":"asc"}),
                    )?,
                )
            }
        })
    }
}
fn bounded(value: &str, max: usize, name: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        Err(format!("invalid {name}"))
    } else {
        Ok(())
    }
}
fn identifier(value: &str) -> Result<(), String> {
    bounded(value, 256, "provider identifier")
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page<T> {
    data: Vec<T>,
    next_cursor: Option<String>,
    backwards_cursor: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Account {
    account: Option<AccountIdentity>,
    requires_openai_auth: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum AccountIdentity {
    ApiKey,
    Chatgpt {
        email: Option<String>,
        #[serde(rename = "planType")]
        plan_type: String,
        #[serde(rename = "workspaceName")]
        workspace_name: Option<String>,
    },
    AmazonBedrock,
    Gcp,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Model {
    id: String,
    model: String,
    display_name: String,
    description: String,
    hidden: bool,
    is_default: bool,
    default_reasoning_effort: String,
    supported_reasoning_efforts: Vec<ReasoningEffort>,
    #[serde(default = "default_modalities")]
    input_modalities: Vec<String>,
    #[serde(default)]
    service_tiers: Vec<ServiceTier>,
    default_service_tier: Option<String>,
}
fn default_modalities() -> Vec<String> {
    vec!["text".into(), "image".into()]
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningEffort {
    reasoning_effort: String,
    description: String,
}
#[derive(Deserialize, Serialize)]
struct ServiceTier {
    id: String,
    name: String,
    description: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Thread {
    id: String,
    name: Option<String>,
    preview: String,
    cwd: String,
    created_at: i64,
    updated_at: i64,
    model_provider: String,
    model: Option<String>,
    #[serde(default = "legacy_history")]
    history_mode: String,
    status: Value,
}
fn legacy_history() -> String {
    "legacy".into()
}
#[derive(Clone, Copy, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ItemsView {
    #[default]
    NotLoaded,
    Summary,
    Full,
}
fn full_view() -> ItemsView {
    ItemsView::Full
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Turn {
    id: String,
    status: String,
    error: Option<Value>,
    #[serde(default = "full_view")]
    items_view: ItemsView,
    items: Vec<Value>,
    started_at: Option<i64>,
    completed_at: Option<i64>,
    duration_ms: Option<i64>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    turn_id: String,
    item: Value,
    started_at_ms: Option<i64>,
    completed_at_ms: Option<i64>,
}
#[derive(Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub(crate) enum Data {
    Account(Account),
    Models(Page<Model>),
    Threads(Page<Thread>),
    Thread(Thread),
    Turns(Page<Turn>),
    Items(Page<Item>),
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reply {
    provider: &'static str,
    result: Data,
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value)
        .map_err(|_| "Codex returned an incompatible discovery/history response".into())
}
fn page<T: serde::de::DeserializeOwned>(
    value: Value,
    requested: &PageRequest,
) -> Result<Page<T>, String> {
    let result: Page<T> = decode(value)?;
    if result.data.len() > requested.limit.unwrap_or(50) as usize {
        return Err("Codex returned more rows than requested".into());
    }
    if result
        .next_cursor
        .as_ref()
        .is_some_and(|next| requested.cursor.as_ref() == Some(next))
    {
        return Err("Codex returned a non-advancing page cursor".into());
    }
    for cursor in [&result.next_cursor, &result.backwards_cursor]
        .into_iter()
        .flatten()
    {
        bounded(cursor, 8192, "response cursor")?;
    }
    Ok(result)
}
fn normalize(query: &Query, value: Value) -> Result<Reply, String> {
    let result = match query {
        Query::Account {} => Data::Account(decode(value)?),
        Query::Models { page: p } => {
            let mut result: Page<Model> = page(value, p)?;
            result.data.retain(|model| !model.hidden);
            Data::Models(result)
        }
        Query::Threads { page: p, .. } => Data::Threads(page(value, p)?),
        Query::Thread { thread_id } => {
            let thread: Thread = decode(value.get("thread").cloned().unwrap_or(Value::Null))?;
            if thread.id != *thread_id {
                return Err("Codex returned a different thread".into());
            }
            Data::Thread(thread)
        }
        Query::Turns {
            page: p,
            items_view,
            ..
        } => {
            let mut result: Page<Turn> = page(value, p)?;
            for turn in &mut result.data {
                if *items_view == ItemsView::NotLoaded {
                    turn.items.clear();
                    turn.items_view = ItemsView::NotLoaded;
                } else if turn
                    .items
                    .iter()
                    .any(|item| item.get("type").and_then(Value::as_str).is_none())
                {
                    return Err("Codex returned incompatible turn items".into());
                }
            }
            Data::Turns(result)
        }
        Query::Items {
            page: p, turn_id, ..
        } => {
            let result: Page<Item> = page(value, p)?;
            if result.data.iter().any(|entry| {
                entry.item.get("type").and_then(Value::as_str).is_none()
                    || turn_id.as_ref().is_some_and(|id| *id != entry.turn_id)
            }) {
                return Err("Codex returned incompatible history items".into());
            }
            Data::Items(result)
        }
    };
    Ok(Reply {
        provider: "codex",
        result,
    })
}

pub(crate) struct Service {
    slots: Arc<Semaphore>,
}
impl Default for Service {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(2)),
        }
    }
}
impl Service {
    pub async fn query(&self, query: Query) -> Result<Reply, String> {
        let (method, params) = query.wire()?;
        let _permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Codex discovery is busy; try again shortly")?;
        let path = crate::find_executable_in_path("codex", &crate::claude_path_env())
            .ok_or("Codex CLI is not installed or not on PATH")?;
        let mut command = Command::new(path);
        command
            .args(["app-server", "--listen", "stdio://"])
            .env("PATH", crate::claude_path_env());
        execute(command, Options::default(), &query, method, params).await
    }
}
async fn execute(
    command: Command,
    options: Options,
    query: &Query,
    method: &str,
    params: Value,
) -> Result<Reply, String> {
    let (client, mut events) = Client::connect(command, options)
        .await
        .map_err(safe_error)?;
    let result = async {
        let response = client.request(method,Some(params));
        tokio::pin!(response);
        loop {
            tokio::select! {
                biased;
                result = &mut response => return result.map_err(safe_error).and_then(|value| normalize(query,value)),
                event = events.recv() => match event {
                    Some(RpcEvent::Notification { .. }) => {},
                    Some(RpcEvent::Request { id, .. }) => {
                        let _ = client.respond(id,Err(RpcError::Remote { code:-32601,message:"Read-only discovery does not accept server requests".into(),data:None })).await;
                        return Err("Codex discovery requested an interactive action; use the CLI to configure its account".into());
                    }
                    _ => return Err("Codex discovery connection closed".into()),
                }
            }
        }
    }.await;
    client.close().await;
    result
}
fn safe_error(error: RpcError) -> String {
    match error {
        RpcError::Remote { code:-32601, .. } => "This Codex CLI does not support the requested read; update the CLI or use its history tools".into(),
        RpcError::Timeout => "Codex discovery timed out; no thread or turn was started".into(),
        _ => "Codex discovery failed; check its CLI configuration and account".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: std::path::PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(crate::execution::new_id("codex_services").unwrap());
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }
        fn command(&self, case: &str) -> Command {
            let mut command = Command::new("python3");
            command
                .arg("-u")
                .arg(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/codex_services.py"
                ))
                .arg(case)
                .arg(self.root.join("wire.jsonl"));
            command
        }
        fn rows(&self) -> Vec<Value> {
            std::fs::read_to_string(self.root.join("wire.jsonl"))
                .unwrap_or_default()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }
        async fn query(&self, case: &str, query: Query) -> Result<Value, String> {
            let (method, params) = query.wire()?;
            let reply = execute(
                self.command(case),
                Options {
                    request_timeout: std::time::Duration::from_millis(500),
                    ..Options::default()
                },
                &query,
                method,
                params,
            )
            .await?;
            Ok(serde_json::to_value(reply).unwrap())
        }
        #[cfg(unix)]
        fn reaped(&self) {
            for row in self.rows() {
                let pid = row["pid"].as_i64().unwrap() as i32;
                assert_eq!(
                    unsafe { libc::kill(pid, 0) },
                    -1,
                    "query child must be reaped"
                );
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    fn query(value: Value) -> Query {
        serde_json::from_value(value).unwrap()
    }
    #[tokio::test]
    async fn discovery_preserves_dynamic_model_choices_and_excludes_account_secrets() {
        let f = Fixture::new();
        let account = f.query("normal", Query::Account {}).await.unwrap();
        assert_eq!(account["provider"], "codex");
        assert_eq!(
            account["result"]["data"]["account"]["email"],
            "fixture@example.test"
        );
        assert!(!account.to_string().contains("SECRET"));
        let models = f
            .query("normal", query(json!({"type":"models","page":{"limit":1}})))
            .await
            .unwrap();
        assert_eq!(
            models["result"]["data"]["data"][0]["defaultReasoningEffort"],
            "future-effort"
        );
        assert_eq!(models["result"]["data"]["nextCursor"], "opaque:next");
        assert!(!models.to_string().contains("SECRET"));
        let next = f
            .query(
                "normal",
                query(json!({"type":"models","page":{"limit":1,"cursor":"opaque:next"}})),
            )
            .await
            .unwrap();
        assert!(next["result"]["data"]["nextCursor"].is_null());
        assert_eq!(
            f.rows().last().unwrap()["request"]["params"]["cursor"],
            "opaque:next"
        );
        #[cfg(unix)]
        f.reaped();
    }
    #[tokio::test]
    async fn history_reads_metadata_and_pages_without_loading_a_writer() {
        let f = Fixture::new();
        let threads = f
            .query(
                "normal",
                query(json!({"type":"threads","page":{},"cwd":"/fixture","archived":true})),
            )
            .await
            .unwrap();
        assert_eq!(
            threads["result"]["data"]["data"][0]["modelProvider"],
            "custom-provider"
        );
        assert!(!threads.to_string().contains("SECRET"));
        assert!(!threads.to_string().contains("turns"));
        let thread = f
            .query(
                "normal",
                query(json!({"type":"thread","threadId":"thread-fixture"})),
            )
            .await
            .unwrap();
        assert_eq!(thread["result"]["data"]["historyMode"], "legacy");
        let turns = f
            .query(
                "normal",
                query(json!({"type":"turns","threadId":"thread-fixture","page":{}})),
            )
            .await
            .unwrap();
        assert_eq!(turns["result"]["data"]["data"][0]["id"], "turn-fixture");
        assert!(turns["result"]["data"]["data"][0]["items"]
            .as_array()
            .unwrap()
            .is_empty());
        let full = f.query("normal",query(json!({"type":"turns","threadId":"thread-fixture","itemsView":"full","page":{"limit":1}}))).await.unwrap();
        assert_eq!(
            full["result"]["data"]["data"][0]["items"][0]["type"],
            "agentMessage"
        );
        let items = f.query("normal",query(json!({"type":"items","threadId":"thread-fixture","turnId":"turn-fixture","page":{}}))).await.unwrap();
        assert_eq!(
            items["result"]["data"]["data"][0]["item"]["type"],
            "futureItem"
        );
        for row in f.rows() {
            assert!(!["thread/start", "thread/resume", "turn/start"]
                .contains(&row["request"]["method"].as_str().unwrap_or("")));
        }
        #[cfg(unix)]
        f.reaped();
    }
    #[test]
    fn unsupported_actions_and_invalid_input_fail_before_spawning() {
        for value in [
            json!({"type":"turn/start"}),
            json!({"type":"account","refreshToken":true}),
            json!({"type":"models","page":{"unknown":true}}),
        ] {
            assert!(serde_json::from_value::<Query>(value).is_err());
        }
        for value in [
            json!({"type":"models","page":{"limit":0}}),
            json!({"type":"models","page":{"limit":101}}),
            json!({"type":"models","page":{"cursor":""}}),
            json!({"type":"thread","threadId":"bad\nID"}),
            json!({"type":"threads","page":{},"cwd":"relative"}),
        ] {
            assert!(query(value).wire().is_err());
        }
    }
    #[tokio::test]
    async fn malformed_or_foreign_history_is_rejected_without_echoing_diagnostics() {
        let f = Fixture::new();
        for case in ["bad-shape", "too-many", "unsupported"] {
            let error = f
                .query(case, query(json!({"type":"models","page":{"limit":1}})))
                .await
                .unwrap_err();
            assert!(!error.contains("SECRET"));
        }
        assert!(f
            .query(
                "wrong-thread",
                query(json!({"type":"thread","threadId":"expected"}))
            )
            .await
            .is_err());
        assert!(f
            .query(
                "wrong-turn",
                query(
                    json!({"type":"items","threadId":"expected","turnId":"turn-fixture","page":{}})
                )
            )
            .await
            .is_err());
        #[cfg(unix)]
        f.reaped();
    }
    #[tokio::test]
    async fn interactive_requests_are_rejected_and_timeouts_close_the_child() {
        let f = Fixture::new();
        assert!(f
            .query("interactive", Query::Account {})
            .await
            .unwrap_err()
            .contains("interactive"));
        assert!(f
            .query("hang", Query::Account {})
            .await
            .unwrap_err()
            .contains("timed out"));
        #[cfg(unix)]
        f.reaped();
    }
    #[tokio::test]
    async fn busy_discovery_does_not_wait_or_spawn_and_bad_input_takes_precedence() {
        let service = Service::default();
        let _first = service.slots.clone().acquire_owned().await.unwrap();
        let _second = service.slots.clone().acquire_owned().await.unwrap();
        assert!(service
            .query(Query::Account {})
            .await
            .err()
            .unwrap()
            .contains("busy"));
        assert!(service
            .query(query(json!({"type":"models","page":{"limit":101}})))
            .await
            .err()
            .unwrap()
            .contains("limit"));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancelled_read_drops_the_transport_and_reaps_its_process() {
        let f = Fixture::new();
        let command = f.command("hang");
        let task = tokio::spawn(async move {
            let query = Query::Account {};
            let (method, params) = query.wire().unwrap();
            execute(command, Options::default(), &query, method, params).await
        });
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if f.rows()
                    .iter()
                    .any(|row| row["request"]["method"] == "account/read")
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        task.abort();
        assert!(matches!(task.await, Err(error) if error.is_cancelled()));
        let pid = f.rows()[0]["pid"].as_i64().unwrap() as i32;
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        f.reaped();
    }
    #[test]
    fn response_pages_must_advance_and_account_variants_exclude_credentials() {
        let request = PageRequest {
            cursor: Some("same".into()),
            limit: Some(1),
        };
        assert!(page::<Value>(json!({"data":[],"nextCursor":"same"}), &request).is_err());
        for account in [
            Value::Null,
            json!({"type":"apiKey","apiKey":"SECRET"}),
            json!({"type":"amazonBedrock","usesCodexManagedCredentials":true,"secret":"SECRET"}),
            json!({"type":"gcp","token":"SECRET"}),
        ] {
            let reply = normalize(
                &Query::Account {},
                json!({"account":account,"requiresOpenaiAuth":false}),
            )
            .unwrap();
            assert!(!serde_json::to_string(&reply).unwrap().contains("SECRET"));
        }
    }
}
