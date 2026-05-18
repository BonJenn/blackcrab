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

- Local demo pairing from a short desktop code or serialized desktop pairing
  payload.
- Paired host summaries are stored with Expo SecureStore, with a web/local
  fallback for development.
- Mocked UI for sessions, transcript tail, and attention/approval screens.
- No network calls. No relay.

## What does not work yet

- End-to-end pairing with a desktop host over LAN or relay.
- Any real-time updates.
- Sending messages, stopping sessions, or approving actions.
