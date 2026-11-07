# Privacy

Blackcrab is designed as a local desktop app.

## What Blackcrab Reads

- Claude Code session JSONL files under `~/.claude/projects`.
- Project directories and file paths you choose in the UI.
- Git metadata for selected project directories, such as branches and remotes.
- Files you explicitly attach by drag-and-drop.

## What Blackcrab Sends

Blackcrab sends messages to your local `claude` CLI subprocess. The CLI is
responsible for any network requests to Anthropic or configured providers.

Blackcrab does not proxy Claude traffic or ask for Anthropic credentials.

When paired mobile access is used, the host sends queue snapshots and action
receipts over its existing LAN or encrypted relay connection to paired devices.
Snapshots include pending message text, including any attachment paths already
embedded in that text. Queue responses use the existing host-wide paired-device
broadcast channel. See [`docs/remote-follow-up-queues.md`](docs/remote-follow-up-queues.md).

If anonymous analytics are enabled, Blackcrab sends app launch and updater
events to `https://www.blackcrab.app/api/events`. Those events include platform,
current version, update target version when applicable, event type, and a
locally generated anonymous install id. The server hashes that install id before
storage. Prompts, transcripts, project paths, file contents, and Anthropic
credentials are not included. This can be turned off in Settings.

## Local Storage

Blackcrab stores UI preferences in browser localStorage, including theme,
sidebar/grid sizing, grid panel state, and short-lived composer drafts.

Composer drafts are keyed by session id and pruned after 30 days by the app.
Unconfirmed desktop queue submissions retain their original text, attachment paths,
command ID and draft identity in localStorage until confirmed. These unencrypted
recovery records do not expire automatically, are excluded from settings backups,
and are never resubmitted automatically on reload. See
[`docs/follow-up-queues.md`](docs/follow-up-queues.md).

The local execution journal stores submitted message text, project paths, thread
identities and turn receipts under the application data directory. Follow-up
queues also retain original and edited message text, including cancelled command
IDs for retry deduplication. It supports
duplicate-command detection and interruption recovery. Receipts are not included
in analytics or the existing UI-settings backups. There is no automatic receipt
retention or purge UI yet; deleting a session does not erase its journal. See
[`docs/execution-store.md`](docs/execution-store.md) for storage and removal details.

## Preview Webview

The preview panel can open HTTP and HTTPS URLs. Local development URLs may be
auto-detected from transcript output. Content loaded in the preview panel is
controlled by the website or local server you open.

## Logs and Transcripts

Claude Code transcripts may contain prompts, file paths, command output, and
tool results. Treat exported Markdown transcripts and session JSONL files as
potentially sensitive.
