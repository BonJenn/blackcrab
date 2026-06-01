# Blackcrab relay

A small, self-hosted message router that lets the Blackcrab mobile companion
reach a desktop **off-LAN**, over the internet. It is **end-to-end encrypted**:
the relay forwards opaque NaCl-secretbox ciphertext frames between a desktop
host and its paired phones and never sees keys, transcripts, or actions — only
`{hostId, deviceId, nonce, ciphertext}` routing metadata.

See `docs/mobile-remote.md` for the full architecture.

## Run

```sh
RELAY_TOKEN=<shared-secret> cargo run -p blackcrab-relay
# or build a release binary:
cargo build -p blackcrab-relay --release   # target/release/blackcrab-relay
```

### Environment

| Var           | Default        | Notes                                                        |
| ------------- | -------------- | ------------------------------------------------------------ |
| `RELAY_TOKEN` | _(required)_   | Secret a desktop **host** must present to claim its room. Gates room creation (anti-squatting); end-to-end encryption is the real access control. |
| `RELAY_ADDR`  | `0.0.0.0:8787` | Bind address.                                                |

## Deploy

Terminate TLS in front of the relay and point clients at `wss://`. Any
reverse proxy works (Caddy, nginx, a platform load balancer):

```
# Caddy
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Then configure the desktop with the public URL and the shared token:

```sh
BLACKCRAB_RELAY_URL=wss://relay.example.com \
BLACKCRAB_RELAY_TOKEN=<same-as-RELAY_TOKEN> \
  <launch Blackcrab desktop>
```

The desktop bakes `relayUrl` into the pairing QR; a phone paired over LAN then
reconnects through the relay automatically when it can't reach the host on the
local network.

## Trust model

- The relay only moves ciphertext; it cannot read or forge application traffic.
- A wrong-key device's frames simply fail to decrypt on the desktop and are
  dropped.
- `RELAY_TOKEN` stops a stranger from squatting a `hostId`.
- Not yet implemented: per-connection rate limiting and replay hardening.
