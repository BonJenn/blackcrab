# Host follow-up queues

The host can persist, edit, cancel, reorder, pause and resume follow-up messages.
This PR supplies the native service and dispatch path. **The current desktop and
mobile composers do not expose queue controls yet.** Their UI and remote protocol
integration are separate steps 04b and 04c in the parity plan. Existing
`send_message` calls remain immediate and reject running turns or pending queues.
No browser-local queue or new foreground-only remote fallback is introduced.

## Ordering and execution

Each thread has an ordered queue, a revision and a paused flag. Submitting through
`queue_message` commits a message and its stable command/turn IDs before dispatch.
An idle, enabled session can claim the first message immediately. Otherwise it
waits for a successful terminal provider result. An active turn prevents another
claim, and immediate sends cannot jump ahead of queued messages.

Claiming is one SQLite transaction: create the `dispatching` turn receipt, mark
the queue entry dispatched and advance the revision. The provider write happens
only after commit. A crash between commit and input leaves an interrupted receipt;
it never puts the attempted message back into the automatic queue. Turn history
is returned in execution order, even when queued messages were submitted earlier
or reordered.

Stop, replacement, interrupt, failed results, tool permission denials, uncertain
input delivery and output closure hold the pending queue. A CLI success result
containing permission denials keeps its success receipt but adds a review detail
and holds the queue atomically. A successful result after an interrupt does not
unpause it. Startup recovery holds queues belonging to exited hosts, including
idle queues with no active turn, while preserving live hosts' queues. Resuming a
session does not automatically resume a held queue.

An operator must explicitly resume a held queue after reviewing any interrupted
or uncertain work. Resume requires an idle, live process; pending messages then
use that session's current provider, model and permission settings. Queue lanes
are bound to a process run, so an old reader cannot drain a replacement's work.
An error that prevents journaling also prevents dispatch. If an interrupt cannot
persist the queue hold, the host stops the process and reports that failure
rather than allowing the next message to run.

## Native API

- `queue_message({ panelId, text, commandId })` persists a message and attempts
  eligible dispatch. It returns the current receipt (`queued`, `held`,
  `dispatching`, `running`, or a terminal status). Retain the command ID for retries.
- `session_execution({ panelId })` reads the current `threadId`, `runId` and
  `processFinished` flag so clients can reconcile events against the current
  panel generation.
- `session_queue({ panelId })` reads a consistent queue snapshot for an open
  panel. Snapshots include `threadId`, `revision`, `paused`, and `items` with
  `commandId`, `turnId`, `text`, `createdAtMs` and `updatedAtMs`.
- `execution_queue({ sessionId, provider? })` reads a queue without a live panel,
  including after restart. Provider defaults to `claude`. It returns `null` when
  no native-session mapping exists, and an empty snapshot for a mapped thread
  with no pending messages.
- `update_session_queue({ panelId, expectedRevision, change })` updates an open
  panel's queue and returns a fresh snapshot. `change` has one of these shapes:

```json
{"type":"edit","commandId":"...","text":"replacement message"}
{"type":"cancel","commandId":"..."}
{"type":"reorder","commandIds":["second-id","first-id"]}
{"type":"pause"}
{"type":"resume"}
```

Edits and reorders require the exact revision just read. A stale revision or an
already claimed entry returns an error without a partial update. Reorder must
include every pending command exactly once. A committed edit can still be followed
by a dispatch error; refresh the snapshot after any error before retrying a
mutation. Resume is rejected while a turn is
active; edit/cancel/pause can still operate on a retained panel whose process has
ended, but dispatch requires resuming the session first.

There are at most 100 pending messages per thread. Cancellation frees a pending
slot but preserves its command tombstone. A repeated submission with the same
ID and original text returns its current receipt, including after edits,
cancellation or dispatch. Reusing the ID for different original text or another
thread is rejected. Retrying an edited submission must use its original submitted
text, not the later edit. An edit changes the pending payload but does not submit
or dispatch a new command.

## Events and client responsibilities

`execution-queue-changed` identifies `panel_id`, `thread_id` and `run_id`; clients
refresh a snapshot rather than applying guessed array changes. The revision
covers submissions, mutations, claims and changes to hold/resume state.

`execution-queue-dispatched` carries the same identities, `text`, and a receipt.
It announces the committed `dispatching` state **before provider input** so chat
can place the user message before an immediate assistant response. It does not
certify input delivery or success. Read the receipt and stream terminal events
for final state. A failed write records `uncertain`, kills the process and holds
remaining work. Clients must reconcile an acknowledgement with events by command
ID rather than append the message twice.

Claude stream/done/stderr events also include run IDs where supplied by the
reader, and queue dispatch requires the current panel generation. Clients must
ignore events from an older run. Frontend run/state reconciliation is part of
04b; this native PR does not claim its UI is already implemented.

## Storage and compatibility

Execution schema version 2 migrates version 1 transactionally and retains all
older receipts. Queue state, original/edited prompts and cancellation tombstones
live in the local execution database. They are not analytics, not encrypted, and
not part of UI-settings backup/restore. The same journal permissions and removal
rules in [execution-store.md](execution-store.md) apply. Cancelling a queued
message removes pending work, not its local deduplication history.

Steering, queue-specific attachment upload, remote queue RPCs and persistent
approval state are not added by this host-service PR. It does not create a
standalone host: native processes still belong to the running desktop app.
