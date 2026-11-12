# Optional production native browser capability

The validated baseline FD3 descriptor and credential-only FD4 protocol remain unchanged when `browser` is absent. The client does not discover a socket, accept credentials from argv/environment, expose them to the renderer, or start a host/listener. Native browser agent transport is opt-in and is not yet certified end to end.

An owner may add exactly this FD3 field:

```json
"browser": {
  "kind": "leased-uds-v2",
  "generation": 1,
  "environmentId": "same UUID as owner.environmentId",
  "path": "/private/tmp/owned-short-run/browser.sock",
  "key": "64 lowercase hexadecimal characters"
}
```

Generation and environment must match the descriptor owner. The path is absolute/canonical, contains no NUL, and occupies at most 100 UTF-8 bytes. Its canonical parent must be owned by the current UID with mode 0700. An existing path must be an owned 0600 Unix socket. A missing socket permits reconnect attempts within that private directory. Windows mode is unavailable.

The key is an independent random 256-bit capability, delivered only through private inherited bootstrap descriptors to the host and authorized native client. It must never be the owner bootstrap seed, OAuth bearer, pairing credential or a renderer value. The owner rotates it and the private run directory for each host generation, supplies it only to its captured authorized client, and retires previous client processes/channels before replacement. This capability authorizes the native browser plane; it must not be issued to a client without preview operation authority.

## Owner/host dependencies

Rust integration is pending. Before adding the optional field, the owner must verify its actual host using the separately implemented cryptographic host proof, preserve the existing single-writer/host lifecycle, and bootstrap the same `{path,key,generation}` through the host's private FD3 `desktopBrowserSocket` field. No HTTP discovery or public listener is added. These clean candidate host changes are required together:

- `packages/contracts/src/desktopBootstrap.ts` and server CLI/config plumbing.
- `SocketDesktopBrowserChannel.ts` and channel selection.
- `ServerBrowser.ts` peer/tab/endpoint fencing, pending setup publication/deletion ownership, per-context downloads, and active-turn resnapshot on attach.

Their source inventory is the external Gate C candidate recorded in `gate-c-source.json`; this client increment does not apply or edit those host patches.

## Client lifecycle and limits

The original DesktopBrowserCommand/Event schemas are retained inside version2 transport. Mutual HMAC binds independent fresh server/client nonces, actual environment and explicit generation. Every command/event also carries a directional HMAC and monotonically increasing sequence, preventing transcript replay and post-handshake proxy modification. One peer is accepted by the host. The client uses a 64 MiB frame ceiling in both directions and at most 64 active command fibers. Reaching the work ceiling retires the connection, failing old work rather than replaying it. Reconnect has one timer, exponential 100ms–5s delay and no CDP replay queue.

Each command captures its peer, tab incarnation and current-resource predicate. Retirement invalidates those predicates immediately, cancels command/event fibers and drops relays. A fresh subscription reannounces actual attached/shown tabs; the compatible server resnapshots current agent activity. Ordinary stop/quit only detaches this client. A later start creates a fresh lease. Already accepted Chromium work cannot be rolled back. The pinned physical screenshot serialization remains, including the known limitation that a hung physical capture can block later captures.

## Validation bounds

Bounded tests cover the actual authenticated Unix transport, bad credentials/environment, exclusive peers, frame bounds/fragmentation, endpoint and pending-owner races, descriptor privacy, scope cleanup and late callbacks. Clean original Host/Manager race patches and their tests are retained in the exact producer registry. No heavy package build or fresh native CDP/reconnect acceptance has been run for this increment. The earlier prototype missed its pinned 10-second attach window and did not establish native end-to-end acceptance. Generic provider OAuth return routing is a separate increment.
