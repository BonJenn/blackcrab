# Codex provider implementation

## Current boundary

Steps 05a and 05b add a private Rust stdio transport and a journal-backed Codex
thread/turn runtime. The runtime can create/resume threads, submit deduplicated
turns, drain follow-ups, interrupt, and answer supported one-time approvals.
Its typed events carry text, item/tool lifecycle, token usage and terminal error
payloads.

Step 05c1 connects the runtime to the native session registry and commands. It is
an API implementation, not a user-facing provider release: `start_session` can
accept `provider: "codex"`, but discovery marks Codex `clientReady: false`.
The existing desktop/mobile controls still expose Claude. Account/model/history
services, desktop rendering/approval controls and provider-aware mobile routing
are steps 05c2–05c4 and must work before enabling the selector. No actual Codex
model turn or device scenario has been validated by these fixtures.

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
  false. This is not evidence of login, model availability or working UI.
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

The top bar's **Codex history** button opens a lazy-loaded native modal browser.
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

This is a read-only desktop feature. It never invokes session start/resume/send,
changes permissions, accepts an approval, edits history or logs in. Existing
Claude single/grid flows remain separate. Codex still reports `clientReady:
false` because desktop conversation controls, live renderer/approvals, recovery,
and provider-aware mobile flows have not been connected. The browser tests use
mock native query responses; native rendering, real account/catalog/history and
live model scenarios require separate evidence.

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
