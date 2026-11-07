# Host follow-up queues

The host can persist, edit, cancel, reorder, pause and resume follow-up messages.
Desktop single and grid composers expose the host queue: send while a turn is
running, edit/remove/reorder pending messages, pause, and explicitly resume held
work. The remote protocol is described in [remote-follow-up-queues.md](remote-follow-up-queues.md);
the mobile controls remain step 04c2 in the parity plan. Existing direct
`send_message` integrations remain immediate and reject
running turns or pending queues.

## Desktop controls and recovery

The composer remains available during a turn. Its Queue action persists work in
the native host; queued messages appear in the conversation only when dispatched.
Single and grid panels share the same client and controls. Grid queues start
collapsed. Stop remains a separate action and holds pending messages. Restarting
a process does not resume held work; review it and choose **Resume queue**.

Edits, removal and reordering use the revision displayed when the action began.
If another client changes the queue during an edit, the editor preserves its text
and blocks saving until cancelled and reopened. Dispatch events are reconciled
by command ID and current run so an acknowledgement cannot add a second bubble
or an old process update a replacement panel.

Before native submission, the desktop saves one unconfirmed message per thread
under `blackcrab.queueSubmission.v1.<threadId>` in localStorage. This contains its
original text (including attachment paths), command ID and composer draft identity.
The record is removed after confirmation, and exists only to retry an ambiguous
acknowledgement with the same ID and original payload. Reloading never submits it
automatically: **Retry message** explicitly confirms or retries it. New sends are
blocked while confirmation is unresolved. A storage failure leaves the draft
untouched. New draft text and attachments are preserved when an older send clears.
The recovery record is unencrypted, has no automatic expiry while unresolved, and
is excluded from settings backups; it is not an authoritative browser queue.

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
ignore events from an older run. Desktop queue events are reconciled against the current run and thread. Mobile
queue reconciliation remains part of 04c2.

## Storage and compatibility

Execution schema version 2 migrates version 1 transactionally and retains all
older receipts. Queue state, original/edited prompts and cancellation tombstones
live in the local execution database. They are not analytics, not encrypted, and
not part of UI-settings backup/restore. The same journal permissions and removal
rules in [execution-store.md](execution-store.md) apply. Cancelling a queued
message removes pending work, not its local deduplication history.

Steering, queue-specific attachment upload, and persistent approval state remain outside this desktop queue step. It does not create a
standalone host: native processes still belong to the running desktop app.
