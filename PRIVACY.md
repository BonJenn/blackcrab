# Privacy

Blackcrab is designed as a local desktop app.

## What Blackcrab Reads

- Claude Code session JSONL files under `~/.claude/projects`.
- Codex account status, model catalog and stored history requested in its panel.
- Project directories and file paths you choose in the UI.
- Git metadata for selected project directories, such as branches and remotes.
- Files you explicitly attach by drag-and-drop.

## What Blackcrab Sends

Blackcrab sends messages to your local `claude` CLI subprocess. The native API
also supports explicitly requested Codex app-server sessions through the dedicated
conversation preview; general provider integration remains incomplete. Each CLI is responsible for
network requests to its configured provider. Typed provider events can contain
prompt/tool output and are sent to the local app window, not analytics.

Blackcrab does not proxy Claude traffic or ask for Anthropic credentials.

When paired mobile access is used, the host sends queue snapshots and action
receipts over its existing LAN or encrypted relay connection to paired devices.
Snapshots include pending message text, including any attachment paths already
embedded in that text. Queue responses use the existing host-wide paired-device
broadcast channel. See [`docs/remote-follow-up-queues.md`](docs/remote-follow-up-queues.md).

Vite development mode does not submit product analytics. For production frontend
builds, if anonymous analytics are enabled, Blackcrab sends app launch and updater
events to `https://www.blackcrab.app/api/events`. Those events include platform,
current version, update target version when applicable, event type, and a
locally generated anonymous install id. The server hashes that install id before
storage. Prompts, transcripts, project paths, file contents, and Anthropic
credentials are not included. This can be turned off in Settings.

## Local Storage

Blackcrab stores UI preferences in browser localStorage, including theme,
sidebar/grid sizing, grid panel state, and short-lived composer drafts.

The mobile app also retains unconfirmed text queue submissions in app document
files (`queue-recovery-v1`), or localStorage on web. These contain original text
and retry identities, are unencrypted, and have no automatic expiry. Confirmed
records are removed; crash temp files may remain. OS/browser backups may include
this app data. Forgetting a paired host does not erase recovery records. See the
[mobile queue guide](apps/mobile/README.md#follow-up-queues).

Mobile text drafts are stored separately per host/session as unencrypted JSON
in `documentDirectory/drafts-v1`, or `blackcrab.mobile.draft.v1.*` localStorage on
web. They contain text and edit identity, have no automatic expiry, and survive
forgetting a pairing. OS/browser backups may include them; crashes may leave
temporary files. See the [mobile draft guide](apps/mobile/README.md#durable-text-drafts).

Mobile startup host selection stores only a host ID or disconnected choice under
`blackcrab.mobile.hostSelection.v1` in native SecureStore or web localStorage.
Disconnect/forgetting the selected host replaces it with a disconnected choice.
It is separate from pairing credentials and does not erase draft/recovery data.

Desktop composer drafts are keyed by session id and pruned after 30 days by the app.
Unconfirmed desktop queue submissions retain their original text, attachment paths,
command ID and draft identity in localStorage until confirmed. These unencrypted
recovery records do not expire automatically, are excluded from settings backups,
and are never resubmitted automatically on reload. See
[`docs/follow-up-queues.md`](docs/follow-up-queues.md).

The Codex live-client controller also defines unconfirmed-message recovery records
under `blackcrab.codexOutbox.v1.*`: original text, send/queue mode and command,
thread, run and provider-session identities. These records are unencrypted, have
no automatic expiry, stay out of settings backups and are never resubmitted on
reload. They are removed only after receipt confirmation or explicit discard;
discard does not cancel provider work. The dedicated conversation preview uses
this controller. Provider output is held only in bounded in-memory display
state by this controller; the CLI owns its stored history.

The dedicated Codex workspace also stores its project/model/native thread choice,
unsent draft and draft target under `blackcrab.codexWorkspace.v1.*`. These records
are unencrypted, excluded from settings backups and do not expire automatically.
Clear draft empties the current draft. Unreadable saved data is retained until
explicit reset; storage failures keep new input in memory. Permissions reset to
read-only on app reload. Closing the panel keeps its current run and draft alive;
it is not the same as stopping the run.

The local execution journal stores submitted message text, project paths, thread
identities, provider-turn mappings and turn receipts under the application data directory. Follow-up
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
