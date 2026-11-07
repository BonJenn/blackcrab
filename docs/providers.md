# Provider boundary

Blackcrab currently runs **Claude Code only**. The provider boundary prepares
launch requests and frames user messages independently of Tauri and view state.
It does not add Codex support yet.

`list_providers` returns the implemented provider IDs, executable availability,
and capabilities. Executable presence is not an authentication check; the
existing `claude_preflight` command remains authoritative for Claude login.
Capabilities describe this adapter, not every possible behavior of the CLI.
Steering is false until Blackcrab has a supported implementation.

`start_session` accepts an optional `provider` ID. Omission means `claude` for
existing desktop and remote call sites. Unknown IDs fail explicitly, before
replacing a panel process. Invalid working directories and permission modes
also fail before process replacement.

The Claude adapter preserves stream-json, partial messages, permission modes,
directory scope, model trimming, and CLI-managed fresh-session worktrees.
Resuming omits model overrides and worktree creation: historical model IDs can
expire, and a resumed session already has its working directory. Claude token
selection and stream event names remain compatible with existing clients.

Future adapters must supply their own launch, wire protocol, transcript and
approval translation, capabilities, auth and persistence. They must not reuse
Claude's credentials or send Claude-shaped input to an unrelated CLI.
