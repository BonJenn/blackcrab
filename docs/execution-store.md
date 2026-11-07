# Durable execution receipts

Structured desktop and grid messages, and messages sent from a paired phone to a
live session, now pass through a host-owned SQLite journal before reaching the
provider. The journal is stored in `execution/state.sqlite3` under Tauri's
application data directory (`~/Library/Application Support/com.bonjenn.blackcrab`
on macOS). It uses the bundled SQLite library, WAL and full synchronous commits.
Blocking disk operations run outside the async executor.

Each provider session maps to a stable Blackcrab thread ID. Each subprocess gets
a new run ID; every submitted message gets a command ID and a turn ID. Fresh
threads bind to Claude's session ID when its init event arrives. Importing or
resuming an older Claude session creates the mapping without changing its JSONL.
History in the journal starts with messages submitted through this version; old
transcripts are not copied into it.

## States and recovery

- `dispatching`: the receipt committed before attempting a provider write.
- `running`: the input write and flush returned successfully. This does not
  certify that the provider has completed or even accepted the request.
- `succeeded` / `failed`: the provider emitted its terminal result. A success
  containing tool permission denials holds follow-up work for review.
- `interrupted`: the panel stopped/replaced, output closed without a result, or
  the host holding the run's lease exited.
- `uncertain`: the input write failed and may have delivered some or all bytes.

A command is never automatically replayed. In an active or resumed panel,
retrying the same ID and exact message returns the original receipt without
another provider write; a different payload/thread using that ID is rejected. Failed, interrupted or uncertain IDs
return an error directing the caller to review the transcript before explicitly
starting a new command. Only one turn can be dispatching/running in a thread.
Immediate sends are rejected while a turn is active or follow-up messages remain
pending.
The host follow-up queue API persists additional work separately; desktop/mobile
queue controls follow in separate PRs. See [`follow-up-queues.md`](follow-up-queues.md).

Each live store holds an OS file lease. Opening another instance recovers only
turns whose original host lease can be acquired; it leaves live hosts alone.
Terminal receipts do not change when an old run exits or a late write acknowledgement
arrives. Stop/replace records interruption before the next process can submit
work. Providers are configured to terminate when their owned process handle is
dropped normally. A host crash does not prove that all provider work stopped;
review its transcript before retrying.

This is a turn receipt journal, not a full event-sourced orchestrator. It does
not persist provider streams, approvals, delegation or terminal buffers. Pending
follow-up messages now have their own durable queue tables.
It does not yet make the host independent of the desktop or add a recovery UI.
Native dispatch checks the current process run ID; replaced readers cannot
release a replacement process's ownership.

## Native API

`send_message({ panelId, text, commandId? })` returns a receipt. Existing callers
can omit `commandId`; the host generates one. A client that needs retry
deduplication must retain the ID for the logical operation and reuse it for that
operation only. Generating a new ID on every retry cannot provide deduplication.

`execution_receipt({ commandId })` looks up a receipt even if the acknowledgement
was lost, including after a panel has stopped. Resume the session before
submitting a retry to a new panel. `execution_history({ sessionId, provider? })`
returns receipts in execution order for a mapped native session; provider defaults to `claude`. Receipt reads omit
message bodies. The existing paired-phone protocol is unchanged and does not
expose these queries or client command IDs yet. `send_raw` accepts only a single
provider control request/response, so user messages cannot bypass the journal
through the permission-response path.

## Storage and compatibility

The journal stores submitted message text to detect conflicting command IDs.
It may therefore contain sensitive prompts and file paths. It is local and is
not uploaded by analytics or included in the existing UI-settings backup/export.
Unix storage permissions are restricted to the account (directory 0700, database
0600); Windows uses the application data directory's access controls. It is not
an encrypted database.

Session deletion currently moves Claude's JSONL into its recoverable `.trash`
folder. It does not erase journal receipts. No automatic journal retention or
purge UI ships in this foundation. Quit all Blackcrab instances before separately
removing the execution directory to erase its receipts; this also discards retry
deduplication history. Never remove an active database, WAL or lease file.

Unknown newer schemas and database errors fail explicitly. The app does not
silently replace a corrupt database or launch an unjournaled structured session.
Schema version 2 adds host follow-up queues through an atomic migration from
version 1, preserving existing receipts. Older binaries that only understand
version 1 will refuse the upgraded database. Full client recovery, queue controls
and scoped remote access build on this boundary in later parity PRs.
