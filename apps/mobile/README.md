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

- Static, mocked UI for paired hosts, sessions, transcript tail, and
  attention/approval screens.
- All data comes from `@blackcrab/remote-protocol` mock fixtures.
- No network calls. No host pairing. No relay.

## What does not work yet

- Pairing with a desktop host.
- Any real-time updates.
- Sending messages, stopping sessions, or approving actions.
