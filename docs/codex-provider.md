# Codex provider implementation

## Current boundary

Steps 05a and 05b add a private Rust stdio transport and a journal-backed Codex
thread/turn runtime. The runtime can create/resume threads, submit deduplicated
turns, drain follow-ups, interrupt, and answer supported one-time approvals.
Its typed events carry text, item/tool lifecycle, token usage and terminal error
payloads.

The native host and read services are connected to the **Codex preview** desktop
workspace, selected through the main **Provider** control. Provider selection is
saved independently of Claude setup and does not start or stop a session. Both
provider views keep their conversation owners mounted across switches; the
inactive view is hidden and inert. Claude shortcuts and file drops are scoped to
the Claude view, so Codex input does not mutate a hidden Claude composer.
Returning to Claude shows any unresolved setup again.
It includes history/account/model browsing and a **Conversation preview** for
up to six independently owned conversations, explicit start/resume, plain-text
sends, streamed output, queue controls and one-time command/file approvals.
Single/grid views retain hidden runs and drafts; history preparation targets the
selected pane. The original preview keeps its existing owner and storage keys.
Pane removal requires a stopped/idle owner, resolved recovery, known empty queues
for existing sessions and no unsent draft. Removing a pane retains its saved
workspace and provider history; it never stops a running session. Mixed
Claude/Codex grids and provider-aware mobile controls remain pending. Discovery
therefore keeps Codex `clientReady: false`; the dedicated preview does not imply
provider-wide readiness. An isolated macOS native run has verified the dedicated
preview against a local CLI stand-in (see [native QA](codex-native-qa.md)).
Mixed-provider grid and multi-window scenarios
and actual Codex model turns remain unverified; step 05c3b4 covers those gates
before general integration.

The local reference is `codex-cli 0.166.0`. Its generated JSON Schema confirms the
initialize response fields; the implementation requires a `userAgent` string and
allows additional response fields for compatibility. Protocol behavior follows
[official stdio documentation](https://learn.chatgpt.com/docs/app-server#protocol)
and [initialization documentation](https://learn.chatgpt.com/docs/app-server#initialization).
No T3 implementation or generated source was copied into this module.

## Transport behavior

- Spawn a caller-supplied executable/command with piped stdio and kill-on-drop.
  The caller owns cwd and environment policy. No shell, network listener, login,
  credential override or automatic reconnect is introduced.
- Send one initialize request identifying Blackcrab, validate its response, then
  flush initialized before returning a usable client. Experimental API opt-in is
  disabled. Public operations cannot repeat initialization.
- Correlate local requests independently of server-initiated requests, even when
  their numeric IDs match. Notifications and server requests preserve their
  parameters and arrival order. Unknown client response IDs are ignored.
- Return structured remote errors without terminating a healthy connection.
  Server requests require an explicit response from the adapter; the transport
  never approves a request or guesses its policy. Duplicate server request IDs
  and responses to unknown/already-answered requests are rejected.
- Keep a partial JSONL frame alive while processing other commands. Reads and
  writes run independently, so a blocked stdin cannot prevent reading output or
  enforcing a request deadline. Invalid/ambiguous, oversized and unterminated
  frames fail the connection.
- Default to 8 MiB frames (excluding LF), 64 queued commands/writes/events,
  64 pending requests in each direction and 30-second request/write deadlines.
  Explicit options allow fixture limits; capacity must be 1–1024. Full request
  queues return Busy before handoff; event overflow closes instead of silently
  dropping approval or lifecycle events. The adapter must drain events promptly.
- Drain stderr in fixed chunks and retain only a byte count, without copying
  diagnostic text into logs or the event queue. RPC parameters/results/errors
  can contain sensitive provider data; future callers must not log them blindly.
- Timeout, process/pipe failure and shutdown fail outstanding calls without
  replay. Closing waits for bounded process cleanup, including after a timeout.
  Dropping the last client closes the transport. Dropping the event receiver also
  closes it. Kill-on-drop remains a fallback if cleanup is interrupted.

RPC request IDs provide connection-local response matching, **not** durable
command deduplication. The runtime provides the journal integration below. A failed/expired call may already have reached the provider;
closing its process cannot undo side effects. Cancellation of a Rust request
future does not cancel an already handed-off provider action. The transport alone does not implement provider interrupt, approvals or
durable receipt semantics; those belong to the runtime layer.

## Runtime and journal

The runtime sends `thread/start` or `thread/resume`, validates the returned
provider thread identity and cwd, and binds it to the journal. An OS file lock
for that journal thread prevents a second Blackcrab runtime, even while idle.
External Codex programs do not participate in this lock; a returned active thread
status is rejected, but broader host/external-writer coordination remains later
host integration work.

A turn begins with a committed journal receipt before `turn/start` is written.
The stable command ID is also sent as `clientUserMessageId`. RPC IDs, journal
thread/turn IDs and provider thread/turn IDs remain distinct. Schema 3 persists
provider-turn mappings; completion updates require the matching command, run,
thread and provider turn, so a stale completion cannot finish later work.

Events arriving before the start acknowledgement are buffered with a limit of
64, then reconciled to the acknowledged provider turn. A terminal start response
is also authoritative. Successful terminal results drain eligible queued work;
failed/interrupted results, interruption requests, denied/unsupported input and
runtime loss keep it held. Resume/restart does not automatically unpause work.
The runtime uses the same edit/cancel/reorder/revision and claim transactions as
Claude queues. Retrying a command returns its existing receipt without another
provider write, including after a resumed runtime.

Supported command/file approval requests become opaque, turn-bound approval IDs.
Only an explicit one-time accept, decline or cancel is accepted. Replies to old,
unknown or already-answered IDs are rejected. Session-wide grants, policy
amendments, file approvals requesting a grant root and other server request types
are not implemented: unsupported requests receive an RPC error and hold follow-ups.
The native answer endpoint routes these decisions, while client UI remains
pending. Item/tool payloads are preserved for presentation; this step does not
yet render them in the application.

Interrupt holds queued work before writing `turn/interrupt`. Its RPC reply is not
substituted for a terminal result; the provider completion drives the receipt.
Closing the runtime stops the app-server connection, holds work and records an
interrupted/uncertain receipt when no terminal result was known. It cannot undo
provider/tool side effects. A missing start acknowledgement is uncertain, not a
reason to start another turn. The caller must drain typed events; overflow or
journal failure closes dispatch rather than silently dropping lifecycle state.

## Native host API

- `list_providers` returns installation/capability metadata and `clientReady`.
  Codex is installed when its executable is found, but client readiness remains
  false. Installation is not evidence of login, model availability or full client readiness.
- `start_session` accepts `provider: "codex"` with permission mode `default`
  (workspace-write/on-request) or `readOnly` (read-only/on-request). Model is
  optional and passed exactly as selected; resume uses the provider's native
  thread ID. Unsupported modes/worktrees fail before replacing the current
  panel. A missing executable also fails before replacement. No Claude keychain
  token is injected into the Codex command; the normal CLI environment/account
  remains Codex-owned. Full-access, plan and steering modes are not implemented.
- `send_message`, `queue_message`, `session_queue`, `update_session_queue`,
  `interrupt_session` and `stop_session` route according to the panel's backend.
  Codex owns receipt preparation and queue dispatch internally; the host never
  creates a second turn or writes a Claude input line for it.
- `session_execution` includes the provider, local journal thread/run IDs,
  process status, and Codex `providerSessionId`. `execution_history` and
  `execution_queue` accept `provider: "codex"` for journal reads. These are not
  provider transcript/history indexing. `execution_provider_turn({commandId})`
  reads the provider-turn mapping separately from its stable receipt.
- `answer_provider_approval({panelId, approvalId, decision})` accepts only
  `accept`, `decline` or `cancel` for a current opaque Codex approval ID. Claude
  retains its existing control path. `send_raw` rejects Codex input, including
  control messages; callers cannot inject arbitrary RPC frames.

`provider-event` carries `{panel_id, run_id, provider: "codex", event}` with the
runtime's typed event body. Codex events do not masquerade as Claude stream JSON.
User/queue events also feed the existing queue-dispatched/changed signals, so
queue clients can reconcile stable command IDs. Future consumers must filter
panel/run/provider identities and avoid appending both the typed User and its
queue-dispatch echo. Old readers stop forwarding and cannot clear a replacement
run's ownership. Registry and owner cleanup stay under the same lock.
Startup still holds the shared session registry lock, as the existing Claude
host does; another panel's command can wait for startup to finish. Per-panel
startup isolation remains future host work before broader client readiness.

Codex ownership keys use `codex:<nativeThreadId>`; legacy Claude ownership remains
compatible with existing phones. The current remote protocol and history
snapshots still target Claude, and do not discover or route Codex sessions yet.
Legacy remote sends/stops and raw approval input reject a Codex-owned panel.
The host still belongs to the desktop app; this does not create an independent
host or guarantee background operation after app exit.

## Run-specific live controls

`codex_control({panelId, expectedRunId, action})` is the intended write interface
for the dedicated preview and future general desktop Codex controls. Actions are a closed tagged union:

```json
{"type":"submit","commandId":"stable-command-id","text":"message","queued":false}
{"type":"queue"}
{"type":"changeQueue","expectedRevision":3,"change":{"type":"pause"}}
{"type":"interrupt"}
{"type":"answer","approvalId":"opaque-approval-id","decision":"decline"}
{"type":"stop"}
```

Replies are `{type: "receipt", data: receipt}`, `{type: "queue", data: snapshot}`,
or `{type: "done"}`. Submit uses the existing durable execution/queue path and
requires the caller's stable command ID; queued submission uses `queued: true`.
Queue changes retain optimistic revisions; approvals allow only one-time
`accept`, `decline` and `cancel`. Unknown action fields and broad approval grants
are rejected before dispatch. There is no arbitrary JSONL/RPC/control action.

The native endpoint checks provider, panel and exact run identity together while
holding the session registry lock. It clones that specific runtime before
releasing the lock; a later replacement can close the handle but cannot redirect
its action to a new run. Stop retains the lock through termination, journal
finalization and ownership release. A stale stop cannot remove a replacement or
release its ownership. Finished matching runs permit saved queue reads and stop
cleanup, while other actions require resuming the original session.

`src/codexControl.ts` reads/validates native Codex context, includes the intended
run on every operation, checks receipt command/thread identity and queue thread/
revision shape, and never falls back to the older panel-only APIs or retries a
failed write automatically. Those APIs remain for compatibility; new Codex live
UI must use this guarded interface. The thin bridge delegates outbox/lifecycle state to `codexLive.ts` and rendering
to `CodexConversation.tsx`. General client readiness remains false until the
remaining integration and native/real-turn scenarios are complete.

## Live client state

`src/codexLive.ts` provides one `CodexLiveClient` per owned panel with an injected
backend/storage boundary. It now backs the dedicated conversation preview. General desktop/mobile
integration remains incomplete and `clientReady` stays false.

- Subscribe to typed provider events before starting a session. Capture an early
  ready event and reconcile it against native journal/run/provider identity.
  Discovering an existing live run, or losing the startup acknowledgement, leaves
  the client detached; it never silently replaces that runtime or replays input.
- Persist each unconfirmed message before calling the guarded submit endpoint.
  The `blackcrab.codexOutbox.v1.<panelId>` record includes the original text, queue
  mode, command ID, local journal thread/run and native provider session ID.
  Storage failures leave the draft untransferred and make no submit call.
- A lost submit acknowledgement is checked against its durable receipt. If still
  unknown, retain the record. Reload reads recovery state without resubmission.
  Explicit retry first checks the receipt and only reuses the original ID/body
  on the original resumed session; it never invents a new command to retry.
  Cross-command/thread receipts and changed recovery records cannot clear it.
  Corrupt/unreadable records block startup/writes until explicitly discarded.
  Discard only forgets local recovery data; it does not undo provider work.
- Filter every event by provider/panel/run. Bind command IDs to provider-turn IDs
  before accepting output, usage or approvals. User echoes deduplicate by command
  ID, completed items replace streamed text, and late acknowledgements cannot
  regress terminal receipts. Resolved opaque approvals are not reopened by a
  repeated request. Late responses from superseded runs/disposed clients cannot
  alter current state or clear their recovery record.
- Queue events/reads retain newer revisions. Edits keep the caller's revision;
  conflicts refresh state without repeating the mutation or resuming a queue.
  Interrupt waits for a terminal event before clearing busy state. Stop and
  closed events reconcile the active receipt and saved queue with read-only
  journal queries; neither path replays a turn.

Live display state is bounded: 100 user echoes, 200 output items, 128 Ki characters
per item/echo and 2 Mi characters of output, plus bounded usage/notices/approval
previews and 256 recent receipt/turn identities. Truncation is explicit; complete
history remains provider-owned and available through the history browser. Live
state is not a durable replay log and does not claim seamless reconnect or
exactly-once delta delivery. Existing runs require history review and explicit
stop/resume after client reload. Disposing the controller removes listeners but
does not stop its native run; the workspace owner keeps it mounted across modal/tab changes; native window and
app-exit behavior still needs scenario evidence.

The native backend uses explicit Codex launch options, no managed worktrees, the
run-guarded control endpoint, and provider-specific journal reads. It does not
change CLI auth or choose a replacement model. General desktop integration still needs
scenario/visual evidence and opt-in real-turn validation before readiness.

## Account, model and history reads

`codex_query({query})` is a separate read-only native command. Its tagged query
forms are:

```json
{"type":"account"}
{"type":"models","page":{"cursor":null,"limit":50}}
{"type":"threads","page":{},"cwd":"/absolute/project","archived":false}
{"type":"thread","threadId":"native-thread-id"}
{"type":"turns","threadId":"native-thread-id","page":{},"itemsView":"notLoaded"}
{"type":"items","threadId":"native-thread-id","turnId":"native-turn-id","page":{}}
```

Each response is `{provider: "codex", result: {type, data}}`. Page data contains
`data`, `nextCursor` and `backwardsCursor`; pass opaque cursors unchanged with the
same filters. Limits default to 50 and must be 1–100. Turn pages are newest first,
item pages oldest first; times from the CLI remain in their documented units
(thread/turn timestamps in seconds, item timestamps in milliseconds).

Account reads set `refreshToken: false` and return only account type, ChatGPT
email/plan/workspace when present, and `requiresOpenaiAuth`. They do not log in,
log out or return tokens. Models come from the CLI catalog, including its exact
model IDs, effort choices and service tiers; no catalog or availability is
hardcoded. Hidden models are excluded. Catalog scope is the app-server's normal
CLI configuration, not the history `cwd` filter.

History listing covers CLI, VS Code and app-server sources across model
providers. It uses the state DB without scanning/repairing rollout metadata;
older unindexed history may need CLI-side repair before it appears. Thread
metadata reads use `includeTurns: false`. Turn reads default to `notLoaded`;
clients may explicitly request `summary` or `full` items for one bounded turn
page, including legacy history. Item pagination depends on CLI/history support;
unsupported reads return a useful error without resuming a thread or falling
back to unbounded hydration. Unknown item types remain tagged data for future
renderers, and all history text is untrusted content.

At most two discovery requests run concurrently, each on a temporary stdio
app-server connection with existing transport limits/deadlines. The connection
is closed/reaped after success or failure, and dropping a cancelled request
closes its transport. These requests never take the live session registry lock,
create/resume a thread, start a model turn, accept approvals, request proactive account refresh or supply external
auth credentials. Unexpected server requests fail closed. RPC diagnostics
and incompatible payloads are not echoed to the UI; account/model/thread DTOs
exclude unrecognized fields. Thread status is the temporary server's view and
must be reconciled with `session_execution` for Blackcrab's live runs.

Sources: [official app-server API overview](https://learn.chatgpt.com/docs/app-server#api-overview),
[history pagination](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters),
and the generated local CLI 0.166.0 schemas. Login/logout and live account/catalog
subscriptions remain subsequent work. Client readiness is still false.

## Desktop browser

The top bar's **Codex** button opens a lazy-loaded native modal browser.
It reads CLI/VS Code/app-server thread history across model providers, filters by
an absolute project directory or archived status, and loads additional pages
only on request. Selecting a thread loads its turn summaries; **View items** reads
one selected turn's item pages. The explicit **Include full items in each turn
page** option supports legacy history without automatic full-transcript loading.
Unknown item types retain their data in expandable details. Text/tool output is
rendered as inert React text, including angle brackets and potential HTML.

**Models** and **Account** fetch only when selected. The model catalog shows
CLI-provided IDs, effort choices, modalities and service tiers; account status
has an explicit refresh and directs login/account changes to the CLI. Failures
stay visible and failed next pages keep their original cursor for explicit
retry. Concurrent identical reads share only the pending request, without caching settled
account/history data. Filter/tab/thread changes discard late responses, so an older page cannot
replace the current selection. Modal close/Escape restores focus to the opener;
native dialog behavior supplies focus containment.

History, Models and Account remain read-only. **Continue in conversation** only
prepares a selected thread; it does not start or resume it automatically.

## Dedicated conversation preview

First-run Claude setup includes **Open Codex preview**, including when Claude is
missing, still being checked, or has an authentication error. This action opens
the Codex panel without dismissing Claude setup, marking Claude authenticated,
saving a token or launching a Claude command. The existing Claude grid startup
gate therefore stays in place. Codex activity remains visible on that setup
entry while its native modal is closed. **Continue anyway** retains its separate,
existing Claude behavior.

The Conversation tab owns one Codex panel per native window label. The workspace
is initialized only when that tab is chosen. **Start session** / **Resume session**
are explicit and separate from submitting a message. Model IDs come from the CLI
catalog, with CLI default available if catalog lookup fails. Permissions default
to read-only and offer workspace-write as an explicit selection; neither plan,
full-access nor managed-worktree modes are exposed. Resume/new-target changes do
not silently transfer an existing draft or unconfirmed message.

The composer uses the guarded live controller. **Send now** requires an idle run
and a known empty queue; **Queue message** can append while a turn is busy. A
failed initial queue read has a visible refresh path. Accepted sends clear only
the matching text/target draft. Recovery shows the original text and has explicit
confirm/retry and reviewed discard actions; discarding a record never cancels
provider work. History can prepare the original session without starting it.

Live user/assistant/tool output is inert text grouped by command, with usage,
terminal status/error details and explicit truncation. Only current one-time
command/file requests expose **Allow once**. Unknown methods or truncated details
cannot be accepted; decline/cancel remain available. Interrupt is disabled while
idle or before a provider turn is bound, and does not clear busy state until the
terminal event. Stop is explicit and targets the intended run.

Queue edit/remove/reorder/pause/resume use the displayed revision. An open stale
edit cannot save until reopened against the latest data. Held work is not resumed
on startup. The panel stays mounted when closed, as does an activated conversation
tab while browsing history/account/models, so runs, output and drafts remain.
The toolbar reports running/approval/detached/confirmation activity after the
workspace has been opened. Closing the modal does not stop the runtime.

`blackcrab.codexWorkspace.v1.<windowLabel>` stores project/model/native thread,
plain draft text and its target. It is unencrypted, excluded from settings
backups, and has no automatic expiry; Clear draft removes the current draft.
Permission mode is kept in memory and resets to read-only after app reload.
Unreadable saved preferences are preserved until explicit reset; new input stays
in memory and storage errors stay visible. The separate outbox still controls
unconfirmed send identity. After a webview reload, the controller discovers a
live native run as detached; review history and explicitly stop/resume it. This
is not seamless replay/reconnect and does not guarantee behavior after native
window/app exit.

The preview does not share Claude's main/grid transcript or phone routing. General
provider readiness, cross-window/native visual scenarios, richer attachments/
rendering and actual model-turn evidence remain separate work. DOM tests and
injected backend fixtures are not claims of native/end-to-end verification.

## Verification

The Python stand-in under `src-tauri/tests/fixtures/codex_rpc.py` uses real pipes
and no model service, network or credentials. Tests cover initialization order,
out-of-order responses, server/client ID collisions, explicit approval errors,
partial/malformed/oversized frames, stderr pressure, bounded pending work,
event overflow, blocked stdin, timeout and process cleanup.

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked codex_rpc
```

A separate ignored test initializes and closes an installed CLI without creating
a thread or model turn. It uses the existing local CLI configuration and account;
it does not print initialization metadata or credentials:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked \
  codex_rpc::tests::installed_cli_initialization_smoke -- --ignored
```

An initialization-only probe is not evidence that real provider turns, tool
execution, history, approvals or client flows work. Those need their own recorded
fixtures and opt-in scenario evidence as the adapter is connected.

Recorded validation: the initialization-only probe passed against local
`codex-cli 0.166.0`, with no thread or model turn started. The full smoke suite
passed with 97 native tests (the CLI probe remains ignored by default), 84 desktop
tests, Cargo check and production build. Actual provider turns and client UI
remain unverified and unavailable until the following steps. This is the 05a
transport baseline; 05b adds the runtime fixture and schema migration coverage.

The additional `codex_runtime.py` fixture reads only its own temporary SQLite
journal and log. It verifies a dispatching receipt already exists when provider
input arrives, and covers early completion, duplicate/foreign events, queues,
hold-before-interrupt ordering, one-time approvals, unsupported requests, stopped
resume and lost acknowledgements. Migration tests retain version-2 Claude
receipts/queues while adding provider mappings. These are local protocol/lifecycle
fixtures, not model execution or end-to-end application evidence.

Runtime events distinguish journal `threadId` from `providerThreadId` in ready
metadata, and journal turn/command IDs from `providerTurnId` in turn events.
Provider mappings persist in schema 3; upgrading preserves existing receipts and
queues, while binaries that only support schema 1 or 2 refuse the upgraded store.

The ownership guards explicitly unlock on drop, preventing duplicated descriptors
from retaining a lease after its logical owner ends. Regression tests exercise
both the host recovery lease and provider session lock with duplicated handles.

Final 05b validation: full smoke passed; the final native suite passed 110 tests
with the installed-CLI probe ignored by default, and the desktop suite passed
84 tests. Final Cargo check passed. This includes 10 Codex lifecycle fixtures and
three provider identity/migration/lock tests, plus the strengthened host lease
recovery regression. No live Codex model turn was started.

Final 05c1 validation: full smoke passed with 115 native tests and the CLI probe
ignored, 84 desktop tests, typecheck, Cargo check and production build. Four
real-pipe host fixtures cover shared idempotent dispatch, queue/interrupt/resume,
opaque one-time approval routing, and stop/restart ownership. They also reject
legacy phone sends/stops against Codex and unsupported launch modes without
replacing the current run. No live model turn, UI or device scenario was run.

Final 05c2 validation: full smoke passed with 123 native tests (the installed-CLI
probe remains ignored), 84 desktop tests, typecheck, Cargo check and production
build. Eight discovery/history tests cover pagination and explicit full turn
pages, dynamic model choices, account/token and diagnostic filtering, invalid
actions/fields, foreign/malformed responses, unsupported methods, interactive
requests, timeout, cancellation/reaping and bounded admission. The final native
run includes all preceding Claude/runtime/host/queue tests. No live CLI account,
catalog/history query, model turn, UI or device scenario was run in this step.

Final 05c3a validation: full smoke passed with 92 desktop tests, 123 native tests
(the installed-CLI probe remains ignored), typecheck, Cargo check and production
build. Eight new desktop/client tests cover failed page retry and deduplication,
stale filter responses, turn/item and explicit legacy pages, inert text/unknown
items, lazy account/catalog reads, account retry, modal cancel/focus restoration,
response identity/cursor checks and shared pending reads. The React quality
review covered effect cleanup/dependencies, native modal accessibility, lazy
loading, stable page identity and escaped output. Native visual rendering, real
CLI reads, live model turns and device workflows remain unverified in this step.

Final 05c3b1 validation: full smoke passed with 97 desktop tests, 126 native tests
(the installed-CLI probe remains ignored), typecheck, Cargo check and production
build. Two new real-pipe host fixtures cover every stale action after replacement
and matching-run receipt/queue/interrupt/approval flows, including unchanged-body
retry identity and explicit held-queue resume. A native wire-contract test rejects
unknown actions/fields and session-wide approval grants. Five TypeScript bridge
tests verify run routing, response identity, no fallback/retry, and finished-context
restrictions. No live model turn or UI/device scenario was run in this step.

Final 05c3b2 validation: full smoke passed with 116 desktop tests, 126 native
tests (the installed-CLI probe remains ignored), typecheck, Cargo check and
production build. Nineteen client tests cover early ready/start identity, detached
and lost-start recovery, durable send ordering, acknowledgements/reload, storage
failures, stale run/turn/queue data, one-time approvals, interrupt/stop/closed
receipts, bounded display, listener disposal, native API bindings, foreign receipt
rejection, replacement display cleanup and superseded startup completion. Backend
and storage are injected fixtures; no real CLI session, model turn, UI or device
scenario was run. Conversation views remain the next step.

Final 05c3b3 validation: full smoke passed with 130 desktop tests, 126 native tests
(the installed-CLI probe remains ignored), typecheck, Cargo check and production
build. Fourteen new DOM/workspace tests cover explicit history handoff/start,
close/reopen ownership, draft persistence/target identity, busy queue submission,
inert streaming output, one-time/truncated approvals, stale queue edits, recovery
confirmation/discard, background activity, queue-read recovery, storage failures
and read-only permission reset. Existing controller tests also cover bounded
approval/error state. React review checked effect cleanup, stable subscriptions,
lazy loading, modal focus, stale async selection and revision guards. Native
visual/window behavior, real CLI turns, general main/grid integration and mobile
workflows remain unverified; general `clientReady` is still false.

### Native verification baseline after #185

A local `npm run dev:desktop -- --no-watch` build launched successfully after
#185, with Vite ready and Cargo reporting `Running target/debug/blackcrab`.
Native automation could not address the app: lookup before launch reported
`Invalid app: Blackcrab`, and lookup of the configured identifier after launch
reported `Invalid app: com.bonjenn.blackcrab`. No native screenshot, interaction
or real CLI/model scenario was validated. The owned dev process was terminated;
no existing Blackcrab process was replaced. Native visual verification remains
open until the app is addressable by the automation surface.

Development startup also exposed that product analytics had no dev-mode guard.
`trackProductEvent` now returns immediately in Vite development mode before
version/install-ID lookup or network submission. Packaged production builds keep
the existing desktop/analytics-opt-in checks. This prevents subsequent dev QA
from counting as production app/update events; it is not native UI evidence.

Development-isolation validation: full smoke passed with 130 desktop tests, 126
native tests (CLI probe ignored), typecheck, Cargo check and production build.
The change is limited to the existing product-event guard; production opt-in
behavior remains unchanged. Native rendering is still not verified.

Provider-setup entry validation: full smoke passed with 132 desktop tests, 126
native tests (CLI probe ignored), typecheck, Cargo check and production build.
Two new setup DOM tests cover pending/missing/failed Claude setup, Codex activity
visibility, and an independent Codex action that does not invoke Claude continue,
recheck, terminal, token-save or token-clear callbacks. The main opener and setup
entry share the same Codex panel callback. Native visual behavior and real CLI
turns remain unverified; general provider readiness is unchanged.

## Pane identity and selection

New extra panes use `v2:UUID` identities. Their runtime owner starts with
`codex:pane:v2:` and their workspace storage uses
`blackcrab.codexWorkspace.v2.`; both contain a JSON tuple of window label and
pane ID. The legacy primary and existing UUID-pane owner/workspace/outbox keys
remain unchanged, so upgrades do not rename live owners or unconfirmed sends.
Workspace and desktop caches are window-scoped, including deferred pane creation.

A legacy primary window label ending in `.UUID` can alias a retained extra-pane
address. That ambiguous primary is refused before inspection or writes; saved
data is preserved. Explicit recovery/migration for that rare legacy identity
remains pending. This is not a claim of complete multi-window parity.

Pointer interaction and keyboard focus inside a grid pane select that owner.
History preparation uses that selection; choosing an already-selected pane does
not rewrite the saved layout. Active-run and draft transfer guards still apply.

## Reopening retained panes

Removing a stopped, reviewed pane now records its original address in a retained
conversation list. **Reopen retained conversation** restores that address and
its existing workspace/outbox keys, then inspects the session without starting,
resuming or submitting work. Active panes remain limited to six. Up to 24 active
and retained addresses are indexed per window; at that limit, reopen and reuse a
retained pane instead of creating another address. No entry is silently evicted.

The existing layout key now saves version 2 data with a retained-address list.
Version 1 layouts load without rewriting until the next layout change. Malformed
lists and failed writes preserve the previous record and block destructive
layout changes until reviewed reset. A downgrade cannot read the version 2 list;
reviewed reset replaces that list, while workspace and outbox data remain.
Panes removed before this increment were not indexed and cannot be discovered
retroactively through this list. Cross-window migration remains a separate gate.
