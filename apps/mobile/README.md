# Blackcrab Mobile Remote

An Expo / React Native (iOS + Android) remote companion that pairs with a
Blackcrab desktop host to view and control its Claude Code sessions from a
phone. The full remote iOS delivery scope is tracked in
[the mobile parity plan](../../docs/mobile-ios-parity-plan.md).
`../../docs/mobile-remote.md` contains architecture and historical notes.

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
  by the host, showing an empty/waiting state until a real host snapshot arrives.
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
- `app.json` already has an EAS project ID, update URL and version `1.0.0`;
  `eas.json` includes a development-simulator profile. Account access, signing,
  installable build and device runtime evidence still need verification. Do not
  initialize a replacement EAS project.
- Screen/controller regression checks and iOS bundle export are covered; these
  do not substitute for simulator or physical-device verification.
- Full navigation and device coverage remain incomplete. Automated tests cover
  crypto, transports, queue controls and host/approval state scenarios.
- No push notifications — updates arrive only while the app is connected and
  foregrounded (see the doc's non-goals).

## Build & run on a device

Producing an installable build requires an Expo account and EAS:

```sh
eas login
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
upload support and independent-host resume remain later parity work.

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

## Authoritative remote state

Normal screens never substitute sample hosts, chats, approvals or transcript
entries for real data. Cached conversations are labelled as last received while
disconnected. Incoming UI events belong to one active host binding; foreign
host records, mixed-session tails and callbacks retired by a host switch are
ignored. Only the focused session can replace its transcript. Reconnecting
clears pending approval UI; request updates must come from the new connection.

Approval buttons require the selected connected host and check the transport
again at tap time. A submitted decision disables both buttons until the host
confirms resolution; it is never replayed automatically. A rejected local send
keeps an explicit retry available. These controls do not replace host-side
permission checks, complete protocol schema validation, replay hardening or
physical-device end-to-end testing.

## Selecting a host

In **Hosts**, choose **Connect** for a paired machine. While it connects, agent
controls remain unavailable. **Open chats** opens the connected machine's
conversations; the app header identifies the selected host. **Reconnect**
explicitly replaces an errored/disconnected transport. Saved hosts without
reconnect credentials offer **Pair again**.

**Disconnect** closes the phone connection without sending a stop action to
host agents. Selecting another host creates its transport, retires the old
owner and closes the previous phone connection. If transport creation fails,
the existing connection is retained and an explanation is shown; a later
connection failure is shown for the newly selected host. Late failures from a
retired connection, including an earlier connection to the same machine, cannot
clear the replacement. Startup, pairing, the new-session machine picker and
forgetting a host share this ownership path. Reconnect never resends agent
commands. The new-session form stays open if a start cannot be handed to a
connected matching transport; provider-side start receipts/recovery remain
later work.

## Durable text drafts

The transcript composer saves text separately for each host/session, including
while disconnected. Loading must finish before editing; failed saves retain text
in memory and block submission until Retry succeeds. Unreadable saved data is
preserved until an explicit reviewed reset. Drafts never submit automatically.
A confirmed queue handoff clears only the exact original edit; newer typing
survives. After restart, Retry saved message confirms the original command and
saves the matching draft transition before removing its recovery record.

Native drafts use unencrypted JSON in `documentDirectory/drafts-v1`, with hashed
host/session filenames and temporary-file replacement. Web uses
`blackcrab.mobile.draft.v1.*` localStorage. Records contain host/session IDs, text
and edit identity, have no automatic expiry, survive forgetting a pairing, and
may be included in OS/browser backups. Crashes can leave temporary files or lose
the latest edit before its asynchronous save completes. Attachment recovery
still uses the separate legacy socket handoff, without durable queue receipts.

Validation: 87 mobile and 46 protocol tests passed, including storage failures,
restart recovery, newer-edit preservation and reconnect races. Workspace
TypeScript checks and iOS Hermes bundle export passed. Native iOS installation and device tests remain open.

## Remembered startup host

Successful explicit Connect/Reconnect and pairing select the host for the next
launch. Disconnect saves a disconnected startup choice, and forgetting the
selected host clears that choice. Closing the app or a rejected connection does
not change it. With no saved choice, startup keeps the legacy most-recent
connectable host default. A saved host that is missing or needs pairing, or an
unreadable saved choice, leaves the phone disconnected and asks you to choose;
it never silently substitutes another host.

Selection writes are serialized. A failed save leaves the current connection
unchanged and shows Retry saving startup host; the previous saved choice may
return after restart until saving succeeds. A late startup read cannot override
an explicit connection, disconnect or forgotten host. No agent action is replayed.

The preference `blackcrab.mobile.hostSelection.v1` contains only a version and a
host ID, or null for disconnect. Native uses SecureStore; web uses unencrypted
localStorage. Storage unavailability is reported without an in-memory fallback.
Pairing credentials and draft/recovery records remain in their existing stores.

## Provider discovery

The Providers tab reads the selected host’s installed provider catalog and
separates adapter features from desktop and remote integration support. It clears
data across host switches/reconnects and ignores stale replies. Older hosts show
an unavailable message with explicit Refresh. Discovery never launches an agent
or reads account credentials. Codex remote control is still unavailable. See the
[remote provider contract](../../docs/remote-providers.md) for limits and evidence.
