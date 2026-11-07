# Codex provider implementation

## Current boundary

Step 05a adds a private Rust transport for `codex app-server --listen stdio://`.
It is compiled and tested but is not connected to `start_session`, listed as an
available provider, or exposed by a selector. The running app still uses Claude.
Step 05b will connect this transport to provider events, execution receipts and
turn lifecycle; account/model/history and client integration follow in 05c.
Do not claim create/resume/tools/stop/approval parity from this prerequisite.

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
command deduplication. A failed/expired call may already have reached the provider;
closing its process cannot undo side effects. Cancellation of a Rust request
future does not cancel an already handed-off provider action. Step 05b must
persist a stable command/turn receipt before any turn-start write, reconcile the
provider thread/turn IDs, and retain interrupted/uncertain delivery state rather
than reissuing a turn. Provider interrupt/approval behavior is not implemented by
this transport alone.

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
remain unverified and unavailable until the following steps.
