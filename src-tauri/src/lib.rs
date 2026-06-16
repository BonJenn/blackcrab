mod crypto;
mod pairing;
mod relay_client;
mod transport;

use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::broadcast;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::Mutex;

use crate::pairing::{
    now_unix_ms as pairing_now_ms, PairedDevice, PairingAcceptResponse, PairingService,
    PairingStartResponse, PAIRING_DEFAULT_TTL_SECS,
};
use crate::transport::{RemoteCommand, TransportEndpoint, TransportServer};

struct Session {
    child: Child,
    stdin: ChildStdin,
}

const OPEN_SETTINGS_EVENT: &str = "blackcrab-open-settings";
/// Frontend event fired when a paired phone advances a session's read cursor,
/// so the desktop window (not a transport client) can update its UI to match.
const READ_CURSOR_EVENT: &str = "blackcrab-read-cursor";
/// Frontend event fired when a paired phone asks to start a new session, so the
/// desktop creates it through its normal session machinery (panel, streaming,
/// sidebar) and the new session flows back to the phone.
const REMOTE_START_SESSION_EVENT: &str = "blackcrab-remote-start-session";
/// Frontend event fired when a paired phone messages a session that has no live
/// subprocess, so the desktop resumes it and delivers the message.
const REMOTE_RESUME_SEND_EVENT: &str = "blackcrab-remote-resume-and-send";

// Live PTY-backed terminal. The master writer is wrapped in a std Mutex
// because portable_pty's writer isn't Send+Sync-friendly for tokio's
// async Mutex, and we only ever touch it from blocking threads.
struct Terminal {
    writer: Arc<StdMutex<Box<dyn std::io::Write + Send>>>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
struct AppState {
    // Each panel gets its own claude subprocess, keyed by a frontend-supplied
    // panel_id. In single-panel mode the frontend uses the literal "main".
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    terminals: Arc<StdMutex<HashMap<String, Terminal>>>,
    // Session ownership: session_id -> panel_id that currently has a live
    // subprocess resuming it. Enforces one writer per session file so two
    // panels can't both append to the same JSONL and diverge.
    session_owners: Arc<Mutex<HashMap<String, String>>>,
}

#[derive(serde::Serialize)]
struct SessionInfo {
    id: String,
    title: String,
    cwd: String,
    mtime_ms: u128,
    message_count: usize,
    context_tokens: u64,
    context_limit: u64,
    total_cost_usd: f64,
    output_tokens: u64,
    model: String,
    permission_mode: String,
    archived: bool,
    interrupted: bool,
    last_event_type: String,
    last_result_subtype: String,
    last_result_is_error: bool,
}

#[derive(serde::Serialize)]
struct ClaudePreflight {
    installed: bool,
    authenticated: bool,
    version: String,
    path: String,
    auth_method: String,
    api_provider: String,
    error: String,
    managed_token_configured: bool,
    managed_token_active: bool,
    token_source: String,
    token_error: String,
    auth_env_conflict: bool,
    auth_needs_attention: bool,
    auth_attention_reason: String,
}

#[derive(serde::Serialize)]
struct ClaudeTokenStatus {
    configured: bool,
    source: String,
    storage_supported: bool,
    error: String,
}

fn claude_path_env() -> String {
    // Make sure spawned claude can be found even when the launching
    // environment has a minimal PATH. Cover the common install locations.
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    paths.push(PathBuf::from("/usr/local/bin"));
    paths.push(PathBuf::from("/opt/homebrew/bin"));
    if let Some(home) = std::env::var_os("HOME").and_then(|h| h.into_string().ok()) {
        let home = PathBuf::from(home);
        paths.push(home.join(".npm-global/bin"));
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".volta/bin"));
        paths.push(home.join(".bun/bin"));
        paths.push(home.join(".cargo/bin"));
    }
    std::env::join_paths(paths)
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn find_executable_in_path(name: &str, path_env: &str) -> Option<PathBuf> {
    for dir in std::env::split_paths(path_env) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let candidate = dir.join(format!("{}.exe", name));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

const BLACKCRAB_CLAUDE_TOKEN_SERVICE: &str = "Blackcrab Claude Code OAuth Token";

fn env_value_present(value: &OsStr) -> bool {
    !value.to_string_lossy().trim().is_empty()
}

fn env_var_present(name: &str) -> bool {
    std::env::var_os(name)
        .as_deref()
        .map(env_value_present)
        .unwrap_or(false)
}

fn normalize_model_name(model: &str) -> Option<String> {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_model_arg(model: Option<String>) -> Option<String> {
    model.and_then(|m| normalize_model_name(&m))
}

fn auth_env_conflict_present() -> bool {
    env_var_present("ANTHROPIC_API_KEY")
        || env_var_present("ANTHROPIC_AUTH_TOKEN")
}

fn env_oauth_token_present() -> bool {
    env_var_present("CLAUDE_CODE_OAUTH_TOKEN")
}

fn run_claude_auth_status(
    path_env: &str,
    remove_legacy_api_env: bool,
    remove_oauth_env: bool,
) -> Result<serde_json::Value, (String, String, String)> {
    use std::process::Command as StdCommand;

    let mut cmd = StdCommand::new("claude");
    cmd.args(["auth", "status", "--json"]).env("PATH", path_env);
    if remove_legacy_api_env {
        cmd.env_remove("ANTHROPIC_API_KEY");
        cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    }
    if remove_oauth_env {
        cmd.env_remove("CLAUDE_CODE_OAUTH_TOKEN");
    }

    let output = cmd.output().map_err(|e| {
        (
            e.to_string(),
            String::new(),
            "failed to run `claude auth status`".to_string(),
        )
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|e| (stdout, stderr, e.to_string()))
}

fn auth_status_logged_in(v: &serde_json::Value) -> bool {
    v.get("loggedIn")
        .and_then(|x| x.as_bool())
        .unwrap_or(false)
}

fn auth_status_method(v: &serde_json::Value) -> String {
    v.get("authMethod")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn auth_status_provider(v: &serde_json::Value) -> String {
    v.get("apiProvider")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn auth_status_uses_env_api_key(v: &serde_json::Value) -> bool {
    let method = auth_status_method(v);
    let source = v
        .get("apiKeySource")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    method == "api_key"
        && matches!(
            source.as_str(),
            "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN"
        )
}

fn auth_status_without_credential_env(path_env: &str) -> Option<serde_json::Value> {
    run_claude_auth_status(path_env, true, true).ok()
}

fn cli_auth_available_without_overrides(path_env: &str) -> bool {
    auth_status_without_credential_env(path_env)
        .as_ref()
        .map(auth_status_logged_in)
        .unwrap_or(false)
}

#[cfg(test)]
fn auth_status(
    logged_in: bool,
    method: &str,
    provider: &str,
    source: Option<&str>,
) -> serde_json::Value {
    let mut status = serde_json::json!({
        "loggedIn": logged_in,
        "authMethod": method,
        "apiProvider": provider,
    });
    if let Some(source) = source {
        status["apiKeySource"] = serde_json::Value::String(source.to_string());
    }
    status
}

struct ResolvedClaudeAuth {
    status: serde_json::Value,
    needs_attention: bool,
    attention_reason: String,
}

fn resolve_claude_auth_status(
    current: serde_json::Value,
    without_credential_env: Option<serde_json::Value>,
    managed_token_active: bool,
    auth_env_conflict: bool,
) -> ResolvedClaudeAuth {
    if !managed_token_active {
        if let Some(without_env) = without_credential_env.filter(auth_status_logged_in) {
            return ResolvedClaudeAuth {
                status: without_env,
                needs_attention: false,
                attention_reason: String::new(),
            };
        }
    }

    if managed_token_active || !auth_env_conflict || !auth_status_logged_in(&current) {
        return ResolvedClaudeAuth {
            status: current,
            needs_attention: false,
            attention_reason: String::new(),
        };
    }

    let env_auth_kind = if auth_status_uses_env_api_key(&current) {
        "an Anthropic API key"
    } else {
        "an Anthropic auth environment variable"
    };
    ResolvedClaudeAuth {
        status: current,
        needs_attention: true,
        attention_reason: format!(
            "Claude Code is currently using {}. Blackcrab cannot verify it until a session starts, and stale credentials cause 401 errors on launch. Sign in with Claude Code or save a setup token here for reliable startup.",
            env_auth_kind
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cursor(id: &str, at_ms: i64) -> ReadCursor {
        ReadCursor {
            last_read_message_id: id.to_string(),
            read_at_ms: at_ms,
        }
    }

    #[test]
    fn read_cursor_advances_from_unset() {
        assert!(cursor_should_advance(None, "msg-3", Some(2), None, 100));
    }

    #[test]
    fn read_cursor_advances_forward_by_transcript_order() {
        let current = cursor("msg-2", 100);
        // msg-5 is later in the transcript than msg-2 → advance.
        assert!(cursor_should_advance(Some(&current), "msg-5", Some(5), Some(2), 50));
    }

    #[test]
    fn read_cursor_does_not_regress_to_an_earlier_message() {
        let current = cursor("msg-5", 100);
        // msg-2 is earlier even though it carries a newer timestamp → ignore.
        assert!(!cursor_should_advance(Some(&current), "msg-2", Some(2), Some(5), 999));
    }

    #[test]
    fn read_cursor_advances_when_stored_fell_off_the_window() {
        let current = cursor("msg-old", 100);
        // Stored id is older than the loaded tail (None); new id is in it → advance.
        assert!(cursor_should_advance(Some(&current), "msg-9", Some(9), None, 50));
    }

    #[test]
    fn read_cursor_is_noop_for_same_message() {
        let current = cursor("msg-3", 100);
        assert!(!cursor_should_advance(Some(&current), "msg-3", Some(3), Some(3), 200));
    }

    #[test]
    fn read_cursor_falls_back_to_newest_when_order_unknown() {
        let current = cursor("msg-a", 100);
        assert!(cursor_should_advance(Some(&current), "msg-b", None, None, 200));
        assert!(!cursor_should_advance(Some(&current), "msg-b", None, None, 50));
    }

    #[test]
    fn prefers_cli_login_when_legacy_env_shadows_it() {
        let current = auth_status(true, "api_key", "firstParty", Some("ANTHROPIC_API_KEY"));
        let cli_login = auth_status(true, "claudeai", "firstParty", None);

        let resolved = resolve_claude_auth_status(current, Some(cli_login), false, true);

        assert!(!resolved.needs_attention);
        assert_eq!(auth_status_method(&resolved.status), "claudeai");
    }

    #[test]
    fn flags_env_auth_when_no_underlying_cli_login_exists() {
        let current = auth_status(true, "api_key", "firstParty", Some("ANTHROPIC_API_KEY"));
        let no_login = auth_status(false, "none", "firstParty", None);

        let resolved = resolve_claude_auth_status(current, Some(no_login), false, true);

        assert!(resolved.needs_attention);
        assert!(resolved.attention_reason.contains("Anthropic API key"));
        assert_eq!(auth_status_method(&resolved.status), "api_key");
    }

    #[test]
    fn active_managed_token_takes_precedence_without_attention() {
        let current = auth_status(true, "api_key", "firstParty", Some("ANTHROPIC_API_KEY"));

        let resolved = resolve_claude_auth_status(current, None, true, true);

        assert!(!resolved.needs_attention);
        assert_eq!(auth_status_method(&resolved.status), "api_key");
    }

    #[test]
    fn inactive_managed_token_prefers_cli_login_without_overrides() {
        let current = auth_status(true, "oauth_token", "firstParty", None);
        let cli_login = auth_status(true, "claudeai", "firstParty", None);

        let resolved = resolve_claude_auth_status(current, Some(cli_login), false, false);

        assert!(!resolved.needs_attention);
        assert_eq!(auth_status_method(&resolved.status), "claudeai");
    }

    #[test]
    fn missing_auth_remains_missing_without_extra_attention() {
        let current = auth_status(false, "none", "firstParty", None);

        let resolved = resolve_claude_auth_status(current, None, false, true);

        assert!(!resolved.needs_attention);
        assert!(!auth_status_logged_in(&resolved.status));
    }

    #[test]
    fn empty_auth_env_values_do_not_count_as_configured() {
        assert!(!env_value_present(OsStr::new("")));
        assert!(!env_value_present(OsStr::new("  \t  ")));
        assert!(env_value_present(OsStr::new("sk-ant-oat-real")));
    }

    #[test]
    fn model_args_are_trimmed_and_empty_values_are_ignored() {
        assert_eq!(normalize_model_arg(None), None);
        assert_eq!(normalize_model_arg(Some(String::new())), None);
        assert_eq!(normalize_model_arg(Some("  \t  ".into())), None);
        assert_eq!(
            normalize_model_arg(Some("  claude-sonnet-4-6  ".into())),
            Some("claude-sonnet-4-6".into())
        );
    }

    #[test]
    fn session_summary_ignores_blank_assistant_model_and_uses_model_usage() {
        let path = std::env::temp_dir().join(format!(
            "blackcrab-model-summary-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let content = [
            r#"{"type":"user","cwd":"/tmp/project","message":{"content":"hello"}}"#,
            r#"{"type":"assistant","message":{"model":"   ","usage":{"input_tokens":10,"output_tokens":2}}}"#,
            r#"{"type":"result","modelUsage":{"claude-haiku-4-5":{"contextWindow":200000},"claude-sonnet-4-6":{"contextWindow":1000000}}}"#,
        ]
        .join("\n");
        fs::write(&path, content).unwrap();

        let info = summarize_session(&path).unwrap();
        let _ = fs::remove_file(&path);

        assert_eq!(info.model, "claude-sonnet-4-6");
        assert_eq!(info.context_limit, 1_000_000);
    }

    #[test]
    fn api_key_source_detection_is_case_insensitive() {
        let current = auth_status(
            true,
            "api_key",
            "firstParty",
            Some("anthropic_api_key"),
        );

        let resolved = resolve_claude_auth_status(current, None, false, true);

        assert!(resolved.needs_attention);
        assert!(resolved.attention_reason.contains("Anthropic API key"));
    }

    #[tokio::test]
    async fn reserve_session_owner_rejects_competing_panel() {
        let owners = Arc::new(Mutex::new(HashMap::new()));

        let reserved = reserve_session_owner(&owners, Some("session-1"), "panel-a")
            .await
            .unwrap();
        assert_eq!(reserved.as_deref(), Some("session-1"));

        let err = reserve_session_owner(&owners, Some("session-1"), "panel-b")
            .await
            .unwrap_err();
        // The frontend keys off this exact prefix + owner panel id to drive the
        // session-conflict dialog; keep the encoding stable.
        assert_eq!(err, format!("{}panel-a — session session-1 is already open there; close it first", SESSION_BUSY_PREFIX));
        assert!(err.starts_with(SESSION_BUSY_PREFIX));

        release_session_owner_if_matches(&owners, "session-1", "panel-a").await;
        assert!(reserve_session_owner(&owners, Some("session-1"), "panel-b")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn panel_for_session_resolves_owner_and_misses_cleanly() {
        let owners = Arc::new(Mutex::new(HashMap::new()));
        owners
            .lock()
            .await
            .insert("session-1".to_string(), "panel-a".to_string());

        assert_eq!(
            panel_for_session(&owners, "session-1").await.as_deref(),
            Some("panel-a")
        );
        assert!(panel_for_session(&owners, "session-unknown").await.is_none());
    }

    #[tokio::test]
    async fn terminate_panel_releases_owned_sessions() {
        // No live subprocess to remove, but ownership must still be released so
        // a remote stop_session frees the session for a future resume.
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let owners = Arc::new(Mutex::new(HashMap::new()));
        owners
            .lock()
            .await
            .insert("session-1".to_string(), "panel-a".to_string());

        terminate_panel(&sessions, &owners, "panel-a").await;

        assert!(owners.lock().await.is_empty());
    }

    #[test]
    fn epoch_ms_to_iso8601_formats_known_instants() {
        assert_eq!(epoch_ms_to_iso8601(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            epoch_ms_to_iso8601(1_609_459_200_000),
            "2021-01-01T00:00:00.000Z"
        );
        assert_eq!(
            epoch_ms_to_iso8601(1_700_000_000_123),
            "2023-11-14T22:13:20.123Z"
        );
    }

    #[test]
    fn truncate_preview_preserves_newlines_and_clips() {
        // Line breaks are preserved so multi-line replies stay readable; only
        // the outer whitespace is trimmed.
        let (text, truncated) = truncate_preview("  hello\nworld  ");
        assert_eq!(text, "hello\nworld");
        assert!(!truncated);

        let long = "x".repeat(REMOTE_PREVIEW_MAX + 100);
        let (clipped, was_clipped) = truncate_preview(&long);
        assert!(was_clipped);
        assert!(clipped.ends_with('…'));
        assert_eq!(clipped.chars().count(), REMOTE_PREVIEW_MAX + 1);
    }

    #[test]
    fn classify_transcript_record_maps_kinds() {
        let user = serde_json::json!({
            "type": "user",
            "message": { "content": "fix the bug" }
        });
        assert_eq!(
            classify_transcript_record(&user),
            ("user_message", "fix the bug".to_string(), None)
        );

        let assistant_text = serde_json::json!({
            "type": "assistant",
            "message": { "content": [{ "type": "text", "text": "On it" }] }
        });
        assert_eq!(
            classify_transcript_record(&assistant_text),
            ("assistant_message", "On it".to_string(), None)
        );

        // Tool calls carry the tool name and its key detail (the command).
        let tool_call = serde_json::json!({
            "type": "assistant",
            "message": { "content": [{
                "type": "tool_use", "name": "Bash", "input": { "command": "npm test" }
            }] }
        });
        assert_eq!(
            classify_transcript_record(&tool_call),
            ("tool_call", "npm test".to_string(), Some("Bash".to_string()))
        );

        let tool_result = serde_json::json!({
            "type": "user",
            "message": { "content": [{ "type": "tool_result", "content": "ok" }] }
        });
        let (kind, text, _) = classify_transcript_record(&tool_result);
        assert_eq!(kind, "tool_result");
        assert_eq!(text, "ok");

        let result = serde_json::json!({ "type": "result", "subtype": "success" });
        assert_eq!(classify_transcript_record(&result).0, "system_notice");
    }

    #[test]
    fn approval_kind_and_summary_map_tools() {
        assert_eq!(approval_kind_for_tool("Bash"), "shell_command");
        assert_eq!(approval_kind_for_tool("Edit"), "file_write");
        assert_eq!(approval_kind_for_tool("WebFetch"), "network_request");
        assert_eq!(approval_kind_for_tool("Grep"), "tool_call");

        let input = serde_json::json!({ "command": "npm test" });
        assert_eq!(approval_summary("Bash", &input), "Bash: npm test");
        assert_eq!(
            approval_summary("Read", &serde_json::json!({})),
            "Read".to_string()
        );
    }

    #[tokio::test]
    async fn deliver_user_message_errors_without_a_session() {
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let err = deliver_user_message(&sessions, "panel-a", "hi")
            .await
            .unwrap_err();
        assert!(err.contains("no active session"));
    }

    #[test]
    fn extract_session_override_skips_files_without_restorable_metadata() {
        let dir = std::env::temp_dir().join(format!(
            "blackcrab-override-test-{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&dir);

        // No custom-title / archive-state records → nothing to restore.
        let plain = dir.join("plain.jsonl");
        fs::write(&plain, "{\"type\":\"user\",\"cwd\":\"/tmp/x\"}\n").unwrap();
        assert!(extract_session_override(&plain).is_none());

        // A custom title plus archived state → captured, with cwd resolved.
        let rich = dir.join("rich.jsonl");
        fs::write(
            &rich,
            "{\"type\":\"user\",\"cwd\":\"/tmp/proj\"}\n\
             {\"type\":\"custom-title\",\"customTitle\":\"Renamed\"}\n\
             {\"type\":\"archive-state\",\"archived\":true}\n",
        )
        .unwrap();
        let over = extract_session_override(&rich).expect("override present");
        assert_eq!(over.id, "rich");
        assert_eq!(over.cwd, "/tmp/proj");
        assert_eq!(over.custom_title.as_deref(), Some("Renamed"));
        assert!(over.archived);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn session_path_rejects_unsafe_session_ids_and_separators() {
        let projects = PathBuf::from("projects");
        let path = session_path_under_projects(&projects, "abc-123_DEF", "/Users/me/project")
            .expect("safe session path");

        assert_eq!(
            path,
            projects
                .join("-Users-me-project")
                .join("abc-123_DEF.jsonl")
        );
        assert!(session_path_under_projects(&projects, "../escape", "/Users/me").is_none());
        assert!(session_path_under_projects(&projects, "nested/path", "/Users/me").is_none());
        assert!(session_path_under_projects(&projects, "nested\\path", "/Users/me").is_none());
        assert_eq!(encode_cwd(r"C:\Users\me\project"), "C:-Users-me-project");
    }

    #[test]
    fn custom_title_normalization_trims_rejects_newlines_and_caps_length() {
        assert_eq!(normalize_custom_title("  hello  ").unwrap(), "hello");
        assert!(normalize_custom_title("   ").is_err());
        assert!(normalize_custom_title("hello\nworld").is_err());

        let long = "x".repeat(MAX_CUSTOM_TITLE_CHARS + 10);
        assert_eq!(
            normalize_custom_title(&long).unwrap().chars().count(),
            MAX_CUSTOM_TITLE_CHARS
        );
    }
}

#[cfg(target_os = "macos")]
fn keychain_account() -> String {
    std::env::var("USER").unwrap_or_else(|_| "default".to_string())
}

#[cfg(target_os = "macos")]
fn read_blackcrab_claude_token() -> Result<Option<String>, String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            BLACKCRAB_CLAUDE_TOKEN_SERVICE,
            "-a",
            &keychain_account(),
            "-w",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let token = String::from_utf8(output.stdout)
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    if token.is_empty() {
        Ok(None)
    } else {
        Ok(Some(token))
    }
}

#[cfg(not(target_os = "macos"))]
fn read_blackcrab_claude_token() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn write_blackcrab_claude_token(token: &str) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            BLACKCRAB_CLAUDE_TOKEN_SERVICE,
            "-a",
            &keychain_account(),
            "-w",
            token,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn write_blackcrab_claude_token(_token: &str) -> Result<(), String> {
    Err("Blackcrab-managed token storage is currently only supported on macOS".into())
}

#[cfg(target_os = "macos")]
fn delete_blackcrab_claude_token() -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-s",
            BLACKCRAB_CLAUDE_TOKEN_SERVICE,
            "-a",
            &keychain_account(),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("could not be found") || stderr.contains("not found") {
            return Ok(());
        }
        return Err(stderr.trim().to_string());
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn delete_blackcrab_claude_token() -> Result<(), String> {
    Ok(())
}

const BLACKCRAB_RELAY_TOKEN_SERVICE: &str = "Blackcrab Relay Token";

#[cfg(target_os = "macos")]
fn read_relay_token() -> Result<Option<String>, String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            BLACKCRAB_RELAY_TOKEN_SERVICE,
            "-a",
            &keychain_account(),
            "-w",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let token = String::from_utf8(output.stdout)
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    if token.is_empty() {
        Ok(None)
    } else {
        Ok(Some(token))
    }
}

#[cfg(not(target_os = "macos"))]
fn read_relay_token() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn write_relay_token(token: &str) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            BLACKCRAB_RELAY_TOKEN_SERVICE,
            "-a",
            &keychain_account(),
            "-w",
            token,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn write_relay_token(_token: &str) -> Result<(), String> {
    Err("Blackcrab-managed token storage is currently only supported on macOS".into())
}

#[cfg(target_os = "macos")]
fn delete_relay_token() -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-s",
            BLACKCRAB_RELAY_TOKEN_SERVICE,
            "-a",
            &keychain_account(),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("could not be found") || stderr.contains("not found") {
            return Ok(());
        }
        return Err(stderr.trim().to_string());
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn delete_relay_token() -> Result<(), String> {
    Ok(())
}

/// Path to the persisted relay URL config (`~/.blackcrab/relay.json`). The
/// URL is non-secret; the token lives in the keychain.
fn relay_url_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".blackcrab").join("relay.json"))
}

/// Read the persisted relay URL, if any. Returns `None` when unset or unreadable.
fn read_relay_url_config() -> Option<String> {
    let path = relay_url_config_path()?;
    let data = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    let url = value.get("url")?.as_str()?.trim();
    if url.is_empty() {
        None
    } else {
        Some(url.to_string())
    }
}

/// Persist the relay URL to `~/.blackcrab/relay.json` (owner-only on Unix).
fn write_relay_url_config(url: &str) -> Result<(), String> {
    let path = relay_url_config_path().ok_or_else(|| "HOME not set".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string_pretty(&serde_json::json!({ "url": url }))
        .map_err(|e| e.to_string())?;
    write_relay_config_owner_only(&path, json.as_bytes())
        .map_err(|e| format!("write {}: {}", path.display(), e))
}

#[cfg(unix)]
fn write_relay_config_owner_only(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(data)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_relay_config_owner_only(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, data)
}

fn claude_token_state() -> ClaudeTokenStatus {
    let env_configured = env_oauth_token_present();
    match read_blackcrab_claude_token() {
        Ok(Some(_)) => ClaudeTokenStatus {
            configured: true,
            source: "keychain".into(),
            storage_supported: cfg!(target_os = "macos"),
            error: String::new(),
        },
        Ok(None) if env_configured => ClaudeTokenStatus {
            configured: true,
            source: "environment".into(),
            storage_supported: cfg!(target_os = "macos"),
            error: String::new(),
        },
        Ok(None) => ClaudeTokenStatus {
            configured: false,
            source: "none".into(),
            storage_supported: cfg!(target_os = "macos"),
            error: String::new(),
        },
        Err(e) if env_configured => ClaudeTokenStatus {
            configured: true,
            source: "environment".into(),
            storage_supported: cfg!(target_os = "macos"),
            error: e,
        },
        Err(e) => ClaudeTokenStatus {
            configured: false,
            source: "none".into(),
            storage_supported: cfg!(target_os = "macos"),
            error: e,
        },
    }
}

#[tauri::command]
fn claude_token_status() -> ClaudeTokenStatus {
    claude_token_state()
}

#[tauri::command]
fn save_claude_oauth_token(token: String) -> Result<ClaudeTokenStatus, String> {
    let token = token.trim();
    if token.len() < 40 || !token.starts_with("sk-ant-") {
        return Err("Paste the token printed by `claude setup-token`.".into());
    }

    write_blackcrab_claude_token(token)?;
    Ok(claude_token_state())
}

#[tauri::command]
fn clear_claude_oauth_token() -> Result<ClaudeTokenStatus, String> {
    delete_blackcrab_claude_token()?;
    Ok(claude_token_state())
}

#[tauri::command]
fn claude_preflight() -> ClaudePreflight {
    use std::process::Command as StdCommand;
    let path_env = claude_path_env();
    let token_status = claude_token_state();
    let managed_token_configured = token_status.configured;
    let token_source = token_status.source.clone();
    let token_error = token_status.error.clone();
    let auth_env_conflict = auth_env_conflict_present();
    let cli_path = find_executable_in_path("claude", &path_env)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let version_output = StdCommand::new("claude")
        .arg("--version")
        .env("PATH", &path_env)
        .output();
    let Ok(version_output) = version_output else {
        return ClaudePreflight {
            installed: false,
            authenticated: false,
            version: String::new(),
            path: cli_path,
            auth_method: String::new(),
            api_provider: String::new(),
            error: "Claude Code CLI was not found on PATH".into(),
            managed_token_configured,
            managed_token_active: false,
            token_source,
            token_error,
            auth_env_conflict,
            auth_needs_attention: false,
            auth_attention_reason: String::new(),
        };
    };
    let version = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();

    let auth_status = run_claude_auth_status(&path_env, false, false);
    let Ok(v) = auth_status else {
        return ClaudePreflight {
            installed: true,
            authenticated: managed_token_configured,
            version,
            path: cli_path,
            auth_method: if managed_token_configured {
                "blackcrab-token".into()
            } else {
                String::new()
            },
            api_provider: String::new(),
            error: if managed_token_configured {
                String::new()
            } else {
                "failed to run `claude auth status`".into()
            },
            managed_token_configured,
            managed_token_active: managed_token_configured,
            token_source,
            token_error,
            auth_env_conflict,
            auth_needs_attention: false,
            auth_attention_reason: String::new(),
        };
    };

    let without_credential_env = if managed_token_configured
        || auth_env_conflict
        || env_oauth_token_present()
    {
        auth_status_without_credential_env(&path_env)
    } else {
        None
    };
    let cli_without_overrides = without_credential_env
        .as_ref()
        .map(auth_status_logged_in)
        .unwrap_or(false);
    let managed_token_active = managed_token_configured && !cli_without_overrides;
    let resolved = resolve_claude_auth_status(
        v,
        without_credential_env,
        managed_token_active,
        auth_env_conflict,
    );
    let v = resolved.status;

    let cli_authenticated = auth_status_logged_in(&v);
    let cli_auth_method = auth_status_method(&v);
    ClaudePreflight {
        installed: true,
        authenticated: cli_authenticated || managed_token_active,
        version,
        path: cli_path,
        auth_method: if managed_token_active {
            "blackcrab-token".into()
        } else if cli_authenticated {
            cli_auth_method
        } else {
            auth_status_method(&v)
        },
        api_provider: auth_status_provider(&v),
        error: String::new(),
        managed_token_configured,
        managed_token_active,
        token_source,
        token_error,
        auth_env_conflict,
        auth_needs_attention: resolved.needs_attention,
        auth_attention_reason: resolved.attention_reason,
    }
}

fn context_limit_for(model: &str, max_observed: u64) -> u64 {
    // If the session ever exceeded the 200k envelope, it must be on 1M.
    if max_observed > 200_000 {
        return 1_000_000;
    }
    if model.contains("1m") || model.contains("[1m]") {
        return 1_000_000;
    }
    200_000
}

fn encode_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c == '/' || c == '\\' { '-' } else { c })
        .collect()
}

fn projects_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".claude").join("projects"))
}

async fn release_panel_session_owners(
    owners: &Arc<Mutex<HashMap<String, String>>>,
    panel_id: &str,
) {
    let mut owners = owners.lock().await;
    owners.retain(|_, owner| owner != panel_id);
}

async fn release_session_owner_if_matches(
    owners: &Arc<Mutex<HashMap<String, String>>>,
    session_id: &str,
    panel_id: &str,
) {
    let mut owners = owners.lock().await;
    if owners
        .get(session_id)
        .map(|owner| owner == panel_id)
        .unwrap_or(false)
    {
        owners.remove(session_id);
    }
}

/// Stable, machine-readable prefix for the single-writer conflict error. The
/// frontend matches on this to distinguish a busy-session rejection from any
/// other start failure and to recover the owning panel id, rather than parsing
/// the human-readable tail. Format: `SESSION_BUSY:{owner_panel_id}`.
const SESSION_BUSY_PREFIX: &str = "SESSION_BUSY:";

async fn reserve_session_owner(
    owners: &Arc<Mutex<HashMap<String, String>>>,
    session_id: Option<&str>,
    panel_id: &str,
) -> Result<Option<String>, String> {
    let Some(session_id) = session_id else {
        return Ok(None);
    };
    let mut owners = owners.lock().await;
    if let Some(other) = owners.get(session_id) {
        if other != panel_id {
            return Err(format!(
                "{}{} — session {} is already open there; close it first",
                SESSION_BUSY_PREFIX, other, session_id
            ));
        }
    }
    owners.insert(session_id.to_string(), panel_id.to_string());
    Ok(Some(session_id.to_string()))
}

#[tauri::command]
async fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    panel_id: String,
    cwd: String,
    permission_mode: Option<String>,
    model: Option<String>,
    resume_id: Option<String>,
    use_worktree: Option<bool>,
) -> Result<(), String> {
    let resume_id = resume_id.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    let mut guard = state.sessions.lock().await;
    if let Some(mut s) = guard.remove(&panel_id) {
        let _ = s.child.start_kill();
    }
    release_panel_session_owners(&state.session_owners, &panel_id).await;

    let mode = permission_mode.unwrap_or_else(|| "bypassPermissions".to_string());

    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg("--input-format").arg("stream-json")
        .arg("--output-format").arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .arg("--permission-mode").arg(&mode);

    // The CLI has a second security layer separate from --permission-mode:
    // a directory sandbox that limits which paths tools can touch. By
    // default that's just the cwd, which blocks cross-project access. We
    // extend it based on the caller's intent:
    //   - bypassPermissions: the user opted into "let claude do anything",
    //     so we pass `--add-dir /` to remove the dir sandbox entirely.
    //     Otherwise an "allow & retry" from a denial overlay wouldn't
    //     actually unblock system paths like /etc or /tmp.
    //   - any other mode: cover the whole home dir, which is where work
    //     typically lives.
    if mode == "bypassPermissions" {
        cmd.arg("--add-dir").arg("/");
    } else if let Some(home) =
        std::env::var_os("HOME").and_then(|h| h.into_string().ok())
    {
        cmd.arg("--add-dir").arg(home);
    }

    let is_resume = resume_id.is_some();

    // Pin the requested model only for fresh sessions. On --resume we omit
    // --model: the conversation is restored on the user's current default
    // model, and forcing the session's *historical* model id breaks resume
    // once that model has been retired — the CLI rejects it with "the selected
    // model may not exist". (Claude Code's normal resume doesn't pass --model.)
    if !is_resume {
        if let Some(m) = normalize_model_arg(model) {
            cmd.arg("--model").arg(m);
        }
    }

    if let Some(rid) = resume_id.as_deref() {
        cmd.arg("--resume").arg(rid);
    }

    // When the caller asks for an isolated worktree, delegate the
    // worktree creation to the claude CLI itself (it handles the
    // `git worktree add`, places the session inside the new dir, and
    // records the path in its own session metadata). Skipped on
    // --resume since the worktree was already created on first spawn,
    // and skipped silently if the cwd isn't a git repo (claude would
    // otherwise bail out and kill the session with a broken pipe).
    if use_worktree.unwrap_or(false) && !is_resume {
        let dot_git = std::path::Path::new(&cwd).join(".git");
        if dot_git.exists() {
            cmd.arg("--worktree");
        }
    }

    // Bail early with a clear error if the cwd doesn't exist — otherwise
    // spawn fails with a bare ENOENT that looks identical to the binary
    // not being found. Important not to silently swap in $HOME: for a
    // --resume, claude resolves the session file relative to the cwd's
    // project folder, so the wrong cwd would trigger error_during_execution
    // far from the actual source of the problem.
    if cwd.is_empty() || !std::path::Path::new(&cwd).is_dir() {
        return Err(format!(
            "project directory doesn't exist: {} — pick a new cwd or remove this session",
            if cwd.is_empty() { "(none)" } else { cwd.as_str() }
        ));
    }
    cmd.current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let path_env = claude_path_env();
    cmd.env("PATH", &path_env);

    let keychain_token = read_blackcrab_claude_token().ok().flatten();
    let has_auth_override = keychain_token.is_some()
        || env_oauth_token_present()
        || auth_env_conflict_present();

    // Prefer the normal Claude Code login whenever it is available without
    // credential override env vars. `claude auth status` reports "loggedIn"
    // even for stale API/OAuth tokens, so stale overrides must not shadow a
    // healthy local CLI login.
    if has_auth_override && cli_auth_available_without_overrides(&path_env) {
        cmd.env_remove("CLAUDE_CODE_OAUTH_TOKEN");
        cmd.env_remove("ANTHROPIC_API_KEY");
        cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    } else if let Some(token) = keychain_token {
        cmd.env("CLAUDE_CODE_OAUTH_TOKEN", token);
        cmd.env_remove("ANTHROPIC_API_KEY");
        cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    } else if env_oauth_token_present() {
        cmd.env_remove("ANTHROPIC_API_KEY");
        cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    }

    // Reserve known resumed sessions before spawning the child. Otherwise two
    // panels can both pass the initial owner check and race until stdout emits
    // the first session_id, leaving two writers on the same JSONL.
    let reserved_session_id =
        reserve_session_owner(&state.session_owners, resume_id.as_deref(), &panel_id).await?;

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            if let Some(session_id) = reserved_session_id.as_deref() {
                release_session_owner_if_matches(&state.session_owners, session_id, &panel_id)
                    .await;
            }
            return Err(format!("failed to spawn claude: {}", e));
        }
    };
    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.start_kill();
            if let Some(session_id) = reserved_session_id.as_deref() {
                release_session_owner_if_matches(&state.session_owners, session_id, &panel_id)
                    .await;
            }
            return Err("no stdin handle".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.start_kill();
            if let Some(session_id) = reserved_session_id.as_deref() {
                release_session_owner_if_matches(&state.session_owners, session_id, &panel_id)
                    .await;
            }
            return Err("no stdout handle".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.start_kill();
            if let Some(session_id) = reserved_session_id.as_deref() {
                release_session_owner_if_matches(&state.session_owners, session_id, &panel_id)
                    .await;
            }
            return Err("no stderr handle".to_string());
        }
    };

    let app_out = app.clone();
    let pid_out = panel_id.clone();
    let owners_out = state.session_owners.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut claimed: Option<String> = reserved_session_id;
        while let Ok(Some(line)) = lines.next_line().await {
            // When this turn completes, push the focused session's transcript to
            // paired phones immediately rather than letting them wait for the
            // next heartbeat (up to PING_INTERVAL late). Only push when this
            // subprocess drives the focused session, so a background session
            // finishing doesn't trigger a needless rebuild/re-push.
            if line.contains("\"type\":\"result\"")
                && claimed.is_some()
                && claimed == focused_session_id()
            {
                if let Some(ev) = remote_transcript_event_value() {
                    push_remote_event(ev);
                }
            }
            // Claim ownership of the session id on the first init event
            // that carries one. Cheap substring check before a full JSON
            // parse — session_id only appears on a handful of event types.
            if line.contains("\"session_id\"") {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(sid) = v.get("session_id").and_then(|x| x.as_str()) {
                        if claimed.as_deref() == Some(sid) {
                            let _ = app_out.emit(
                                "claude-event",
                                serde_json::json!({ "panel_id": pid_out, "line": line }),
                            );
                            continue;
                        }
                        let mut owners = owners_out.lock().await;
                        if let Some(other) = owners.get(sid) {
                            if other != &pid_out {
                                let _ = app_out.emit(
                                    "claude-stderr",
                                    serde_json::json!({
                                        "panel_id": pid_out,
                                        "line": format!(
                                            "session {} is already open in panel {}; refusing to overwrite owner",
                                            sid, other
                                        ),
                                    }),
                                );
                            }
                        } else {
                            owners.insert(sid.to_string(), pid_out.clone());
                            claimed = Some(sid.to_string());
                        }
                    }
                }
            }
            // Surface permission prompts to any paired phone.
            register_remote_approval(&pid_out, claimed.as_deref(), &line);
            let _ = app_out.emit(
                "claude-event",
                serde_json::json!({ "panel_id": pid_out, "line": line }),
            );
        }
        // Release ownership once the subprocess's stdout closes (claude
        // has exited). If another panel had already stolen the claim,
        // only drop it if it still points at us.
        if let Some(sid) = claimed {
            let mut owners = owners_out.lock().await;
            if owners.get(&sid).map(|p| p == &pid_out).unwrap_or(false) {
                owners.remove(&sid);
            }
        }
        let _ = app_out.emit("claude-done", serde_json::json!({ "panel_id": pid_out }));
    });

    let app_err = app.clone();
    let pid_err = panel_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit(
                "claude-stderr",
                serde_json::json!({ "panel_id": pid_err, "line": line }),
            );
        }
    });

    guard.insert(panel_id, Session { child, stdin });
    Ok(())
}

/// Write a user message to a panel's claude subprocess. Shared by the
/// `send_message` Tauri command and the remote-action consumer so both paths
/// frame the message identically.
async fn deliver_user_message(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    panel_id: &str,
    text: &str,
) -> Result<(), String> {
    let mut guard = sessions.lock().await;
    let session = guard
        .get_mut(panel_id)
        .ok_or_else(|| format!("no active session for panel {}", panel_id))?;
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": text }
    });
    let line = format!("{}\n", msg);
    session
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    session.stdin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Kill a panel's subprocess and release any session it owned. Shared by the
/// `stop_session` Tauri command and the remote-action consumer.
async fn terminate_panel(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    session_owners: &Arc<Mutex<HashMap<String, String>>>,
    panel_id: &str,
) {
    {
        let mut guard = sessions.lock().await;
        if let Some(mut s) = guard.remove(panel_id) {
            let _ = s.child.start_kill();
        }
    }
    let mut owners = session_owners.lock().await;
    owners.retain(|_, owner| owner != panel_id);
}

/// Resolve the Claude session id a remote action targets to the panel that
/// currently owns its live subprocess. Returns `None` when no panel is
/// resuming that session (nothing to act on).
async fn panel_for_session(
    session_owners: &Arc<Mutex<HashMap<String, String>>>,
    session_id: &str,
) -> Option<String> {
    session_owners.lock().await.get(session_id).cloned()
}

#[tauri::command]
async fn send_message(
    state: State<'_, AppState>,
    panel_id: String,
    text: String,
) -> Result<(), String> {
    deliver_user_message(&state.sessions, &panel_id, &text).await
}

/// Write an arbitrary (already-framed) line to a panel's subprocess stdin.
/// Shared by the `send_raw` command and the remote approval consumer.
async fn deliver_raw_line(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    panel_id: &str,
    line: &str,
) -> Result<(), String> {
    let mut guard = sessions.lock().await;
    let session = guard
        .get_mut(panel_id)
        .ok_or_else(|| format!("no active session for panel {}", panel_id))?;
    let body = if line.ends_with('\n') {
        line.to_string()
    } else {
        format!("{}\n", line)
    };
    session
        .stdin
        .write_all(body.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    session.stdin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Writes an arbitrary JSON line to the panel's subprocess stdin. Used
/// for control_response (answering Claude's permission prompts) and for
/// control_request (e.g. mid-session set_permission_mode changes).
#[tauri::command]
async fn send_raw(
    state: State<'_, AppState>,
    panel_id: String,
    line: String,
) -> Result<(), String> {
    deliver_raw_line(&state.sessions, &panel_id, &line).await?;
    // If the desktop just answered a permission prompt, drop it from the
    // remote registry and tell paired phones so their list stays in sync.
    note_local_control_response(&line);
    Ok(())
}

// Writes arbitrary UTF-8 text to the given path. Used by the
// "export session as markdown" action so we don't have to pull in
// plugin-fs just for one write.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("write failed: {}", e))
}

// Reads arbitrary UTF-8 text from the given path. Symmetric to
// `write_text_file`; used by Backup & Restore to load a user-chosen backup
// file on import without pulling in plugin-fs.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))
}

// Saves bytes from a web-drop — an in-browser File blob that the OS
// never handed us a native filesystem path for (screenshots from a
// menu bar app, images dragged from a webpage, etc.) — into a temp
// file and returns its full path. The caller then attaches the path
// to the chat message the same way a real filesystem drop does.
#[tauri::command]
fn save_dropped_file(name: String, bytes: Vec<u8>) -> Result<String, String> {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let fallback = if safe_name.trim().is_empty() {
        "dropped.bin".to_string()
    } else {
        safe_name
    };
    // Short time-based prefix so the same name dropped twice doesn't
    // clobber the first copy.
    let prefix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join("blackcrab-drops");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir temp: {}", e))?;
    let path = dir.join(format!("{:x}-{}", prefix, fallback));
    let mut file = std::fs::File::create(&path).map_err(|e| format!("create: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("write: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn terminal_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    terminal_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use portable_pty::{CommandBuilder, PtySize, native_pty_system};
    // If this id already exists, kill the old one first so the
    // frontend can hot-reload without leaking subprocesses.
    {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        if let Some(mut old) = terms.remove(&terminal_id) {
            let _ = old.child.kill();
        }
    }
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(&shell);
    // Interactive login-ish shell so the user's PATH/aliases load.
    cmd.arg("-l");
    let effective_cwd = if !cwd.is_empty() && std::path::Path::new(&cwd).is_dir() {
        cwd
    } else {
        std::env::var("HOME").unwrap_or_else(|_| "/".into())
    };
    cmd.cwd(&effective_cwd);
    // Encourage color + dumb-terminal-friendly output from most CLIs.
    cmd.env("TERM", "xterm-256color");
    if let Ok(lang) = std::env::var("LANG") {
        cmd.env("LANG", lang);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {}", e))?;

    // Detach the slave end so it can be closed by the child; we only
    // hold the master side for IO.
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {}", e))?;

    // Spawn a blocking reader thread that forwards bytes as `terminal-output`
    // events to the frontend.
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader failed: {}", e))?;
    let id_for_thread = terminal_id.clone();
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_for_thread.emit(
                        "terminal-output",
                        serde_json::json!({
                            "terminal_id": id_for_thread,
                            "data": chunk,
                        }),
                    );
                }
                Err(e) => {
                    let _ = app_for_thread.emit(
                        "terminal-error",
                        serde_json::json!({
                            "terminal_id": id_for_thread,
                            "error": e.to_string(),
                        }),
                    );
                    break;
                }
            }
        }
        let _ = app_for_thread.emit(
            "terminal-exit",
            serde_json::json!({ "terminal_id": id_for_thread }),
        );
    });

    let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
    terms.insert(
        terminal_id,
        Terminal {
            writer: Arc::new(StdMutex::new(writer)),
            master: pair.master,
            child,
        },
    );
    Ok(())
}

#[tauri::command]
fn terminal_write(
    state: State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let terms = state.terminals.lock().map_err(|e| e.to_string())?;
    let term = terms
        .get(&terminal_id)
        .ok_or_else(|| format!("no terminal {}", terminal_id))?;
    let mut writer = term.writer.lock().map_err(|e| e.to_string())?;
    use std::io::Write;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {}", e))?;
    writer.flush().ok();
    Ok(())
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, AppState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use portable_pty::PtySize;
    let terms = state.terminals.lock().map_err(|e| e.to_string())?;
    let term = terms
        .get(&terminal_id)
        .ok_or_else(|| format!("no terminal {}", terminal_id))?;
    term.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn terminal_kill(state: State<'_, AppState>, terminal_id: String) -> Result<(), String> {
    let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
    if let Some(mut t) = terms.remove(&terminal_id) {
        let _ = t.child.kill();
    }
    Ok(())
}

// List tracked (and new, non-ignored) files under `cwd` via
// `git ls-files`. Empty vec when the dir isn't a git repo — the UI
// just shows no suggestions in that case.
#[tauri::command]
fn list_tracked_files(cwd: String) -> Result<Vec<String>, String> {
    if cwd.is_empty() || !std::path::Path::new(&cwd).is_dir() {
        return Ok(Vec::new());
    }
    use std::process::Command as StdCommand;
    let output = StdCommand::new("git")
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "--full-name",
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("git ls-files failed: {}", e))?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut paths: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    // Dedup in case ls-files returns duplicates for some reason, keep
    // stable ordering (git already orders by path lexicographically).
    paths.dedup();
    Ok(paths)
}

#[tauri::command]
async fn stop_session(state: State<'_, AppState>, panel_id: String) -> Result<(), String> {
    // The stdout-reader's own cleanup already drops ownership once
    // claude's stdout closes, but killing via start_kill races that
    // close so we release eagerly here too to unblock the next
    // start_session for the same sid.
    terminate_panel(&state.sessions, &state.session_owners, &panel_id).await;
    Ok(())
}

#[tauri::command]
async fn interrupt_session(state: State<'_, AppState>, panel_id: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        let guard = state.sessions.lock().await;
        if let Some(s) = guard.get(&panel_id) {
            if let Some(pid) = s.child.id() {
                unsafe {
                    libc::kill(pid as i32, libc::SIGINT);
                }
            }
        }
    }

    #[cfg(windows)]
    {
        let mut guard = state.sessions.lock().await;
        if let Some(s) = guard.get_mut(&panel_id) {
            s.stdin
                .write_all(&[0x03])
                .await
                .map_err(|e| format!("failed to write interrupt to session: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
fn default_cwd() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

/// Returns the "owner/repo" slug for the git repo at `cwd`, or an empty
/// string if it isn't a GitHub remote. Used to linkify PR references in
/// chat markdown.
#[tauri::command]
fn git_remote_url(cwd: String) -> String {
    use std::process::Command;
    let output = match Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(&cwd)
        .output()
    {
        Ok(o) => o,
        Err(_) => return String::new(),
    };
    if !output.status.success() {
        return String::new();
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if let Some(ssh) = url.strip_prefix("git@github.com:") {
        return ssh.trim_end_matches(".git").to_string();
    }
    if let Some(https) = url.strip_prefix("https://github.com/") {
        return https.trim_end_matches(".git").to_string();
    }
    if let Some(https) = url.strip_prefix("git://github.com/") {
        return https.trim_end_matches(".git").to_string();
    }
    String::new()
}

#[tauri::command]
fn preview_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    use tauri::Manager;
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e: url::ParseError| format!("invalid url: {}", e))?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.navigate(parsed).map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns the top inset of the main window's content area in logical pixels
/// (title bar height on macOS, 0 on fullscreen / frameless windows).
#[tauri::command]
fn window_top_inset(window: tauri::Window) -> Result<u32, String> {
    if window.is_fullscreen().unwrap_or(false) {
        return Ok(0);
    }
    let outer_size = window.outer_size().map_err(|e| e.to_string())?;
    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let diff_physical = (outer_size.height as i32) - (inner_size.height as i32);
    let logical = if diff_physical > 0 {
        ((diff_physical as f64) / scale).round() as u32
    } else {
        // Tauri sometimes reports the same size for outer and inner on macOS
        // once the webview is attached. Fall back to the standard title bar
        // height so the child webview lands below the URL bar anyway.
        #[cfg(target_os = "macos")]
        {
            28
        }
        #[cfg(not(target_os = "macos"))]
        {
            0
        }
    };
    Ok(logical)
}

#[derive(serde::Serialize)]
struct BranchInfo {
    is_repo: bool,
    current: String,
    branches: Vec<String>,
    dirty: bool,
}

fn run_git(cwd: &str, args: &[&str]) -> Result<(bool, String, String), std::io::Error> {
    use std::process::Command as StdCommand;
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((output.status.success(), stdout, stderr))
}

#[tauri::command]
fn list_branches(cwd: String) -> BranchInfo {
    let (inside_ok, inside_out, _) = match run_git(&cwd, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(v) => v,
        Err(_) => {
            return BranchInfo {
                is_repo: false,
                current: String::new(),
                branches: vec![],
                dirty: false,
            };
        }
    };
    if !inside_ok || inside_out.trim() != "true" {
        return BranchInfo {
            is_repo: false,
            current: String::new(),
            branches: vec![],
            dirty: false,
        };
    }

    let current = run_git(&cwd, &["branch", "--show-current"])
        .ok()
        .and_then(|(ok, out, _)| if ok { Some(out.trim().to_string()) } else { None })
        .unwrap_or_default();

    let branches = run_git(&cwd, &["branch", "--format=%(refname:short)"])
        .ok()
        .and_then(|(ok, out, _)| {
            if ok {
                Some(
                    out.lines()
                        .map(|l| l.trim().to_string())
                        .filter(|l| !l.is_empty())
                        .collect::<Vec<_>>(),
                )
            } else {
                None
            }
        })
        .unwrap_or_default();

    let dirty = run_git(&cwd, &["status", "--porcelain"])
        .ok()
        .map(|(_, out, _)| !out.trim().is_empty())
        .unwrap_or(false);

    BranchInfo {
        is_repo: true,
        current,
        branches,
        dirty,
    }
}

#[tauri::command]
fn switch_branch(cwd: String, branch: String) -> Result<(), String> {
    let (ok, _, stderr) = run_git(&cwd, &["checkout", &branch]).map_err(|e| e.to_string())?;
    if ok {
        Ok(())
    } else {
        let msg = stderr.trim().to_string();
        Err(if msg.is_empty() { "git checkout failed".into() } else { msg })
    }
}

fn summarize_session_with_search(
    path: &std::path::Path,
    needle: Option<&str>,
) -> Option<(SessionInfo, Option<SessionContentHit>)> {
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return None;
    }
    let meta = fs::metadata(path).ok()?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let file = std::fs::File::open(path).ok()?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(file);

    let mut title = String::new();
    let mut first_user = String::new();
    let mut session_cwd = String::new();
    let mut message_count: usize = 0;
    let mut context_tokens: u64 = 0;
    let mut max_context_seen: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut model = String::new();
    let mut permission_mode = String::new();
    let mut archived = false;
    let mut last_event_type = String::new();
    let mut last_result_subtype = String::new();
    let mut last_result_is_error = false;
    let mut content_match_count: u32 = 0;
    let mut content_preview = String::new();
    // Authoritative contextWindow reported by the CLI in each result
    // event's `modelUsage` map. Indexed by model name so we can pick
    // the main model's window at the end — sub-agents like Haiku have
    // their own (smaller) window that shouldn't dominate the bar.
    let mut context_window_by_model: std::collections::HashMap<String, u64> =
        std::collections::HashMap::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if session_cwd.is_empty() {
            if let Some(s) = v.get("cwd").and_then(|x| x.as_str()) {
                session_cwd = s.to_string();
            }
        }
        if let Some(pm) = v.get("permissionMode").and_then(|x| x.as_str()) {
            // The most-recent permissionMode wins so toggling mid-session
            // is preserved in the UI on resume.
            permission_mode = pm.to_string();
        }
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if let Some(needle) = needle {
            if t == "user" || t == "assistant" {
                search_content_value(
                    v.pointer("/message/content"),
                    needle,
                    &mut content_match_count,
                    &mut content_preview,
                );
            }
        }
        match t {
            "custom-title" => {
                if let Some(s) = v.get("customTitle").and_then(|x| x.as_str()) {
                    title = s.to_string();
                }
            }
            "archive-state" => {
                if let Some(value) = v.get("archived").and_then(|x| x.as_bool()) {
                    archived = value;
                }
            }
            "ai-title" => {
                if title.is_empty() {
                    if let Some(s) = v.get("title").and_then(|x| x.as_str()) {
                        title = s.to_string();
                    }
                }
            }
            "user" => {
                last_event_type = t.to_string();
                message_count += 1;
                if first_user.is_empty() {
                    if let Some(content_val) = v.pointer("/message/content") {
                        if let Some(s) = content_val.as_str() {
                            first_user = s.to_string();
                        } else if let Some(arr) = content_val.as_array() {
                            for block in arr {
                                if block.get("type").and_then(|x| x.as_str())
                                    == Some("text")
                                {
                                    if let Some(s) =
                                        block.get("text").and_then(|x| x.as_str())
                                    {
                                        first_user = s.to_string();
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "assistant" => {
                last_event_type = t.to_string();
                message_count += 1;
                if let Some(m) = v
                    .pointer("/message/model")
                    .and_then(|x| x.as_str())
                    .and_then(normalize_model_name)
                {
                    model = m;
                }
                if let Some(usage) = v.pointer("/message/usage") {
                    let input =
                        usage.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                    let cc = usage
                        .get("cache_creation_input_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let cr = usage
                        .get("cache_read_input_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let ot = usage
                        .get("output_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    // Latest turn's input is the current context fill.
                    let turn_input = input + cc + cr;
                    context_tokens = turn_input;
                    if turn_input > max_context_seen {
                        max_context_seen = turn_input;
                    }
                    output_tokens = output_tokens.saturating_add(ot);
                }
            }
            "result" => {
                last_event_type = t.to_string();
                last_result_is_error = v
                    .get("is_error")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false);
                last_result_subtype = v
                    .get("subtype")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(cost) = v.get("total_cost_usd").and_then(|x| x.as_f64()) {
                    total_cost = cost;
                }
                if let Some(usage) =
                    v.get("modelUsage").and_then(|x| x.as_object())
                {
                    let mut best_usage_model: Option<(String, u64)> = None;
                    for (model_name, info) in usage {
                        let normalized_name = match normalize_model_name(model_name) {
                            Some(name) => name,
                            None => continue,
                        };
                        let context_window = info
                            .get("contextWindow")
                            .and_then(|x| x.as_u64())
                            .unwrap_or(0);
                        if best_usage_model
                            .as_ref()
                            .map(|(_, best_context_window)| context_window > *best_context_window)
                            .unwrap_or(true)
                        {
                            best_usage_model =
                                Some((normalized_name.clone(), context_window));
                        }
                        if let Some(cw) = info
                            .get("contextWindow")
                            .and_then(|x| x.as_u64())
                        {
                            if cw > 0 {
                                let entry = context_window_by_model
                                    .entry(normalized_name)
                                    .or_insert(0);
                                if cw > *entry {
                                    *entry = cw;
                                }
                            }
                        }
                    }
                    if model.is_empty() {
                        if let Some((usage_model, _)) = best_usage_model {
                            model = usage_model;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if title.is_empty() {
        title = first_user;
    }
    if title.is_empty() {
        title = id.clone();
    }
    let trimmed = title.trim().to_string();
    let truncated: String = if trimmed.chars().count() > 100 {
        let s: String = trimmed.chars().take(100).collect();
        format!("{}…", s)
    } else {
        trimmed
    };

    // Prefer the CLI's own contextWindow report for the main model.
    // Fall back to the max window reported across any model used in
    // the session (covers older sessions that never recorded the
    // main model's usage). Only if neither is available do we drop
    // back to the model-name heuristic.
    let context_limit = context_window_by_model
        .get(&model)
        .copied()
        .or_else(|| context_window_by_model.values().max().copied())
        .filter(|&cw| cw > 0)
        .unwrap_or_else(|| context_limit_for(&model, max_context_seen));
    let interrupted = !archived && message_count > 0 && last_event_type != "result";

    let info = SessionInfo {
        id,
        title: truncated,
        cwd: session_cwd,
        mtime_ms,
        message_count,
        context_tokens,
        context_limit,
        total_cost_usd: total_cost,
        output_tokens,
        model,
        permission_mode,
        archived,
        interrupted,
        last_event_type,
        last_result_subtype,
        last_result_is_error,
    };
    let content_hit = if content_match_count == 0 {
        None
    } else {
        Some(SessionContentHit {
            match_count: content_match_count,
            preview: content_preview,
        })
    };

    Some((info, content_hit))
}

fn summarize_session(path: &std::path::Path) -> Option<SessionInfo> {
    summarize_session_with_search(path, None).map(|(info, _)| info)
}

#[derive(serde::Serialize)]
struct SessionSearchHit {
    session_id: String,
    title: String,
    cwd: String,
    project: String,
    model: String,
    updated_ms: u128,
    source: String,
    match_count: u32,
    preview: String,
}

struct SessionContentHit {
    match_count: u32,
    preview: String,
}

// Searches every session JSONL for `query` and returns session-level hits.
// Matches include metadata (title, cwd/project, model, updated date) plus user
// and assistant transcript text. Bounded pretty loosely — we return up to 200
// hits after sorting by match count and recency.
#[tauri::command]
fn search_sessions(query: String) -> Result<Vec<SessionSearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.len() < 2 {
        return Ok(Vec::new());
    }
    let projects = match projects_dir() {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };
    if !projects.exists() {
        return Ok(Vec::new());
    }
    let mut by_id: HashMap<String, SessionSearchHit> = HashMap::new();
    let dirs = fs::read_dir(&projects).map_err(|e| e.to_string())?;
    for dir_entry in dirs.flatten() {
        let dir_path = dir_entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let files = match fs::read_dir(&dir_path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            if let Some((info, content_hit)) =
                summarize_session_with_search(&path, Some(&needle))
            {
                if let Some(hit) = build_session_search_hit(info, content_hit, &needle) {
                    let should_replace = by_id
                        .get(&hit.session_id)
                        .map(|existing| {
                            hit.match_count > existing.match_count
                                || (hit.match_count == existing.match_count
                                    && hit.updated_ms > existing.updated_ms)
                        })
                        .unwrap_or(true);
                    if should_replace {
                        by_id.insert(hit.session_id.clone(), hit);
                    }
                }
            }
        }
    }
    let mut out: Vec<SessionSearchHit> = by_id.into_values().collect();
    out.sort_by(|a, b| {
        b.match_count
            .cmp(&a.match_count)
            .then_with(|| b.updated_ms.cmp(&a.updated_ms))
    });
    out.truncate(200);
    Ok(out)
}

fn build_session_search_hit(
    info: SessionInfo,
    content_hit: Option<SessionContentHit>,
    needle: &str,
) -> Option<SessionSearchHit> {
    let project = display_basename(&info.cwd);
    let mut match_count: u32 = 0;
    let mut preview = String::new();
    let mut source = String::new();

    for (field_source, field_label, field_value) in session_search_fields(&info, &project) {
        if field_value.to_lowercase().contains(needle) {
            match_count = match_count.saturating_add(1);
            if preview.is_empty() {
                preview = format!("{}: {}", field_label, field_value);
                source = field_source.to_string();
            }
        }
    }

    if let Some(content) = content_hit {
        match_count = match_count.saturating_add(content.match_count);
        if preview.is_empty() {
            preview = content.preview;
            source = "content".into();
        }
    }

    if match_count == 0 {
        return None;
    }

    if preview.is_empty() {
        preview = info.title.clone();
    }
    if source.is_empty() {
        source = "metadata".into();
    }

    Some(SessionSearchHit {
        session_id: info.id,
        title: info.title,
        cwd: info.cwd,
        project,
        model: info.model,
        updated_ms: info.mtime_ms,
        source,
        match_count,
        preview,
    })
}

fn session_search_fields<'a>(
    info: &'a SessionInfo,
    project: &'a str,
) -> Vec<(&'static str, &'static str, String)> {
    let mut out = vec![
        ("title", "title", info.title.clone()),
        ("project", "project", project.to_string()),
        ("cwd", "path", info.cwd.clone()),
        ("model", "model", info.model.clone()),
        ("id", "session", info.id.clone()),
    ];
    out.extend(
        session_date_labels(info.mtime_ms)
            .into_iter()
            .map(|label| ("date", "updated", label)),
    );
    out
}

fn display_basename(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn session_date_labels(ms: u128) -> Vec<String> {
    if ms == 0 {
        return Vec::new();
    }
    let secs = (ms / 1000) as u64;
    let (y, mo, da, _, _, _) = epoch_to_ymdhms(secs);
    let month_idx = mo.saturating_sub(1).min(11) as usize;
    const SHORT_MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const LONG_MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    vec![
        format!("{:04}-{:02}-{:02}", y, mo, da),
        format!("{:02}/{:02}/{:04}", mo, da, y),
        format!("{} {}", SHORT_MONTHS[month_idx], da),
        format!("{} {}", LONG_MONTHS[month_idx], da),
        y.to_string(),
    ]
}

fn build_preview(snippet: &str, pos: usize, needle_len: usize) -> String {
    let len = snippet.len();
    if len == 0 {
        return String::new();
    }
    let pos = pos.min(len);
    let mut start = pos.saturating_sub(40);
    let mut end = (pos.saturating_add(needle_len).saturating_add(80)).min(len);
    while start < len && !snippet.is_char_boundary(start) {
        start += 1;
    }
    while end < len && !snippet.is_char_boundary(end) {
        end += 1;
    }
    if end > len {
        end = len;
    }
    if start > end {
        start = end;
    }
    let slice = snippet.get(start..end).unwrap_or("");
    slice.replace('\n', " ").trim().to_string()
}

fn search_content_value(
    content: Option<&serde_json::Value>,
    needle: &str,
    match_count: &mut u32,
    preview: &mut String,
) {
    let Some(v) = content else {
        return;
    };
    if let Some(s) = v.as_str() {
        search_text_fragment(s, needle, match_count, preview);
        return;
    }
    let Some(arr) = v.as_array() else {
        return;
    };
    for block in arr {
        let t = block.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if t == "text" {
            if let Some(s) = block.get("text").and_then(|x| x.as_str()) {
                search_text_fragment(s, needle, match_count, preview);
            }
        } else if t == "tool_result" {
            if let Some(s) = block.get("content").and_then(|x| x.as_str()) {
                search_text_fragment(s, needle, match_count, preview);
            } else if let Some(inner) = block.get("content").and_then(|x| x.as_array()) {
                for ib in inner {
                    if let Some(s) = ib.get("text").and_then(|x| x.as_str()) {
                        search_text_fragment(s, needle, match_count, preview);
                    }
                }
            }
        }
    }
}

fn search_text_fragment(
    snippet: &str,
    needle: &str,
    match_count: &mut u32,
    preview: &mut String,
) {
    let haystack = snippet.to_lowercase();
    if let Some(pos) = haystack.find(needle) {
        *match_count = match_count.saturating_add(1);
        if preview.is_empty() {
            *preview = build_preview(snippet, pos, needle.len());
        }
    }
}

#[tauri::command]
fn list_sessions() -> Result<Vec<SessionInfo>, String> {
    let projects = match projects_dir() {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    if !projects.exists() {
        return Ok(vec![]);
    }
    let mut by_id: HashMap<String, SessionInfo> = HashMap::new();
    let dirs = fs::read_dir(&projects).map_err(|e| e.to_string())?;
    for dir_entry in dirs.flatten() {
        let dir_path = dir_entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let files = match fs::read_dir(&dir_path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            if let Some(info) = summarize_session(&path) {
                let should_replace = by_id
                    .get(&info.id)
                    .map(|existing| info.mtime_ms > existing.mtime_ms)
                    .unwrap_or(true);
                if should_replace {
                    by_id.insert(info.id.clone(), info);
                }
            }
        }
    }
    let mut out: Vec<SessionInfo> = by_id.into_iter().map(|(_, info)| info).collect();
    out.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(out)
}

// App-written, restorable metadata for a single session. `custom_title` is
// Some only when the user explicitly set one (a `custom-title` record exists),
// so restore never pins an auto-derived/ai title.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionOverride {
    id: String,
    cwd: String,
    custom_title: Option<String>,
    archived: bool,
}

// Scans a session file for only the records Backup & Restore can rewrite:
// the latest `custom-title` and `archive-state`, plus the session `cwd`
// (needed to address the file on restore). Returns None unless there is
// something to restore and a cwd to target.
fn extract_session_override(path: &std::path::Path) -> Option<SessionOverride> {
    let id = path.file_stem()?.to_str()?.to_string();
    let file = std::fs::File::open(path).ok()?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(file);

    let mut cwd = String::new();
    let mut custom_title: Option<String> = None;
    let mut archived = false;
    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if cwd.is_empty() {
            if let Some(s) = v.get("cwd").and_then(|x| x.as_str()) {
                cwd = s.to_string();
            }
        }
        match v.get("type").and_then(|x| x.as_str()) {
            Some("custom-title") => {
                if let Some(s) = v.get("customTitle").and_then(|x| x.as_str()) {
                    custom_title = Some(s.to_string());
                }
            }
            Some("archive-state") => {
                if let Some(value) = v.get("archived").and_then(|x| x.as_bool()) {
                    archived = value;
                }
            }
            _ => {}
        }
    }
    if cwd.is_empty() || (custom_title.is_none() && !archived) {
        return None;
    }
    Some(SessionOverride {
        id,
        cwd,
        custom_title,
        archived,
    })
}

// Returns the app-written overrides (custom titles, archived state) across all
// sessions, for Backup & Restore. Mirrors `list_sessions`' directory walk but
// keeps only sessions that carry a restorable override.
#[tauri::command]
fn list_session_overrides() -> Result<Vec<SessionOverride>, String> {
    let projects = match projects_dir() {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    if !projects.exists() {
        return Ok(vec![]);
    }
    let mut by_id: HashMap<String, SessionOverride> = HashMap::new();
    let dirs = fs::read_dir(&projects).map_err(|e| e.to_string())?;
    for dir_entry in dirs.flatten() {
        let dir_path = dir_entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let files = match fs::read_dir(&dir_path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            if let Some(over) = extract_session_override(&path) {
                by_id.insert(over.id.clone(), over);
            }
        }
    }
    Ok(by_id.into_iter().map(|(_, over)| over).collect())
}

// Internal event types we never surface in the transcript.
const REPLAY_SKIP_TYPES: [&str; 7] = [
    "queue-operation",
    "last-prompt",
    "ai-title",
    "custom-title",
    "archive-state",
    "attachment",
    "system",
];

const MAX_SESSION_ID_LEN: usize = 128;
const MAX_CUSTOM_TITLE_CHARS: usize = 256;

fn safe_session_filename(session_id: &str) -> Option<String> {
    if session_id.is_empty() || session_id.len() > MAX_SESSION_ID_LEN {
        return None;
    }
    if !session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(format!("{}.jsonl", session_id))
}

fn session_path_under_projects(
    projects: &std::path::Path,
    session_id: &str,
    cwd: &str,
) -> Option<PathBuf> {
    let encoded = encode_cwd(cwd);
    if encoded.is_empty() || encoded.contains('/') || encoded.contains('\\') {
        return None;
    }
    let path = projects.join(encoded).join(safe_session_filename(session_id)?);
    if path.starts_with(projects) {
        Some(path)
    } else {
        None
    }
}

fn session_path(session_id: &str, cwd: &str) -> Result<PathBuf, String> {
    let projects = projects_dir().ok_or_else(|| "no HOME".to_string())?;
    session_path_under_projects(&projects, session_id, cwd)
        .ok_or_else(|| "invalid session id or cwd".to_string())
}

fn normalize_custom_title(title: &str) -> Result<String, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("session title cannot be empty".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("session title cannot contain line breaks".to_string());
    }
    Ok(trimmed.chars().take(MAX_CUSTOM_TITLE_CHARS).collect())
}

fn should_skip_line(line: &str) -> bool {
    // Cheap string prefilter: avoids a full JSON parse for internal types.
    // JSONL records always have `"type":"..."` as a top-level field, so this
    // substring check is a reliable first pass.
    for t in REPLAY_SKIP_TYPES {
        let needle = format!("\"type\":\"{}\"", t);
        if line.contains(&needle) {
            return true;
        }
    }
    false
}

#[tauri::command]
fn load_session(session_id: String, cwd: String) -> Result<Vec<serde_json::Value>, String> {
    let path = session_path(&session_id, &cwd)?;
    if !path.exists() {
        return Err("session file not found".to_string());
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(file);
    let mut out: Vec<serde_json::Value> = Vec::new();
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        if should_skip_line(&line) {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(t) = v.get("type").and_then(|x| x.as_str()) {
            if REPLAY_SKIP_TYPES.contains(&t) {
                continue;
            }
        }
        out.push(v);
    }
    Ok(out)
}

/// Faster path for the "open a session" click: returns the last `limit`
/// renderable events without parsing everything before them. Backward line
/// iteration + a substring prefilter keep this in the tens of ms even for
/// 10 MB session files.
#[tauri::command]
fn set_session_title(session_id: String, cwd: String, title: String) -> Result<(), String> {
    use std::io::Write;
    let path = session_path(&session_id, &cwd)?;
    if !path.exists() {
        return Err("session file not found".to_string());
    }
    let title = normalize_custom_title(&title)?;
    // summarize_session takes the most recent custom-title record, so appending
    // is enough — no need to rewrite prior lines.
    let record = serde_json::json!({
        "type": "custom-title",
        "customTitle": title,
        "timestamp": chrono_now_iso(),
    });
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_session_archived(session_id: String, cwd: String, archived: bool) -> Result<(), String> {
    use std::io::Write;
    let path = session_path(&session_id, &cwd)?;
    if !path.exists() {
        return Err("session file not found".to_string());
    }
    let record = serde_json::json!({
        "type": "archive-state",
        "archived": archived,
        "timestamp": chrono_now_iso(),
    });
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())?;
    Ok(())
}

/// Move a session's JSONL into a sibling `.trash/` so it disappears
/// from the sidebar but stays recoverable. Refuses if the session is
/// currently owned by a live panel — the user should close that panel
/// first so the subprocess isn't writing to a moved file.
#[tauri::command]
async fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
) -> Result<(), String> {
    {
        let owners = state.session_owners.lock().await;
        if let Some(owner) = owners.get(&session_id) {
            return Err(format!(
                "session is still open in panel {} — close it first",
                owner
            ));
        }
    }
    let path = session_path(&session_id, &cwd)?;
    if !path.exists() {
        return Err("session file not found".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "session file has no parent dir".to_string())?;
    let trash = parent.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamp = chrono_now_iso().replace(':', "-").replace('.', "-");
    let base = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("{}.jsonl", session_id));
    let target = trash.join(format!("{}.{}", base, stamp));
    fs::rename(&path, &target).map_err(|e| e.to_string())?;
    Ok(())
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    // Simple RFC3339-ish UTC stamp without pulling in chrono.
    let secs = d.as_secs();
    let millis = d.subsec_millis();
    let (y, mo, da, h, mi, se) = epoch_to_ymdhms(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, da, h, mi, se, millis
    )
}

fn epoch_to_ymdhms(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = (secs / 86400) as i64;
    let rem = (secs % 86400) as u32;
    let h = rem / 3600;
    let mi = (rem % 3600) / 60;
    let se = rem % 60;
    // Civil-from-days algorithm (Howard Hinnant).
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d, h, mi, se)
}

#[tauri::command]
fn load_session_tail(
    session_id: String,
    cwd: String,
    limit: usize,
) -> Result<Vec<serde_json::Value>, String> {
    let path = session_path(&session_id, &cwd)?;
    if !path.exists() {
        return Err("session file not found".to_string());
    }

    // Session JSONL files grow to 10-50MB for long conversations.
    // Reading the whole file just to take the last ~200 lines added
    // seconds of latency to every cache-miss resume. Instead, seek to
    // the last TAIL_BYTES of the file, skip any partial first line, and
    // parse only what we actually need. Average turn is well under
    // 32KB, so 4MB comfortably covers the last 200 of them.
    use std::io::{Read, Seek, SeekFrom};
    const TAIL_BYTES: u64 = 4 * 1024 * 1024;

    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let size = file
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    let start_offset = size.saturating_sub(TAIL_BYTES);
    if start_offset > 0 {
        file.seek(SeekFrom::Start(start_offset))
            .map_err(|e| e.to_string())?;
    }
    let read_cap = (size - start_offset) as usize + 1024;
    let mut buf: Vec<u8> = Vec::with_capacity(read_cap);
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = content.lines().collect();
    // If we didn't start at the beginning of the file, the first line
    // in our buffer is almost certainly a partial — throw it away.
    if start_offset > 0 && !lines.is_empty() {
        lines.remove(0);
    }

    let cap = limit.max(1);
    let mut rev: Vec<serde_json::Value> = Vec::with_capacity(cap);
    for line in lines.iter().rev() {
        if rev.len() >= cap {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        if should_skip_line(line) {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(t) = v.get("type").and_then(|x| x.as_str()) {
            if REPLAY_SKIP_TYPES.contains(&t) {
                continue;
            }
        }
        rev.push(v);
    }
    rev.reverse();
    Ok(rev)
}

// When the .app is launched from Finder/Dock, macOS launchd hands the
// process a minimal environment — no SHELL config sourcing, no PATH
// extensions, none of the auth-relevant vars users set in ~/.zshrc
// (ANTHROPIC_API_KEY, AWS_BEARER_TOKEN_BEDROCK, OAUTH cache paths,
// etc.). The result: `claude -p` spawned by start_session ends up with
// whatever sparse creds it can scrape and returns 401.
//
// Source the user's login shell once at startup and merge the result
// into our own env. Subprocess spawns then inherit the rich env. Only
// runs in non-debug builds and only on unix; in `cargo run` we already
// have the launching shell's env.
#[cfg(all(unix, not(debug_assertions)))]
fn hydrate_login_shell_env() {
    use std::process::Command as StdCommand;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = StdCommand::new(&shell)
        .arg("-l")
        .arg("-c")
        // Print env null-separated so values containing newlines survive.
        .arg("env -0 2>/dev/null || env")
        .output();
    let Ok(output) = output else { return };
    if !output.status.success() {
        return;
    }
    // Don't clobber things we manage ourselves or that come from the
    // GUI launch context. PATH especially: claude_path_env() already
    // augments it with common bin dirs, but we want the shell-provided
    // PATH to take priority since the user may have added custom dirs.
    const SKIP: &[&str] = &["PWD", "OLDPWD", "SHLVL", "_"];
    let bytes = &output.stdout;
    // Try null-separated first (env -0); fall back to newline.
    let split: Box<dyn Iterator<Item = &[u8]>> = if bytes.contains(&0) {
        Box::new(bytes.split(|&b| b == 0))
    } else {
        Box::new(bytes.split(|&b| b == b'\n'))
    };
    for line in split {
        if line.is_empty() {
            continue;
        }
        let s = match std::str::from_utf8(line) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let Some((k, v)) = s.split_once('=') else { continue };
        if k.is_empty() || SKIP.contains(&k) {
            continue;
        }
        std::env::set_var(k, v);
    }
}

#[derive(serde::Serialize)]
struct RemoteHostInfo {
    #[serde(rename = "hostId")]
    host_id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    platform: &'static str,
    #[serde(rename = "appVersion")]
    app_version: &'static str,
    online: bool,
    #[serde(rename = "lastSeenAtMs")]
    last_seen_at_ms: u128,
}

fn remote_host_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn read_hostname() -> String {
    // libc::gethostname is Unix-only; on Windows read COMPUTERNAME instead.
    #[cfg(unix)]
    fn platform_hostname() -> Option<String> {
        let mut buf = [0u8; 256];
        // SAFETY: writing into our own stack buffer with a known length.
        let result =
            unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
        if result != 0 {
            return None;
        }
        let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        let raw = String::from_utf8_lossy(&buf[..len]).to_string();
        if raw.trim().is_empty() {
            None
        } else {
            Some(raw)
        }
    }
    #[cfg(windows)]
    fn platform_hostname() -> Option<String> {
        std::env::var("COMPUTERNAME")
            .ok()
            .filter(|s| !s.trim().is_empty())
    }
    #[cfg(not(any(unix, windows)))]
    fn platform_hostname() -> Option<String> {
        None
    }

    platform_hostname().unwrap_or_else(|| "blackcrab-host".into())
}

fn remote_host_id(hostname: &str) -> String {
    // Stable per-machine placeholder. The pairing flow will replace this
    // with a properly issued host id once that lands; the protocol does
    // not constrain the format.
    format!("desktop-{}", hostname)
}

fn now_unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

static PAIRING_SERVICE: OnceLock<Arc<PairingService>> = OnceLock::new();

fn pairing_service() -> Result<Arc<PairingService>, String> {
    if let Some(svc) = PAIRING_SERVICE.get() {
        return Ok(svc.clone());
    }
    let path = pairing::default_state_path()?;
    let svc = Arc::new(PairingService::load(path)?);
    let _ = PAIRING_SERVICE.set(svc.clone());
    Ok(PAIRING_SERVICE.get().cloned().unwrap_or(svc))
}

#[tauri::command]
fn pairing_start() -> Result<PairingStartResponse, String> {
    let svc = pairing_service()?;
    svc.start_pairing(pairing_now_ms(), PAIRING_DEFAULT_TTL_SECS)
}

#[tauri::command]
fn pairing_accept(
    code: String,
    device_name: String,
) -> Result<PairingAcceptResponse, String> {
    let svc = pairing_service()?;
    svc.accept_pairing(&code, &device_name, pairing_now_ms())
}

#[tauri::command]
fn pairing_cancel(code: String) -> Result<bool, String> {
    let svc = pairing_service()?;
    svc.cancel_pending(&code)
}

#[tauri::command]
fn pairing_list_devices() -> Result<Vec<PairedDevice>, String> {
    let svc = pairing_service()?;
    svc.list_devices()
}

#[tauri::command]
fn pairing_revoke(device_id: String) -> Result<bool, String> {
    let svc = pairing_service()?;
    svc.revoke_device(&device_id)
}

static TRANSPORT_SERVER: OnceLock<Arc<TransportServer>> = OnceLock::new();

fn transport_server() -> Arc<TransportServer> {
    TRANSPORT_SERVER
        .get_or_init(|| Arc::new(TransportServer::new()))
        .clone()
}

// Sink for actions decoded off paired mobile connections. Populated once in
// `setup` after the session-owning consumer task is spawned, so the transport
// server's accept loop can forward decoded actions to it.
static REMOTE_CMD_TX: OnceLock<UnboundedSender<RemoteCommand>> = OnceLock::new();

/// Drain remote actions, dispatching each into the live session that owns the
/// targeted Claude session id. Runs for the lifetime of the app.
async fn run_remote_command_consumer(
    mut rx: UnboundedReceiver<RemoteCommand>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    session_owners: Arc<Mutex<HashMap<String, String>>>,
    app: AppHandle,
) {
    while let Some(command) = rx.recv().await {
        // A send that errors out (e.g. no live panel and the session can't be
        // resumed) should tell the phone, not just log — otherwise the bubble
        // spins until the 20s timeout with no explanation. Capture the session
        // up front since the match consumes the command.
        let notify_session = match &command {
            RemoteCommand::SendMessage { session_id, .. } => Some(session_id.clone()),
            _ => None,
        };
        let result = match command {
            RemoteCommand::SendMessage {
                session_id,
                body,
                attachments,
            } => {
                // Write any phone attachments to disk and append their paths to
                // the message so Claude can read them — same shape as desktop
                // attachments. Used by both the live and resume paths below.
                let body = write_remote_attachments(&session_id, &body, &attachments);
                match panel_for_session(&session_owners, &session_id).await {
                    Some(panel_id) => {
                        let result = deliver_user_message(&sessions, &panel_id, &body).await;
                        if result.is_ok() {
                            // Mirror the user message into the desktop transcript.
                            // The local composer appends user bubbles itself, so a
                            // phone-originated send would otherwise show only the
                            // assistant's reply on the desktop. Reuse the
                            // claude-event path so handleEvent renders it identically
                            // and both threads stay in sync.
                            let line = serde_json::json!({
                                "type": "user",
                                "message": { "role": "user", "content": body }
                            })
                            .to_string();
                            let _ = app.emit(
                                "claude-event",
                                serde_json::json!({ "panel_id": panel_id, "line": line }),
                            );
                        }
                        result
                    }
                    None => {
                        // The session has no live subprocess (e.g. the desktop
                        // restarted, or it was never opened). Ask the desktop to
                        // resume it and deliver the message, so the phone can
                        // continue any past conversation — not only live ones.
                        match session_cwd(&session_id) {
                            Some(cwd) => {
                                if session_recently_active(&session_id, &cwd) {
                                    // Live in another process (e.g. a terminal):
                                    // don't hijack it with a conflicting resume.
                                    push_remote_event(action_failed_value(
                                        &session_id,
                                        "This conversation is active in another window right now. Continue it there, or try again once it's idle.",
                                    ));
                                } else {
                                    let _ = app.emit(
                                        REMOTE_RESUME_SEND_EVENT,
                                        serde_json::json!({
                                            "sessionId": session_id,
                                            "cwd": cwd,
                                            "body": body,
                                        }),
                                    );
                                }
                                Ok(())
                            }
                            None => Err(format!("unknown session {session_id}")),
                        }
                    }
                }
            }
            RemoteCommand::StopSession { session_id } => {
                match panel_for_session(&session_owners, &session_id).await {
                    Some(panel_id) => {
                        terminate_panel(&sessions, &session_owners, &panel_id).await;
                        Ok(())
                    }
                    None => Err(format!("no live session for {session_id}")),
                }
            }
            RemoteCommand::Approve { approval_id } => {
                resolve_remote_approval(&sessions, &app, &approval_id, true, None).await
            }
            RemoteCommand::Deny { approval_id, reason } => {
                resolve_remote_approval(&sessions, &app, &approval_id, false, reason).await
            }
            RemoteCommand::FocusSession { session_id } => {
                let next = if session_id.trim().is_empty() {
                    None
                } else {
                    Some(session_id)
                };
                set_focused_session(next);
                // Push the focused transcript now so the phone updates
                // immediately instead of waiting for the next heartbeat.
                if let Some(transcript) = remote_transcript_event_value() {
                    push_remote_event(transcript);
                }
                Ok(())
            }
            RemoteCommand::SetReadCursor {
                session_id,
                last_read_message_id,
                read_at_ms,
            } => {
                // Advance the host cursor and, when it actually moved, fan the
                // new position out to every connected phone *and* notify the
                // desktop window (which isn't a transport client) so all
                // surfaces converge on where the user left off.
                if advance_read_cursor(&session_id, &last_read_message_id, read_at_ms) {
                    if let Some(event) = read_cursor_event_value(&session_id) {
                        push_remote_event(event.clone());
                        let _ = app.emit(READ_CURSOR_EVENT, event);
                    }
                }
                Ok(())
            }
            RemoteCommand::StartSession { cwd, body } => {
                // Hand off to the desktop window, which starts the session via
                // its normal new-session path (so it gets a panel, live
                // streaming, and sidebar entry) and reports the new id back for
                // the phone to follow.
                let trimmed = cwd.trim();
                if trimmed.is_empty() {
                    Err("start_session: empty cwd".to_string())
                } else {
                    let _ = app.emit(
                        REMOTE_START_SESSION_EVENT,
                        serde_json::json!({ "cwd": trimmed, "body": body }),
                    );
                    Ok(())
                }
            }
        };
        if let Err(e) = result {
            eprintln!("remote action dropped: {e}");
            if let Some(session_id) = notify_session {
                push_remote_event(action_failed_value(&session_id, &e));
            }
        }
    }
}

/// Convert a Unix epoch millisecond timestamp to an RFC-3339 / ISO-8601 UTC
/// string (e.g. `2026-05-31T16:00:00.000Z`). Avoids pulling in `chrono` just
/// to format the `updatedAt` field the mobile companion displays.
fn epoch_ms_to_iso8601(ms: u128) -> String {
    let secs = (ms / 1000) as i64;
    let millis = (ms % 1000) as u32;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (hour, minute, second) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z"
    )
}

/// Days since 1970-01-01 to a (year, month, day) civil date. Howard Hinnant's
/// well-known algorithm, valid across the full range we care about.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day)
}

/// The most-recent sessions the mobile companion should see. Capped so the
/// snapshot we push on every heartbeat stays small.
const REMOTE_SESSION_LIMIT: usize = 50;

/// Coarse session state for a disk-backed session summary. These are read from
/// JSONL, not from a live subprocess, so "running" is not inferable here.
fn session_state_label(info: &SessionInfo) -> &'static str {
    if info.last_result_is_error {
        "errored"
    } else if info.last_event_type == "result" {
        "completed"
    } else {
        "idle"
    }
}

/// Build the `sessions` event body (protocol shape, camelCase) the desktop
/// pushes to paired devices. `None` only when the session list can't be read.
fn remote_sessions_event_value() -> Option<serde_json::Value> {
    let sessions = list_sessions().ok()?;
    let host_id = remote_host_id_for_pairing();
    let mapped: Vec<serde_json::Value> = sessions
        .iter()
        .take(REMOTE_SESSION_LIMIT)
        .map(|s| {
            serde_json::json!({
                "hostId": host_id,
                "sessionId": s.id,
                "title": s.title,
                "projectPath": s.cwd,
                "model": s.model,
                "state": session_state_label(s),
                "updatedAt": epoch_ms_to_iso8601(s.mtime_ms),
                "pendingApprovalCount": 0,
                "unreadCount": session_unread_count(&s.id),
                "liveElsewhere": session_live_elsewhere(&s.id, &s.cwd),
            })
        })
        .collect();
    Some(serde_json::json!({
        "type": "sessions",
        "hostId": host_id,
        "sessions": mapped,
    }))
}

/// Distinct recent project directories (most-recent first), offered to the
/// phone when starting a new session. Derived from existing sessions' cwds.
fn remote_project_dirs_event_value() -> Option<serde_json::Value> {
    let sessions = list_sessions().ok()?;
    let host_id = remote_host_id_for_pairing();
    let mut seen = std::collections::HashSet::new();
    let mut dirs: Vec<String> = Vec::new();
    for s in &sessions {
        if !s.cwd.is_empty() && seen.insert(s.cwd.clone()) {
            dirs.push(s.cwd.clone());
        }
        if dirs.len() >= 30 {
            break;
        }
    }
    Some(serde_json::json!({
        "type": "project_dirs",
        "hostId": host_id,
        "dirs": dirs,
    }))
}

/// Desktop UI entry point: after a phone-initiated session spawns and the
/// desktop learns its id, push it to paired phones so they can open it.
#[tauri::command]
fn remote_notify_session_started(session_id: String, cwd: String) {
    if session_id.trim().is_empty() {
        return;
    }
    push_remote_event(serde_json::json!({
        "type": "session_started",
        "hostId": remote_host_id_for_pairing(),
        "sessionId": session_id,
        "cwd": cwd,
    }));
    // Refresh the session list too, so the new conversation appears right away
    // rather than on the next heartbeat.
    if let Some(sessions) = remote_sessions_event_value() {
        push_remote_event(sessions);
    }
}

/// How many transcript entries to tail for the mobile companion's view.
const REMOTE_TRANSCRIPT_LIMIT: usize = 40;
/// Max characters in a single transcript preview pushed to a phone.
const REMOTE_PREVIEW_MAX: usize = 8000;

/// Prepare a transcript entry's text for the phone: keep line breaks (so
/// multi-line replies and code stay readable) and clip only very long entries
/// to `REMOTE_PREVIEW_MAX` chars to bound payload size. Returns the text and
/// whether it was clipped.
fn truncate_preview(raw: &str) -> (String, bool) {
    let trimmed = raw.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() > REMOTE_PREVIEW_MAX {
        let clipped: String = chars[..REMOTE_PREVIEW_MAX].iter().collect();
        (format!("{clipped}…"), true)
    } else {
        (trimmed.to_string(), false)
    }
}

/// First text-bearing block in a message `content` (string or block array).
fn first_text_block(content: &serde_json::Value) -> Option<String> {
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    let arr = content.as_array()?;
    for block in arr {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                    return Some(t.to_string());
                }
            }
            Some("thinking") => {
                if let Some(t) = block.get("thinking").and_then(|x| x.as_str()) {
                    return Some(t.to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// Classify a tail record into a protocol transcript kind + a raw preview.
/// `load_session_tail` has already dropped internal/system record types.
/// A tool call's key detail to show on the phone (the bash command, the file
/// path, the search pattern, the URL) — empty when there's nothing concise.
fn tool_detail(name: &str, input: Option<&serde_json::Value>) -> String {
    let Some(input) = input else {
        return String::new();
    };
    let get = |k: &str| {
        input
            .get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    match name {
        "Bash" => get("command").unwrap_or_default(),
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            get("file_path").or_else(|| get("path")).unwrap_or_default()
        }
        "Glob" | "Grep" => get("pattern").unwrap_or_default(),
        "WebFetch" => get("url").unwrap_or_default(),
        "WebSearch" => get("query").unwrap_or_default(),
        "Task" => get("description").unwrap_or_default(),
        _ => String::new(),
    }
}

/// The text of a tool_result block (string content, or joined text parts).
fn tool_result_text(block: &serde_json::Value) -> String {
    let Some(content) = block.get("content") else {
        return String::new();
    };
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

/// Classify a transcript record into (kind, text, tool name). The tool name is
/// present for tool_call entries so the phone can label them.
fn classify_transcript_record(
    record: &serde_json::Value,
) -> (&'static str, String, Option<String>) {
    let record_type = record.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let content = record.pointer("/message/content");
    let blocks = content.and_then(|c| c.as_array());

    let find_block = |name: &str| {
        blocks.and_then(|arr| {
            arr.iter()
                .find(|b| b.get("type").and_then(|t| t.as_str()) == Some(name))
        })
    };
    let has_block = |name: &str| find_block(name).is_some();

    match record_type {
        "user" => {
            if let Some(tr) = find_block("tool_result") {
                ("tool_result", tool_result_text(tr), None)
            } else {
                let text = content.and_then(first_text_block).unwrap_or_default();
                ("user_message", text, None)
            }
        }
        "assistant" => {
            if let Some(text) = content.and_then(|c| first_text_block(c)) {
                let kind = if has_block("text") {
                    "assistant_message"
                } else {
                    "thinking"
                };
                (kind, text, None)
            } else if let Some(tu) = find_block("tool_use") {
                let name = tu
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("tool")
                    .to_string();
                let detail = tool_detail(&name, tu.get("input"));
                ("tool_call", detail, Some(name))
            } else {
                ("assistant_message", String::new(), None)
            }
        }
        "result" => ("system_notice", "Turn complete".to_string(), None),
        other => ("system_notice", other.to_string(), None),
    }
}

/// The session the phone asked to follow for `transcript_tail`, or `None` to
/// follow the most-recently-active session. Global (single user), set by a
/// `focus_session` action.
static FOCUSED_SESSION: OnceLock<StdMutex<Option<String>>> = OnceLock::new();

fn set_focused_session(session_id: Option<String>) {
    *FOCUSED_SESSION
        .get_or_init(|| StdMutex::new(None))
        .lock()
        .unwrap() = session_id;
}

fn focused_session_id() -> Option<String> {
    FOCUSED_SESSION
        .get_or_init(|| StdMutex::new(None))
        .lock()
        .unwrap()
        .clone()
}

/// Build the `transcript_tail` event for the focused session, or — when no
/// focus is set or it's no longer present — the most-recently-active session.
fn remote_transcript_event_value() -> Option<serde_json::Value> {
    let sessions = list_sessions().ok()?;
    let focused = focused_session_id();
    let target = focused
        .as_deref()
        .filter(|id| !id.is_empty())
        .and_then(|id| sessions.iter().find(|s| s.id == id))
        .or_else(|| sessions.first())?;
    let records =
        load_session_tail(target.id.clone(), target.cwd.clone(), REMOTE_TRANSCRIPT_LIMIT).ok()?;
    let host_id = remote_host_id_for_pairing();
    let entries: Vec<serde_json::Value> = records
        .iter()
        .enumerate()
        .map(|(i, record)| {
            let (kind, raw, tool_name) = classify_transcript_record(record);
            let (preview, truncated) = truncate_preview(&raw);
            let id = record
                .get("uuid")
                .and_then(|u| u.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("{}-{i}", target.id));
            let created_at = record
                .get("timestamp")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            serde_json::json!({
                "id": id,
                "sessionId": target.id,
                "kind": kind,
                "createdAt": created_at,
                "preview": preview,
                "truncated": truncated,
                "toolName": tool_name,
            })
        })
        .collect();
    Some(serde_json::json!({
        "type": "transcript_tail",
        "hostId": host_id,
        "sessionId": target.id,
        "entries": entries,
    }))
}

// ---------------------------------------------------------------------------
// Read cursors: the host owns the canonical "last read message" per session so
// desktop and phone converge on where the user left off. Both surfaces write
// through `advance_read_cursor`, which only moves a cursor forward (by
// transcript order, with `readAtMs` as a tiebreaker), and read it back via the
// connect snapshot / a real-time `read_cursor` event. Persisted to disk so the
// position survives restarts.
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ReadCursor {
    #[serde(rename = "lastReadMessageId")]
    last_read_message_id: String,
    #[serde(rename = "readAtMs")]
    read_at_ms: i64,
}

static READ_CURSORS: OnceLock<StdMutex<HashMap<String, ReadCursor>>> = OnceLock::new();

fn read_cursors_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".claude")
            .join("blackcrab")
            .join("read_cursors.json"),
    )
}

fn load_read_cursors_from_disk() -> HashMap<String, ReadCursor> {
    let Some(path) = read_cursors_path() else {
        return HashMap::new();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_read_cursors_to_disk(map: &HashMap<String, ReadCursor>) {
    let Some(path) = read_cursors_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(map) {
        let _ = std::fs::write(&path, text);
    }
}

fn read_cursors() -> &'static StdMutex<HashMap<String, ReadCursor>> {
    READ_CURSORS.get_or_init(|| StdMutex::new(load_read_cursors_from_disk()))
}

/// Order index of `message_id` within the session's loaded transcript tail, or
/// `None` when it isn't in the window (e.g. older than the tail we keep).
fn transcript_index_of(session_id: &str, message_id: &str) -> Option<usize> {
    let sessions = list_sessions().ok()?;
    let target = sessions.iter().find(|s| s.id == session_id)?;
    let records =
        load_session_tail(target.id.clone(), target.cwd.clone(), REMOTE_TRANSCRIPT_LIMIT).ok()?;
    records.iter().enumerate().find_map(|(i, record)| {
        let id = record
            .get("uuid")
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{}-{i}", target.id));
        (id == message_id).then_some(i)
    })
}

/// Pure monotonic-advance decision, split out from disk access so it can be
/// tested directly. `new_idx`/`cur_idx` are the transcript-order positions of
/// the incoming and stored message ids (None when outside the loaded window).
fn cursor_should_advance(
    current: Option<&ReadCursor>,
    message_id: &str,
    new_idx: Option<usize>,
    cur_idx: Option<usize>,
    at_ms: i64,
) -> bool {
    match current {
        None => true,
        Some(current) if current.last_read_message_id == message_id => false,
        Some(current) => match (new_idx, cur_idx) {
            (Some(n), Some(c)) => n > c,
            (Some(_), None) => true,  // current fell off the window → new is ahead
            (None, Some(_)) => false, // new is older than the window → behind
            (None, None) => at_ms > current.read_at_ms, // unknown order → newest wins
        },
    }
}

/// Move the stored cursor for `session_id` forward to `message_id`/`at_ms` when
/// it is ahead of the current one. Returns true when the store changed.
fn advance_read_cursor(session_id: &str, message_id: &str, at_ms: i64) -> bool {
    if message_id.is_empty() {
        return false;
    }
    // Read the current cursor under a short lock, then do disk I/O unlocked.
    let current = read_cursors().lock().unwrap().get(session_id).cloned();
    let new_idx = transcript_index_of(session_id, message_id);
    let cur_idx = current
        .as_ref()
        .and_then(|c| transcript_index_of(session_id, &c.last_read_message_id));
    let changed = cursor_should_advance(current.as_ref(), message_id, new_idx, cur_idx, at_ms);
    if changed {
        let mut map = read_cursors().lock().unwrap();
        map.insert(
            session_id.to_string(),
            ReadCursor {
                last_read_message_id: message_id.to_string(),
                read_at_ms: at_ms,
            },
        );
        save_read_cursors_to_disk(&map);
    }
    changed
}

fn read_cursor_event_value(session_id: &str) -> Option<serde_json::Value> {
    let map = read_cursors().lock().unwrap();
    let cursor = map.get(session_id)?;
    Some(serde_json::json!({
        "type": "read_cursor",
        "hostId": remote_host_id_for_pairing(),
        "sessionId": session_id,
        "lastReadMessageId": cursor.last_read_message_id,
        "readAtMs": cursor.read_at_ms,
    }))
}

/// One `read_cursor` event per stored cursor, for the connect snapshot so a
/// freshly connected client learns every session's left-off point at once.
fn read_cursor_snapshot_values() -> Vec<serde_json::Value> {
    let host_id = remote_host_id_for_pairing();
    let map = read_cursors().lock().unwrap();
    map.iter()
        .map(|(session_id, cursor)| {
            serde_json::json!({
                "type": "read_cursor",
                "hostId": host_id,
                "sessionId": session_id,
                "lastReadMessageId": cursor.last_read_message_id,
                "readAtMs": cursor.read_at_ms,
            })
        })
        .collect()
}

/// Desktop UI entry point: record that the local user read up to a message.
#[tauri::command]
fn set_session_read_cursor(session_id: String, last_read_message_id: String, read_at_ms: i64) {
    if advance_read_cursor(&session_id, &last_read_message_id, read_at_ms) {
        if let Some(event) = read_cursor_event_value(&session_id) {
            push_remote_event(event);
        }
    }
}

/// Desktop UI entry point: read back every stored cursor (protocol shape).
#[tauri::command]
fn session_read_cursors() -> Vec<serde_json::Value> {
    read_cursor_snapshot_values()
}

/// Coarse unread indicator for a session, by message identity: 1 when the
/// session has a read cursor whose target is not the newest message, else 0.
/// Bounded work — only sessions the user has actually read carry a cursor, and
/// only those pay for a (cheap, tail-only) latest-message lookup.
fn session_unread_count(session_id: &str) -> u32 {
    let cursor = match read_cursors().lock().unwrap().get(session_id).cloned() {
        Some(c) => c,
        None => return 0,
    };
    match latest_message_id(session_id) {
        Some(latest) if latest != cursor.last_read_message_id => 1,
        _ => 0,
    }
}

/// A session whose file was written within this window is treated as live in
/// another process (e.g. a terminal) — we won't hijack it with a `--resume`.
const REMOTE_ACTIVE_WINDOW_SECS: u64 = 12;

/// True when the session's JSONL was modified very recently — a strong sign
/// another process is actively writing it.
fn session_recently_active(session_id: &str, cwd: &str) -> bool {
    let Ok(path) = session_path(session_id, cwd) else {
        return false;
    };
    std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|d| d.as_secs() < REMOTE_ACTIVE_WINDOW_SECS)
        .unwrap_or(false)
}

fn action_failed_value(session_id: &str, reason: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "action_failed",
        "hostId": remote_host_id_for_pairing(),
        "sessionId": session_id,
        "reason": reason,
    })
}

/// Desktop UI entry point: tell the phone a start/resume/send couldn't be
/// fulfilled (bad directory, session open elsewhere, …).
#[tauri::command]
fn remote_notify_action_failed(session_id: Option<String>, reason: String) {
    push_remote_event(serde_json::json!({
        "type": "action_failed",
        "hostId": remote_host_id_for_pairing(),
        "sessionId": session_id,
        "reason": reason,
    }));
}

/// Handle to the live session→panel ownership map, for sync snapshot reads.
static SESSION_OWNERS: OnceLock<Arc<Mutex<HashMap<String, String>>>> = OnceLock::new();

/// True when Blackcrab itself runs this session (so the phone can message it).
/// Uses a non-blocking try-lock; treats contention as "not owned".
fn session_owned_by_blackcrab(session_id: &str) -> bool {
    SESSION_OWNERS
        .get()
        .and_then(|m| m.try_lock().ok())
        .map(|owners| owners.contains_key(session_id))
        .unwrap_or(false)
}

/// True when a session is live in a process the phone can't take over (a
/// terminal): recently written, but not owned by Blackcrab.
fn session_live_elsewhere(session_id: &str, cwd: &str) -> bool {
    session_recently_active(session_id, cwd) && !session_owned_by_blackcrab(session_id)
}

/// Reduce a phone-supplied attachment name to a safe file name (final path
/// component only), guarding against path traversal.
fn sanitize_attachment_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let cleaned: String = base.chars().filter(|c| *c != '\0').collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "attachment".to_string()
    } else {
        cleaned
    }
}

/// Write any attachments to `~/.claude/blackcrab/attachments/<session>/` and
/// return the message body with their paths appended (same format the desktop
/// composer uses), so Claude can read the files by path. Returns `body`
/// unchanged when there's nothing to attach or the write can't proceed.
fn write_remote_attachments(
    session_id: &str,
    body: &str,
    attachments: &[crate::transport::RemoteAttachment],
) -> String {
    use base64::Engine;
    if attachments.is_empty() {
        return body.to_string();
    }
    let Some(home) = std::env::var_os("HOME").and_then(|h| h.into_string().ok()) else {
        return body.to_string();
    };
    let safe_session: String = session_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect();
    let dir = PathBuf::from(home)
        .join(".claude")
        .join("blackcrab")
        .join("attachments")
        .join(&safe_session);
    if std::fs::create_dir_all(&dir).is_err() {
        return body.to_string();
    }
    let mut paths: Vec<String> = Vec::new();
    for att in attachments {
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(att.data_base64.as_bytes())
        else {
            continue;
        };
        let name = sanitize_attachment_name(&att.name);
        let mut path = dir.join(&name);
        let mut n = 1;
        while path.exists() {
            path = dir.join(format!("{n}-{name}"));
            n += 1;
        }
        if std::fs::write(&path, &bytes).is_ok() {
            paths.push(path.to_string_lossy().to_string());
        }
    }
    if paths.is_empty() {
        return body.to_string();
    }
    let list = paths
        .iter()
        .map(|p| format!("- {p}"))
        .collect::<Vec<_>>()
        .join("\n");
    let head = if body.trim().is_empty() {
        "(see attached files)"
    } else {
        body
    };
    format!(
        "{head}\n\nThe user attached the following file(s) — use the Read tool to open each one (images included) before answering:\n{list}"
    )
}

/// The working directory recorded for a session, used to resume it.
fn session_cwd(session_id: &str) -> Option<String> {
    list_sessions()
        .ok()?
        .into_iter()
        .find(|s| s.id == session_id)
        .map(|s| s.cwd)
}

/// The newest transcript record id for a session, in the same id space the
/// `transcript_tail` event uses (JSONL `uuid`, with the `{sessionId}-{i}`
/// fallback). `None` when the session or its tail can't be read.
fn latest_message_id(session_id: &str) -> Option<String> {
    let sessions = list_sessions().ok()?;
    let target = sessions.iter().find(|s| s.id == session_id)?;
    let records =
        load_session_tail(target.id.clone(), target.cwd.clone(), REMOTE_TRANSCRIPT_LIMIT).ok()?;
    let last = records.len().checked_sub(1)?;
    let record = records.get(last)?;
    Some(
        record
            .get("uuid")
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{}-{last}", target.id)),
    )
}

/// Desktop UI entry point: mark a session read up to its newest message. Used
/// when the desktop user opens/views a conversation — it resolves the latest
/// message id host-side (the desktop renders entries with a different id space)
/// and advances the shared cursor, syncing "all read" to paired phones.
/// Returns the message id the cursor now points at, if any.
#[tauri::command]
fn mark_session_read_latest(session_id: String) -> Option<String> {
    let latest = latest_message_id(&session_id)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if advance_read_cursor(&session_id, &latest, now_ms) {
        if let Some(event) = read_cursor_event_value(&session_id) {
            push_remote_event(event);
        }
    }
    Some(latest)
}

// ---------------------------------------------------------------------------
// Remote approvals: forward Claude's permission prompts to paired phones and
// answer them from a phone's approve/deny, reusing the desktop's existing
// control_response path. Works whether or not the desktop window is focused.
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct PendingApproval {
    panel_id: String,
    session_id: String,
    request_id: String,
    tool_name: String,
    input: serde_json::Value,
    requested_at_ms: u128,
}

/// Permission prompts awaiting an answer, keyed by Claude's `request_id` (which
/// we also use as the protocol `approvalId`).
static PENDING_APPROVALS: OnceLock<Arc<StdMutex<HashMap<String, PendingApproval>>>> =
    OnceLock::new();
/// Real-time host->mobile push channel; transport connections subscribe to it.
static REMOTE_BROADCAST: OnceLock<broadcast::Sender<serde_json::Value>> = OnceLock::new();

fn pending_approvals() -> Arc<StdMutex<HashMap<String, PendingApproval>>> {
    PENDING_APPROVALS
        .get_or_init(|| Arc::new(StdMutex::new(HashMap::new())))
        .clone()
}

/// Push a host->mobile event to all connected phones. A send error only means
/// no phone is currently listening, which is fine.
fn push_remote_event(value: serde_json::Value) {
    if let Some(tx) = REMOTE_BROADCAST.get() {
        let _ = tx.send(value);
    }
}

fn approval_kind_for_tool(tool: &str) -> &'static str {
    match tool {
        "Bash" => "shell_command",
        "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => "file_write",
        "WebFetch" | "WebSearch" => "network_request",
        _ => "tool_call",
    }
}

/// A short, phone-friendly description of what's being approved.
fn approval_summary(tool: &str, input: &serde_json::Value) -> String {
    let detail = ["command", "file_path", "path", "url"]
        .iter()
        .find_map(|key| input.get(*key).and_then(|v| v.as_str()));
    match detail {
        Some(d) => {
            let (preview, _) = truncate_preview(d);
            format!("{tool}: {preview}")
        }
        None => tool.to_string(),
    }
}

fn approval_requested_value(approval: &PendingApproval) -> serde_json::Value {
    serde_json::json!({
        "type": "approval_requested",
        "approval": {
            "id": approval.request_id,
            "hostId": remote_host_id_for_pairing(),
            "sessionId": approval.session_id,
            "kind": approval_kind_for_tool(&approval.tool_name),
            "summary": approval_summary(&approval.tool_name, &approval.input),
            "requestedAt": epoch_ms_to_iso8601(approval.requested_at_ms),
        }
    })
}

fn approval_resolved_value(approval_id: &str, resolution: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "approval_resolved",
        "approvalId": approval_id,
        "resolution": resolution,
    })
}

/// Record a `can_use_tool` control-request seen on a session's stdout and push
/// it to paired phones. No-op for any other line.
fn register_remote_approval(panel_id: &str, session_id: Option<&str>, line: &str) {
    if !line.contains("\"can_use_tool\"") {
        return;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    if v.get("type").and_then(|x| x.as_str()) != Some("control_request") {
        return;
    }
    let Some(req) = v.get("request") else { return };
    if req.get("subtype").and_then(|x| x.as_str()) != Some("can_use_tool") {
        return;
    }
    let request_id = match v.get("request_id").and_then(|x| x.as_str()) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return,
    };
    let approval = PendingApproval {
        panel_id: panel_id.to_string(),
        session_id: session_id.unwrap_or("").to_string(),
        request_id: request_id.clone(),
        tool_name: req
            .get("tool_name")
            .and_then(|x| x.as_str())
            .unwrap_or("unknown")
            .to_string(),
        input: req.get("input").cloned().unwrap_or_else(|| serde_json::json!({})),
        requested_at_ms: now_unix_ms(),
    };
    pending_approvals()
        .lock()
        .unwrap()
        .insert(request_id, approval.clone());
    push_remote_event(approval_requested_value(&approval));
}

/// Answer a pending approval from a phone: write the control_response the same
/// way the desktop UI does, drop it from the registry, tell phones it's gone,
/// and dismiss the desktop's prompt for it.
async fn resolve_remote_approval(
    sessions: &Arc<Mutex<HashMap<String, Session>>>,
    app: &AppHandle,
    approval_id: &str,
    allow: bool,
    reason: Option<String>,
) -> Result<(), String> {
    let approval = pending_approvals()
        .lock()
        .unwrap()
        .remove(approval_id)
        .ok_or_else(|| format!("no pending approval {approval_id}"))?;
    let response = if allow {
        serde_json::json!({ "behavior": "allow", "updated_input": approval.input })
    } else {
        serde_json::json!({
            "behavior": "deny",
            "message": reason.unwrap_or_else(|| "denied from mobile".to_string()),
        })
    };
    let control = serde_json::json!({
        "type": "control_response",
        "response": {
            "request_id": approval.request_id,
            "subtype": "success",
            "response": response,
        }
    });
    deliver_raw_line(sessions, &approval.panel_id, &control.to_string()).await?;
    push_remote_event(approval_resolved_value(
        approval_id,
        if allow { "approved" } else { "denied" },
    ));
    let _ = app.emit(
        "blackcrab-remote-permission-resolved",
        serde_json::json!({ "panel_id": approval.panel_id, "request_id": approval.request_id }),
    );
    Ok(())
}

/// When the desktop UI answers a prompt via `send_raw`, mirror that into the
/// remote registry so paired phones see the approval disappear too.
fn note_local_control_response(line: &str) {
    if !line.contains("control_response") {
        return;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    if v.get("type").and_then(|x| x.as_str()) != Some("control_response") {
        return;
    }
    let response = v.get("response");
    let request_id = match response.and_then(|r| r.get("request_id")).and_then(|x| x.as_str()) {
        Some(id) => id.to_string(),
        None => return,
    };
    if pending_approvals().lock().unwrap().remove(&request_id).is_some() {
        let behavior = response
            .and_then(|r| r.get("response"))
            .and_then(|x| x.get("behavior"))
            .and_then(|x| x.as_str());
        let resolution = if behavior == Some("deny") { "denied" } else { "approved" };
        push_remote_event(approval_resolved_value(&request_id, resolution));
    }
}

/// The host->mobile events pushed on connect and each heartbeat tick.
fn remote_event_snapshot() -> Vec<serde_json::Value> {
    let mut events = Vec::new();
    if let Some(sessions) = remote_sessions_event_value() {
        events.push(sessions);
    }
    if let Some(transcript) = remote_transcript_event_value() {
        events.push(transcript);
    }
    // Outstanding approvals, so a phone that connects mid-prompt catches up.
    let pending: Vec<PendingApproval> =
        pending_approvals().lock().unwrap().values().cloned().collect();
    for approval in &pending {
        events.push(approval_requested_value(approval));
    }
    // Read cursors, so a freshly connected client lands where the user left off.
    for value in read_cursor_snapshot_values() {
        events.push(value);
    }
    // Recent project directories, offered when starting a new session.
    if let Some(dirs) = remote_project_dirs_event_value() {
        events.push(dirs);
    }
    events
}

/// Side channels the transport uses to reach the rest of the app. Rebuilt per
/// `start` call; the action sender comes from the global set up in `setup`.
fn remote_hooks() -> crate::transport::RemoteHooks {
    crate::transport::RemoteHooks {
        commands: REMOTE_CMD_TX.get().cloned(),
        events: Some(Arc::new(remote_event_snapshot)),
        broadcast: REMOTE_BROADCAST.get().cloned(),
    }
}

/// Handle to the running relay client task, so a config change can abort the
/// old client before spawning a replacement.
static RELAY_TASK: OnceLock<StdMutex<Option<tauri::async_runtime::JoinHandle<()>>>> =
    OnceLock::new();

/// Start the outbound relay client. The URL comes from `BLACKCRAB_RELAY_URL`
/// when set, otherwise the persisted `~/.blackcrab/relay.json`; the token comes
/// from `BLACKCRAB_RELAY_TOKEN` when set, otherwise the keychain. No-op when
/// either is empty (LAN-only). Any previously spawned client is aborted first.
fn maybe_start_relay_client() {
    let url = {
        let env_url = std::env::var("BLACKCRAB_RELAY_URL").unwrap_or_default();
        if env_url.trim().is_empty() {
            read_relay_url_config().unwrap_or_default()
        } else {
            env_url
        }
    };
    let token = {
        let env_token = std::env::var("BLACKCRAB_RELAY_TOKEN").unwrap_or_default();
        if env_token.trim().is_empty() {
            read_relay_token().ok().flatten().unwrap_or_default()
        } else {
            env_token
        }
    };

    // Stop any client started by a prior call/config before deciding whether to
    // start a new one — a cleared config should leave nothing running.
    let slot = RELAY_TASK.get_or_init(|| StdMutex::new(None));
    if let Ok(mut guard) = slot.lock() {
        if let Some(handle) = guard.take() {
            handle.abort();
        }
    }

    if url.trim().is_empty() || token.trim().is_empty() {
        return;
    }
    let (Some(commands), Some(broadcast)) =
        (REMOTE_CMD_TX.get().cloned(), REMOTE_BROADCAST.get().cloned())
    else {
        eprintln!("relay client: channels not ready; skipping");
        return;
    };
    let client = relay_client::RelayClient {
        url,
        token,
        host_id: remote_host_id_for_pairing(),
        commands,
        key_for_device: Arc::new(|device_id: &str| {
            pairing_service()
                .ok()
                .and_then(|svc| svc.e2e_key_for_device(device_id))
        }),
        events: Arc::new(remote_event_snapshot),
        broadcast,
    };
    let handle = tauri::async_runtime::spawn(client.run());
    if let Ok(mut guard) = slot.lock() {
        *guard = Some(handle);
    }
}

/// Persist the relay URL and token, then (re)start the relay client so the
/// change takes effect without an app restart. The token is never echoed back.
#[tauri::command]
fn set_relay_config(url: String, token: String) -> Result<(), String> {
    let url = url.trim().to_string();
    let token = token.trim().to_string();
    write_relay_url_config(&url)?;
    if token.is_empty() {
        delete_relay_token()?;
    } else {
        write_relay_token(&token)?;
    }
    maybe_start_relay_client();
    Ok(())
}

/// Current relay configuration for the desktop UI: the persisted (or env) URL
/// and whether a token is set. The token itself is never returned.
#[tauri::command]
fn get_relay_config() -> serde_json::Value {
    let env_url = std::env::var("BLACKCRAB_RELAY_URL").unwrap_or_default();
    let url = if env_url.trim().is_empty() {
        read_relay_url_config().unwrap_or_default()
    } else {
        env_url
    };
    let env_token = std::env::var("BLACKCRAB_RELAY_TOKEN").unwrap_or_default();
    let has_token = !env_token.trim().is_empty()
        || read_relay_token().ok().flatten().is_some();
    serde_json::json!({ "url": url, "hasToken": has_token })
}

#[tauri::command]
async fn remote_transport_info() -> Result<TransportEndpoint, String> {
    let server = transport_server();
    if let Some(endpoint) = server.endpoint().await {
        return Ok(endpoint);
    }
    let pairing = pairing_service()?;
    server.start(pairing, remote_hooks()).await
}

pub(crate) fn remote_host_id_for_pairing() -> String {
    let hostname = read_hostname();
    remote_host_id(&hostname)
}

#[tauri::command]
fn remote_host_info() -> RemoteHostInfo {
    let hostname = read_hostname();
    RemoteHostInfo {
        host_id: remote_host_id(&hostname),
        display_name: hostname,
        platform: remote_host_platform(),
        app_version: env!("CARGO_PKG_VERSION"),
        online: true,
        last_seen_at_ms: now_unix_ms(),
    }
}

/// The relay URL this host is configured to use, baked into the pairing QR so
/// a phone can reach it off-LAN. Empty when no relay is configured.
#[tauri::command]
fn remote_relay_url() -> String {
    let env_url = std::env::var("BLACKCRAB_RELAY_URL").unwrap_or_default();
    if env_url.trim().is_empty() {
        read_relay_url_config().unwrap_or_default()
    } else {
        env_url
    }
}

/// Tray menu item id for revealing the main window.
const TRAY_SHOW_EVENT: &str = "blackcrab-tray-show";
/// Tray menu item id for quitting the app for real.
const TRAY_QUIT_EVENT: &str = "blackcrab-tray-quit";

/// Builds the menu-bar tray icon with "Show Blackcrab" and "Quit" items.
/// Selecting "Show" reveals + focuses the main window; "Quit" exits the
/// process (the only path that actually tears the host down, since closing the
/// window merely hides it).
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, TRAY_SHOW_EVENT, "Show Blackcrab", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_EVENT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Blackcrab")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_EVENT => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            TRAY_QUIT_EVENT => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Toggles whether Blackcrab launches at login. Exposed to the UI so the user
/// can opt out of the default-on behavior.
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())
    } else {
        autostart.disable().map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(unix, not(debug_assertions)))]
    hydrate_login_shell_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .menu(blackcrab_menu)
        .on_menu_event(|app, event| {
            if event.id() == OPEN_SETTINGS_EVENT {
                let _ = app.emit(OPEN_SETTINGS_EVENT, ());
            }
        })
        // Close-to-tray: hiding the window keeps the LAN server + relay client
        // running so the host stays reachable "as long as the computer is on".
        // A real quit happens via the tray "Quit" item (`app.exit(0)`).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            claude_preflight,
            claude_token_status,
            save_claude_oauth_token,
            clear_claude_oauth_token,
            start_session,
            send_message,
            send_raw,
            stop_session,
            interrupt_session,
            default_cwd,
            list_sessions,
            load_session,
            list_branches,
            switch_branch,
            preview_navigate,
            window_top_inset,
            load_session_tail,
            git_remote_url,
            set_session_title,
            set_session_archived,
            delete_session,
            write_text_file,
            read_text_file,
            list_session_overrides,
            save_dropped_file,
            list_tracked_files,
            search_sessions,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            remote_host_info,
            remote_relay_url,
            set_relay_config,
            get_relay_config,
            remote_transport_info,
            set_session_read_cursor,
            session_read_cursors,
            mark_session_read_latest,
            remote_notify_session_started,
            remote_notify_action_failed,
            pairing_start,
            pairing_accept,
            pairing_cancel,
            pairing_list_devices,
            pairing_revoke,
            set_autostart
        ])
        .setup(|app| {
            let server = transport_server();

            // Spawn the remote-action consumer before starting the server so
            // the sender is registered by the time any connection authenticates.
            let state = app.state::<AppState>();
            let sessions = state.sessions.clone();
            let session_owners = state.session_owners.clone();
            // Stash a handle so the (sync) session snapshot can tell which
            // sessions Blackcrab owns and thus are reachable for the phone.
            let _ = SESSION_OWNERS.set(state.session_owners.clone());
            let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<RemoteCommand>();
            let _ = REMOTE_CMD_TX.set(tx);
            // Real-time host->mobile push channel (approvals); the initial
            // receiver is dropped — connections subscribe to the sender.
            let (bcast, _bcast_rx) = broadcast::channel::<serde_json::Value>(64);
            let _ = REMOTE_BROADCAST.set(bcast);
            let consumer_app = app.handle().clone();
            tauri::async_runtime::spawn(run_remote_command_consumer(
                rx,
                sessions,
                session_owners,
                consumer_app,
            ));

            tauri::async_runtime::spawn(async move {
                let pairing = match pairing_service() {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("transport: pairing service unavailable: {e}");
                        return;
                    }
                };
                if let Err(e) = server.start(pairing, remote_hooks()).await {
                    eprintln!("transport: failed to start: {e}");
                }
            });

            // Optional outbound relay client: only when both env vars are set.
            // Lets paired phones reach this host off-LAN; the LAN server is
            // unaffected.
            maybe_start_relay_client();

            // Menu-bar tray icon so the host stays reachable while the window
            // is hidden. Best-effort: a failure here must not block startup.
            if let Err(e) = setup_tray(app.handle()) {
                eprintln!("tray: failed to set up: {e}");
            }

            // Autostart at login so the host returns after a reboot. Enable by
            // default if not already enabled; best-effort so a failure (e.g. a
            // sandboxed/unsupported environment) never blocks startup.
            let autostart = app.autolaunch();
            match autostart.is_enabled() {
                Ok(false) => {
                    if let Err(e) = autostart.enable() {
                        eprintln!("autostart: failed to enable: {e}");
                    }
                }
                Ok(true) => {}
                Err(e) => eprintln!("autostart: failed to query state: {e}"),
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn blackcrab_menu(app_handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app_handle)?;

    #[cfg(target_os = "macos")]
    {
        let settings = MenuItem::with_id(
            app_handle,
            OPEN_SETTINGS_EVENT,
            "Settings...",
            true,
            Some("CmdOrCtrl+,"),
        )?;
        let separator = PredefinedMenuItem::separator(app_handle)?;
        let items = menu.items()?;

        if let Some(app_menu) = items.first().and_then(|item| item.as_submenu()) {
            app_menu.insert_items(&[&settings, &separator], 2)?;
        }
    }

    Ok(menu)
}
