use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Provider {
    Claude,
    Codex,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInfo {
    pub id: Provider,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub installed: bool,
    pub client_ready: bool,
    pub capabilities: ProviderCapabilities,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCapabilities {
    pub resume: bool,
    pub streaming: bool,
    pub model_selection: bool,
    pub permission_modes: &'static [&'static str],
    pub worktrees: bool,
    pub steering: bool,
}

pub(crate) struct LaunchRequest {
    pub provider: Option<String>,
    pub cwd: String,
    pub permission_mode: Option<String>,
    pub model: Option<String>,
    pub resume_id: Option<String>,
    pub use_worktree: bool,
}

#[derive(Debug)]
pub(crate) struct LaunchSpec {
    pub provider: Provider,
    pub cwd: String,
    pub args: Vec<String>,
    pub resume_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: String,
}

const CLAUDE_MODES: &[&str] = &["default", "acceptEdits", "plan", "bypassPermissions"];

impl Provider {
    pub fn parse(id: Option<&str>) -> Result<Self, String> {
        match id {
            None | Some("claude") => Ok(Self::Claude),
            Some("codex") => Ok(Self::Codex),
            Some(other) => Err(format!("unsupported provider: {other}")),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    pub fn executable(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    pub fn info(self, installed: bool) -> ProviderInfo {
        match self {
            Self::Claude => ProviderInfo {
                id: self,
                display_name: "Claude Code",
                executable: self.executable(),
                installed,
                client_ready: true,
                capabilities: ProviderCapabilities {
                    resume: true,
                    streaming: true,
                    model_selection: true,
                    permission_modes: CLAUDE_MODES,
                    worktrees: true,
                    steering: false,
                },
            },
            Self::Codex => ProviderInfo {
                id: self,
                display_name: "Codex",
                executable: self.executable(),
                installed,
                client_ready: false,
                capabilities: ProviderCapabilities {
                    resume: true,
                    streaming: true,
                    model_selection: true,
                    permission_modes: &["default", "readOnly"],
                    worktrees: false,
                    steering: false,
                },
            },
        }
    }

    pub fn control_message(self, line: &str) -> Result<String, String> {
        match self {
            Self::Codex => Err(
                "Codex uses typed approval and interrupt commands; raw input is unavailable".into(),
            ),
            Self::Claude => {
                let value: serde_json::Value =
                    serde_json::from_str(line).map_err(|e| e.to_string())?;
                match value["type"].as_str() {
                    Some("control_request" | "control_response") => Ok(format!("{value}\n")),
                    _ => Err("raw input accepts control messages only; use send_message for journaled user messages".into()),
                }
            }
        }
    }

    pub fn user_message(self, text: &str) -> Result<String, String> {
        match self {
            Self::Claude => Ok(format!(
                "{}\n",
                serde_json::json!({
                    "type": "user",
                    "message": { "role": "user", "content": text }
                })
            )),
            Self::Codex => Err("Codex user input must use the journal-backed runtime".into()),
        }
    }
}

pub(crate) fn normalize_model_arg(model: Option<String>) -> Option<String> {
    nonblank(model)
}

fn nonblank(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

pub(crate) fn prepare_launch(
    request: LaunchRequest,
    home: Option<String>,
) -> Result<LaunchSpec, String> {
    let provider = Provider::parse(request.provider.as_deref())?;
    if request.cwd.is_empty() || !Path::new(&request.cwd).is_dir() {
        return Err(format!(
            "project directory doesn't exist: {} — pick a new cwd or remove this session",
            if request.cwd.is_empty() {
                "(none)"
            } else {
                &request.cwd
            }
        ));
    }
    let mode = request.permission_mode.unwrap_or_else(|| {
        if provider == Provider::Codex {
            "default".into()
        } else {
            "bypassPermissions".into()
        }
    });
    let model = normalize_model_arg(request.model);
    let resume_id = nonblank(request.resume_id);
    if provider == Provider::Codex {
        if !["default", "readOnly"].contains(&mode.as_str()) {
            return Err(format!("unsupported Codex permission mode: {mode}"));
        }
        if request.use_worktree {
            return Err("Codex managed worktrees are not implemented yet".into());
        }
        return Ok(LaunchSpec {
            provider,
            cwd: request.cwd,
            args: vec!["app-server".into(), "--listen".into(), "stdio://".into()],
            resume_id,
            model,
            permission_mode: mode,
        });
    }
    if !CLAUDE_MODES.contains(&mode.as_str()) {
        return Err(format!("unsupported Claude permission mode: {mode}"));
    }
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        &mode,
    ]
    .into_iter()
    .map(String::from)
    .collect();

    if mode == "bypassPermissions" {
        args.extend(["--add-dir".into(), "/".into()]);
    } else if let Some(home) = home {
        args.extend(["--add-dir".into(), home]);
    }
    // Historical model IDs may be retired; Claude resume resolves its own model.
    if let Some(id) = &resume_id {
        args.extend(["--resume".into(), id.clone()]);
    } else {
        if let Some(model) = &model {
            args.extend(["--model".into(), model.clone()]);
        }
        if request.use_worktree && Path::new(&request.cwd).join(".git").exists() {
            args.push("--worktree".into());
        }
    }
    Ok(LaunchSpec {
        provider,
        cwd: request.cwd,
        args,
        resume_id,
        model,
        permission_mode: mode,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LaunchRequest {
        LaunchRequest {
            provider: None,
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            permission_mode: None,
            model: Some("  sonnet  ".into()),
            resume_id: None,
            use_worktree: false,
        }
    }

    #[test]
    fn fresh_launch_preserves_streaming_model_and_directory_policy() {
        let spec = prepare_launch(request(), Some("/home/test".into())).unwrap();
        assert_eq!(spec.provider, Provider::Claude);
        assert_eq!(
            spec.args,
            [
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--permission-mode",
                "bypassPermissions",
                "--add-dir",
                "/",
                "--model",
                "sonnet",
            ]
        );
        let mut req = request();
        req.permission_mode = Some("plan".into());
        let spec = prepare_launch(req, Some("/home/test".into())).unwrap();
        assert!(spec
            .args
            .windows(2)
            .any(|a| a == ["--add-dir", "/home/test"]));
    }

    #[test]
    fn resume_ignores_historical_model_and_worktree_creation() {
        let mut req = request();
        req.resume_id = Some("  saved-session  ".into());
        req.use_worktree = true;
        let spec = prepare_launch(req, None).unwrap();
        assert_eq!(spec.resume_id.as_deref(), Some("saved-session"));
        assert!(!spec
            .args
            .iter()
            .any(|a| a == "--model" || a == "--worktree"));
        assert!(spec
            .args
            .windows(2)
            .any(|a| a == ["--resume", "saved-session"]));
    }

    #[test]
    fn invalid_requests_fail_during_preparation() {
        let mut req = request();
        req.provider = Some("unknown-provider".into());
        assert!(prepare_launch(req, None)
            .unwrap_err()
            .contains("unsupported provider"));
        let mut req = request();
        req.cwd = String::new();
        assert!(prepare_launch(req, None).unwrap_err().contains("(none)"));
        let mut req = request();
        req.permission_mode = Some("typo".into());
        assert!(prepare_launch(req, None)
            .unwrap_err()
            .contains("permission mode"));
    }

    #[test]
    fn blank_resume_is_fresh_and_no_git_directory_skips_worktrees() {
        let mut req = request();
        req.resume_id = Some(" \t ".into());
        req.use_worktree = true;
        let spec = prepare_launch(req, None).unwrap();
        assert!(spec.resume_id.is_none());
        assert!(!spec.args.iter().any(|a| a == "--worktree"));
        assert!(spec.args.windows(2).any(|a| a == ["--model", "sonnet"]));
    }

    #[test]
    fn fresh_worktree_accepts_git_files_used_by_linked_worktrees() {
        let root = std::env::temp_dir().join(format!(
            "blackcrab-provider-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join(".git"), "gitdir: /unused/fixture").unwrap();
        let mut req = request();
        req.cwd = root.to_string_lossy().into_owned();
        req.use_worktree = true;
        let spec = prepare_launch(req, None).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(spec.args.iter().any(|arg| arg == "--worktree"));
    }

    #[test]
    fn control_framing_cannot_bypass_journaled_delivery() {
        let wire = Provider::Claude.control_message(r#"{"type":"control_request","request":{"subtype":"set_permission_mode","mode":"plan"}}"#).unwrap();
        assert_eq!(wire.lines().count(), 1);
        assert!(Provider::Claude
            .control_message(r#"{"type":"control_response","response":{"subtype":"success"}}"#)
            .is_ok());
        assert!(Provider::Claude
            .control_message(r#"{"type":"user","message":{"content":"untracked"}}"#)
            .unwrap_err()
            .contains("send_message"));
        assert!(Provider::Claude.control_message("{}\n{}").is_err());
    }

    #[test]
    fn message_framing_preserves_multiline_text_as_one_json_line() {
        let wire = Provider::Claude.user_message("line one\n\"two\"").unwrap();
        assert_eq!(wire.lines().count(), 1);
        let value: serde_json::Value = serde_json::from_str(&wire).unwrap();
        assert_eq!(value["message"]["content"], "line one\n\"two\"");
        assert!(wire.ends_with('\n'));
    }
}

#[cfg(test)]
mod codex_tests {
    use super::*;
    fn request() -> LaunchRequest {
        LaunchRequest {
            provider: Some("codex".into()),
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            permission_mode: None,
            model: Some(" chosen-model ".into()),
            resume_id: Some(" thread-id ".into()),
            use_worktree: false,
        }
    }
    #[test]
    fn codex_launch_validates_its_own_contract_without_claiming_client_readiness() {
        let spec = prepare_launch(request(), Some("/unused".into())).unwrap();
        assert_eq!(spec.provider, Provider::Codex);
        assert_eq!(spec.args, ["app-server", "--listen", "stdio://"]);
        assert_eq!(spec.permission_mode, "default");
        assert_eq!(spec.model.as_deref(), Some("chosen-model"));
        assert_eq!(spec.resume_id.as_deref(), Some("thread-id"));
        let info = serde_json::to_value(Provider::Codex.info(true)).unwrap();
        assert_eq!(info["clientReady"], false);
        assert_eq!(info["capabilities"]["worktrees"], false);
        for mode in ["bypassPermissions", "plan", "typo"] {
            let mut req = request();
            req.permission_mode = Some(mode.into());
            assert!(prepare_launch(req, None).is_err());
        }
        let mut req = request();
        req.use_worktree = true;
        assert!(prepare_launch(req, None).unwrap_err().contains("worktrees"));
        assert!(Provider::Codex.user_message("untracked").is_err());
        assert!(Provider::Codex
            .control_message(r#"{"type":"control_response"}"#)
            .is_err());
    }
}
