# Blackcrab Mobile Remote (experimental)

This is the scaffolding for the Blackcrab iOS/Android remote companion. It is
not wired to a real desktop host yet. See `../../docs/mobile-remote.md` for the
intended architecture and non-goals.

## Setup

```sh
npm install
npm run typecheck --workspace @blackcrab/mobile
npm run start --workspace @blackcrab/mobile
```

`start`, `ios`, `android`, and `web` proxy to Expo. EAS configuration lives in
`eas.json`. Real builds need an Expo account and `eas login` once the project
is registered with EAS.

## What works

- LAN pairing over WebSocket: scan the desktop's QR (or paste the serialized
  payload) and the phone opens `ws://lanHost:lanPort`, performs the pairing
  handshake, and persists the issued remote token in Expo SecureStore.
- Live connection-status indicator on the Paired Hosts screen
  (connecting / connected / reconnecting / error) backed by a real ping/pong
  heartbeat.
- Raw pairing codes still take a local-demo path (no transport address to
  connect to).
- Mocked UI for sessions, transcript tail, and attention/approval screens.
- No relay, no auto-reconnect on app launch (yet).

## What does not work yet

- End-to-end pairing with a desktop host over LAN or relay.
- Any real-time updates.
- Sending messages, stopping sessions, or approving actions.
