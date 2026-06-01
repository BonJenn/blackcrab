# Mobile Remote

The Blackcrab mobile companion is intended to give a user a phone-side view
into their desktop Blackcrab sessions: see what Claude is doing, approve or
deny requests for attention, and send short follow-ups without sitting at the
desk.

This document captures the intended architecture before any of it is wired up.
The code under `apps/mobile/` and `packages/remote-protocol/` is intentionally
a skeleton.

## Architecture

```
+--------------------+        +---------------+        +-------------------+
| Mobile companion   | <----> |    Relay      | <----> | Blackcrab desktop |
| (Expo / RN)        |        | (encrypted    |        | host (Tauri)      |
|                    |        |  routing)     |        |                   |
+--------------------+        +---------------+        +-------------------+
        ^                                                      ^
        |                                                      |
        | pairing + Blackcrab auth                             | local Claude
        |                                                      | CLI sessions
```

- **Blackcrab desktop remains the authority** over local Claude Code sessions.
  It still owns the JSONL files under `~/.claude/projects`, the live
  subprocesses, and all approvals. The mobile app never holds session state of
  record.
- **Mobile pairs to a specific desktop host.** Pairing produces a long-lived
  device token. There is no shared cloud account that ranges over a user's
  hosts; each host is paired individually.
- **A future relay will route encrypted events** between the desktop and the
  mobile device. Events are end-to-end encrypted between desktop and mobile.
  The relay should not store transcripts by default, and should hold only the
  minimum metadata required to route messages and deliver push notifications.
- **Mobile authenticates to Blackcrab/pairing, not to Anthropic.** The mobile
  app does not collect Anthropic credentials, does not log a user into
  claude.ai, and does not proxy Claude traffic. All Claude calls continue to
  run from the desktop host's local `claude` CLI.

## Protocol shape

`packages/remote-protocol` defines the typed events and actions:

- Events (host → mobile): paired hosts, sessions, transcript tail, approval
  requests, approval resolutions, connection status.
- Actions (mobile → host): send message, stop session, approve, deny.
- Pairing: request/response with a short, unambiguous code shown on the
  desktop.
- Desktop pairing payload: a serialized JSON payload containing protocol
  version, host identity, platform, app version, pairing code, and expiration.
  This is the shape a future QR code or deep link should carry.

The protocol is intentionally narrow. Anything that would require streaming a
full terminal, a file browser, or arbitrary remote control belongs in a
follow-up design, not this scaffold.

## Desktop pairing service

`src-tauri/src/pairing.rs` is the desktop's local pairing state. It exposes
Tauri commands `pairing_start`, `pairing_accept`, `pairing_cancel`,
`pairing_list_devices`, and `pairing_revoke`. State persists to
`~/.blackcrab/pairings.json` (file mode 0600 on Unix). Pairing codes are
drawn from the protocol's unambiguous alphabet and default to a 5 minute
TTL. Remote tokens are generated from `/dev/urandom`.

The service has no transport. Codes are minted on the desktop and shown to
the user; a future LAN bridge or relay will actually deliver the code to a
phone. Remote tokens should move from the JSON file to the macOS keychain
(and platform equivalents) before pairing is exposed to users — the
plaintext-on-disk storage is a stub.

The desktop Settings panel exposes the local pairing state: create or cancel a
pairing code, refresh paired devices, and revoke a paired device. The desktop
now also runs a local WebSocket server on a kernel-assigned LAN port; that
host + port is baked into the QR payload so the phone can connect directly.
The server handles two handshakes:

- `pairing_request`: consumes a desktop-minted code via the existing
  `PairingService::accept_pairing` and replies with the issued `remoteToken`.
- `auth`: re-authenticates a previously paired device by remote token.

After either handshake the connection enters a ping/pong heartbeat loop and
emits `connection_status` events. Once authenticated, the connection also
accepts `send_message` and `stop_session` actions: the transport decodes them
off the wire and forwards them to a consumer in `lib.rs`, which resolves the
target Claude `sessionId` to the panel that currently owns its live subprocess
(via the `session_owners` map) and reuses the same code paths as the desktop's
own `send_message`/`stop_session` commands. Actions targeting a session no
panel is resuming are dropped with a log line. `approve`/`deny` actions are
also handled: the desktop answers them by writing the same `control_response`
its own UI sends (see approvals below).

The desktop also pushes host → mobile events: the transport asks `lib.rs` for
an event snapshot right after authentication and again on each heartbeat tick.
The snapshot currently contains:

- A `sessions` event built from `list_sessions()` — the most-recent 50
  sessions mapped to the protocol's `SessionSummary` shape. The state field is
  coarse (idle / completed / errored), since it's read from the JSONL files on
  disk, not from a live subprocess.
- A `transcript_tail` event for the focused session, built from
  `load_session_tail`. Each record is classified into a protocol
  `TranscriptEntry` kind (user_message / assistant_message / tool_call /
  tool_result / thinking / system_notice) with a whitespace-collapsed,
  length-clipped preview. The phone chooses which session to follow with a
  `focus_session` action (tapping "Transcript" on a session); with no focus
  set it follows whichever session changed most recently. Setting a focus
  pushes the new tail immediately rather than waiting for the next heartbeat.

Approvals use a **real-time push** instead of the snapshot cadence, since a
permission prompt needs to reach the phone immediately and clear the moment
it's answered. The desktop's stdout reader already sees every Claude line, so
it detects `can_use_tool` control-requests, records them in a pending-approval
registry (keyed by `request_id`, which doubles as the protocol `approvalId`),
and broadcasts an `approval_requested` event over a `tokio::sync::broadcast`
channel that each connection forwards to its socket. A phone's `approve`/`deny`
action is answered by writing the exact `control_response` the desktop UI sends
(`allow` with the original `updated_input`, or `deny`), after which an
`approval_resolved` event is broadcast. When the **desktop** answers a prompt
via `send_raw`, the same registry is cleared and `approval_resolved` is pushed,
so the phone stays in sync; conversely, a phone-answered prompt emits a Tauri
event that dismisses the desktop's prompt. Outstanding approvals are also
included in the connect/heartbeat snapshot so a phone that connects mid-prompt
catches up. This works whether or not the desktop window is focused.

The mobile app's Pair screen now performs the real pairing handshake when it
sees a scanned/pasted payload with `lanHost`/`lanPort`: it opens
`ws://lanHost:lanPort`, sends the pairing code, persists the issued token in
Expo SecureStore, and keeps the WebSocket alive as the active connection. The
Paired Hosts screen surfaces live transport state for the active host
(connecting / connected / reconnecting / error). Raw codes still take the
demo-only path, since they carry no transport address.

On launch the app auto-reconnects: it picks the most-recently-paired host that
kept a remote token and LAN endpoint and opens a token-authenticated transport
(the `auth` handshake), so a returning user lands connected without re-pairing.
If the stored token is rejected (e.g. revoked on the desktop) the transport
stops and the active connection is cleared.

## Encrypted relay (foundation)

The relay lets the phone reach the desktop **off‑LAN**, over the internet,
without the relay ever reading traffic. This is being built in phases; the
foundation is in place:

- **End‑to‑end encryption** uses NaCl secretbox (XSalsa20‑Poly1305).
  `apps/mobile/src/crypto/secretbox.ts` (tweetnacl) and
  `src-tauri/src/crypto.rs` (RustCrypto `crypto_secretbox`) are wire‑compatible
  — the 16‑byte Poly1305 tag is prepended to the ciphertext, and a shared
  canonical test vector is asserted in both test suites to prove interop.
- **Key bootstrap over the trusted LAN**: at pairing the desktop mints a random
  32‑byte `e2eKey`, stores it on the device record, and returns it in the
  `pairing_response` (over LAN). The phone persists it in SecureStore alongside
  the remote token. The relay never sees it.
- **The relay binary** (`apps/relay`, a standalone Rust crate) is a dumb router:
  a desktop **host** and its **devices** `hello` into a room keyed by `hostId`,
  and the relay forwards opaque `data` frames host↔device. It only sees
  `{hostId, deviceId, nonce, ciphertext}` routing metadata. A `RELAY_TOKEN`
  gates room creation (anti‑squatting); end‑to‑end encryption is the real
  access control. It stamps device→host frames with the source `deviceId` (so
  the host knows which key to use) and notifies the host of device join/leave.
  Deploy it behind a `wss://` TLS proxy.
- **The desktop relay client** (`src-tauri/src/relay_client.rs`) connects out to
  the relay when `BLACKCRAB_RELAY_URL` and `BLACKCRAB_RELAY_TOKEN` are set
  (off by default; the LAN server is unaffected). It claims its room, then
  bridges the relay into the *same* in‑process machinery the LAN transport
  uses: it decrypts each device's actions (keyed by the `from` deviceId via the
  pairing service) into the shared `RemoteCommand` channel, and encrypts the
  snapshot/broadcast events per device — so one desktop serves LAN and relay
  clients through one set of session/approval logic.

Still to come: the mobile relay transport + off‑LAN connect UX (`RELAY_URL`
config, QR carrying the relay address), then reconnect/failover between LAN and
relay plus push notifications.

## Non-goals for this branch

- The mobile relay transport is not wired yet — the desktop relay client and
  relay crate work (proven by an end‑to‑end integration test), but the phone
  still connects only over LAN. The mobile off‑LAN transport, `RELAY_URL`
  config, and the QR carrying a relay address come next.
- Session focus is global, not per-device — with multiple phones paired, a
  `focus_session` from one changes the followed transcript for all of them.
- No transcript sync to the cloud. Transcripts continue to live only on the
  desktop host's disk.
- No remote terminal, no remote file browser, no remote shell execution.
- No Anthropic login or Anthropic credential handling in the mobile app.
- No background polling of Anthropic APIs from the phone.

## What this branch does change

- Adds npm workspaces so the repo can host more than the desktop app.
- Adds `packages/remote-protocol` with typed events, actions, pairing types,
  connection status, desktop pairing payload helpers, and a handful of
  validation helpers.
- Adds `apps/mobile`, an Expo/React Native skeleton with local demo pairing,
  paired host storage, and placeholder screens for sessions, transcript tail,
  and attention/approvals.
- Adds EAS configuration so a future contributor can produce internal builds
  once the project is registered with EAS.

The Tauri desktop app stays in the repository root. Moving it under
`apps/desktop` is deliberately deferred — it would create a large, noisy diff
that has nothing to do with the mobile foundation.
