# Remote follow-up queue contract

Authenticated LAN and encrypted relay clients can read and modify the same queue
used by the desktop. This is parity step 04c1, the host/protocol prerequisite.
The phone composer and queue controls remain step 04c2; this does not claim they
have shipped or that a physical phone has been tested.

## Requests

The protocol version remains 1 with an additive `queue_request` action:

```json
{"v":1,"msg":{"type":"queue_request","hostId":"desktop-host","sessionId":"native-session","requestId":"request-uuid","operation":{"type":"get"}}}
{"v":1,"msg":{"type":"queue_request","hostId":"desktop-host","sessionId":"native-session","requestId":"request-uuid","operation":{"type":"enqueue","commandId":"command-uuid","body":"Follow up"}}}
{"v":1,"msg":{"type":"queue_request","hostId":"desktop-host","sessionId":"native-session","requestId":"request-uuid","operation":{"type":"update","expectedRevision":4,"change":{"type":"pause"}}}}
```

`change` supports the desktop `edit`, `cancel`, `reorder`, `pause`, and `resume`
shapes in [follow-up-queues.md](follow-up-queues.md). Revisions are nonnegative
JavaScript safe integers. Session, request and command IDs contain 1–128 printable
ASCII bytes without surrounding whitespace. Host IDs allow Unicode hostnames.
Reorder lists contain at most 100 distinct command IDs; the store additionally
requires the exact current pending set. Requests and operations reject unknown
fields, including attachment uploads. Message bodies may contain Unicode.

The LAN and relay paths share the same queue decoder and reject unsupported
versions and malformed requests. The consumer verifies `hostId` before reading
or changing the journal. Authentication and pairing scope are unchanged: existing
paired clients have host-wide access. Request IDs correlate responses; they are
not mutation deduplication keys. Enqueue retries must retain their command ID and
**original** body, even if the pending message was edited afterward.

## Results and snapshots

Each valid request for this host produces a `queue_result` event with `hostId`,
`sessionId`, `requestId`, `ok`, `error`, `queue`, and `receipt`. Nullable fields are
explicit JSON nulls. `get` returns `ok: true` and `queue: null` when no journal
mapping exists. Enqueue results include the durable receipt when available.
`error` is null on success and a useful message on failure.

An error can occur **after** enqueue/update commits. Results re-read the queue
and include a matching enqueue receipt even if dispatch failed. For example,
`ok: false` with an `uncertain` receipt means delivery is unknown; it does not
mean the message can safely be submitted under a new ID. A later successful
confirmation may return that same terminal receipt without executing anything.
Clients must inspect receipt status as well as `ok`.

`queue_snapshot` events carry `hostId`, `sessionId`, and `queue`. Queue changes
push snapshots to connected clients; connect/heartbeat snapshots include the
explicitly focused session's queue. Stop/closure state is also reconciled by
requesting the queue and by heartbeat snapshots. The existing focus is shared
across devices, so each client should issue an explicit `get` on selection and
reconnect. Ignore older revisions for the same thread; clear the old view when
switching host/session. Events/results use the existing host broadcast channel;
match host, session and request identities before applying a result.

## Process and retry policy

Reads and confirmation of an existing enqueue work without a process. Confirmation
checks both the target thread and original body, and returns pending, cancelled,
running or terminal receipts without replaying them. Command IDs belonging to
another payload, thread or immediate-send command are rejected.

New enqueues and mutations require a live desktop-owned process for that exact
thread. They never start a process, take over a terminal session or route through
the foreground webview. If no process exists, open/resume the session on the
desktop first. Starting it still leaves held work paused; queue resume is a
separate explicit update, rejected while a turn is active.

After reconnect, fetch a snapshot. Do not replay mutations automatically. A stale
revision rejects an update with the latest available snapshot; review it before
issuing a new action. An ambiguous enqueue may be explicitly retried with its
original command ID/body, including after the host restarts. Older hosts will not
answer these additive actions: report queue support unavailable rather than
falling back to legacy immediate sends. Legacy `send_message` behavior is unchanged.

Queue prompts remain in the local execution journal and travel over the existing
LAN/relay connections to paired devices. No new journal schema, retention,
attachment storage or settings-backup behavior is introduced.
