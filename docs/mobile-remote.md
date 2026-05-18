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
pairing code, refresh paired devices, and revoke a paired device. Accepting a
pairing is still reserved for the future mobile/relay path.

The mobile app has a local demo pairing screen. It accepts either a short code
or the serialized desktop pairing payload and persists a host summary in Expo
SecureStore, with a web/local fallback for Expo web development. This proves
the mobile-side state boundary but does not create a real desktop trust
relationship yet.

## Non-goals for this branch

- No relay implementation. There is no server-side component in this branch.
- No real network calls from the mobile app. Screens render mock fixtures
  from the protocol package.
- No real end-to-end pairing flow. The desktop can create local pairing codes,
  and the mobile app can store local demo hosts, but no phone can connect
  through a relay yet.
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
