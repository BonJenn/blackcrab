# Blackcrab Mobile Remote

An Expo / React Native (iOS + Android) remote companion that pairs with a
Blackcrab desktop host to view and control its Claude Code sessions from a
phone. See `../../docs/mobile-remote.md` for the architecture and non-goals.

The app is functional in code: it performs a real pairing handshake, opens a
live connection to the desktop (over LAN or relay), streams sessions and
transcripts, and sends actions back. It has **not** yet been built into an
installable app or run on a physical device — see "Known gaps" below.

## Setup / local dev

Run from the repo root so npm workspaces resolve `@blackcrab/remote-protocol`:

```sh
npm install                                   # repo root
npm run typecheck --workspace @blackcrab/mobile
npm run test --workspace @blackcrab/mobile     # vitest (crypto + transport)
npm run start --workspace @blackcrab/mobile    # expo start
```

`start`, `ios`, `android`, and `web` all proxy to Expo. SDK 54 / React Native
0.81 / React 19.1.0.

## What works

Verified against the source under `src/`:

- **LAN WebSocket transport** (`transport/lanWebSocketTransport.ts`): connects
  to `ws://lanHost:lanPort`, runs the pairing or token-`auth` handshake, keeps a
  ping/pong heartbeat, and reconnects with bounded exponential backoff.
- **Relay transport** (`transport/relayTransport.ts`): reaches the desktop
  off-LAN through the encrypted relay, implementing the same `Transport`
  interface. Outbound messages are sealed and wrapped in relay `data` frames;
  inbound frames are opened back into events.
- **LAN ↔ relay failover** (`transport/failoverTransport.ts`): prefers LAN and
  falls back to the relay after a grace window or a fatal LAN failure, then
  stays on the relay.
- **QR pairing + manual codes** (`screens/PairHostScreen.tsx`): scan the
  desktop's QR with the camera, or paste the serialized payload / a raw code.
  Payloads with a LAN endpoint run the real handshake; raw codes still take a
  local-only path (no transport address to connect to).
- **Encrypted pairing handshake** (`transport/pairOverLan.ts`,
  `crypto/secretbox.ts`): pairing over LAN issues a remote token plus a 32-byte
  E2E key (NaCl secretbox, wire-compatible with the desktop's `crypto.rs`), and
  persists them with the host in Expo SecureStore (`pairingStore.ts`).
- **Auto-reconnect on launch** (`transport/reconnect.ts`, `App.tsx`): the
  most-recently-paired connectable host reconnects via failover without
  re-pairing; a rejected token clears the active connection.
- **Live session list** (`screens/SessionsScreen.tsx`): renders sessions pushed
  by the host, falling back to mock fixtures until a connection exists.
- **Transcript tail streaming** (`screens/TranscriptScreen.tsx`): follows a
  chosen session's transcript; tapping "Transcript" sends a `focus_session`
  action so the host pushes that session's tail.
- **Approve / deny approvals** (`screens/ApprovalScreen.tsx`): real-time
  permission prompts pushed from the host, answered with `approve` / `deny`
  actions and cleared on resolution.
- **Remote actions**: `send_message`, `stop_session`, and `focus_session` over
  the active transport.
- **Connection-status indicator** (`screens/PairedHostsScreen.tsx`): live
  transport state for the active host (connecting / connected / reconnecting /
  error / disconnected).

## Known gaps / not yet validated

- **Never built via EAS** and **never run on a physical device** — the code is
  unexercised end-to-end on real hardware.
- **No `projectId` registered with EAS yet** (`app.json` has no `extra.eas`
  entry), so `eas build` will not work until the project is initialized.
- App `version` is still `0.0.0`.
- **No UI / on-device test coverage.** The tests under `src/` cover only the
  crypto (`secretbox.test.ts`) and transport logic
  (`lanWebSocketTransport`, `relayTransport`, `failoverTransport`,
  `reconnect`). Screens and navigation are untested.
- No push notifications — updates arrive only while the app is connected and
  foregrounded (see the doc's non-goals).

## Build & run on a device

Producing an installable build requires an Expo account and EAS:

```sh
eas login
eas init                          # registers the project, adds extra.eas.projectId
eas build --profile development   # dev-client build to install on a phone
```

`eas.json` already defines `development`, `preview`, and `production` profiles.
For more detail, see the build steps above or the team's build docs.

## Follow-up queues

The text composer uses the [host queue protocol](../../docs/remote-follow-up-queues.md).
The Queue panel supports edit, remove, reorder, pause and explicit resume. Resume
requires an idle, live desktop-owned session. A stopped session must first be
opened/resumed on the desktop; queue actions do not use the legacy foreground
resume fallback. Queued text appears in the transcript when the host/provider
records it, not as an optimistic send bubble.

The phone saves one unconfirmed original body and command ID per host/session
before transferring the composer draft. On reconnect or app restart it fetches
a snapshot without replaying writes. **Retry saved message** explicitly reuses
the original ID and body. A lost mutation reply requires Refresh and review;
mutations are never replayed automatically. Stale edits retain their draft and
block saving until cancelled and reopened. Only a matching host/session/request
result with the matching command/thread receipt can clear a saved submission.
Storage failure leaves the composer unchanged. Older hosts that do not answer
queue RPCs show an unavailable message; text never silently falls back to an
immediate send.

Attachment uploads retain the separate **Send files** path, available when no
turn or queued work is pending. They do not use queue command IDs or gain queue
retry guarantees. New-session creation also retains its existing flow. Queue
upload support, independent-host resume and full offline drafts remain later
parity work.

Recovery files live under `documentDirectory/queue-recovery-v1` on iOS/Android.
File names hash the host/session identity; file contents are unencrypted JSON
with host/session/thread IDs, original body and command ID. Writes stage a temp
file before moving it into place; a crash can leave an orphan temp file. Web
uses `blackcrab.mobile.queueRecovery.v1.*` localStorage keys. There is no memory-only
fallback or automatic expiry. Confirmed records are removed; unresolved records
and crash temp files remain in app data and may be included in OS/browser
backups. Forgetting a pairing does not remove them. Review the host journal before
manually clearing app recovery data, since that discards retry identities.

Validation covers controller state/races, shared host contracts, a React control
conflict scenario, and iOS bundle export. Physical-device, simulator and visual
validation remain unverified; these source/build checks do not claim device
end-to-end evidence.
