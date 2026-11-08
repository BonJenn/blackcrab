# Managed native desktop direction

Target remains BonJenn/t3code
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`. This refines the client integration;
the independent host and legacy-session ownership decision in
[the architecture record](independent-host-architecture.md) remains in force.

## Why reuse the full native client

The [complete desktop audit](t3-desktop-native-audit.md) enumerates 121 callable
bridge methods. The bounded Tauri adapter does not provide the native preview,
notifications, OAuth callback, window, SSH, capture and distribution workflows.
Browser equivalents cover only parts of their behavior. Porting individual
methods also risks omitting their shared lifecycle and resource ownership.

Use the full pinned Electron application service graph, preload and trusted
renderer as the managed native client. Preserve Blackcrab's existing Rust/Tauri
views, provider session identities and phone pairings. The bounded managed web
window remains useful during integration; it is not a substitute for the native
application graph or a basis for full parity certification.

## Non-owning attachment proof

The isolated Gate A prototype ran the real Electron application against a
disposable packaged host. Its trusted `t3code://app` renderer and genuine preload
displayed a unique live idle-thread title. Normal `app.quit()` executed
`before-quit` and a detach-only pool finalizer without stopping the host. The
unchanged shared SDK updated the same thread while the client was closed, and
the relaunched native renderer displayed the updated title. Host PID/environment
identity remained stable; run and provider-session projections stayed empty.
Both clients exited normally and captured processes were cleaned up afterward.

Gate B then opened the exact existing-thread route and observed the central
composer and controls. The genuine native window API opened a second window on
the same thread; closing it preserved the main window, and reveal restored the
hidden main window. A nonsecret native chat-width preference survived normal
client exits and an owner-host restart with a new loopback port, preserving the
environment and thread identity. These checks used read-only idle fixtures;
interactive text entry and provider turns remain unverified.

This proves the attachment seam, not complete workflows. The prototype used a
private profile, blocked external network traffic and OS/default-handler changes,
disabled capture initialization and CLI installation, and supplied unavailable
keychain/passkey or in-memory account adapters. Those QA restrictions are not
production feature implementations. Initial screenshots established live sidebar
data but did not certify the central draft's first paint; Gate B separately
checks the exact existing-thread route, composer, windows and preferences.

## Required ownership and trust boundaries

Upstream normally starts a pooled backend, owns its bootstrap credential and
stops pooled processes on quit. Merely choosing the existing host port still
tries to start a second writer. The attached primary must instead verify the
existing authenticated environment, expose readiness/current configuration,
and detach on ordinary client shutdown. Explicit maintenance must reach the
host owner through an authenticated control boundary. PID records cannot grant
termination authority. Primary bearer renewal must remain available beyond a
single launch; prototype startup credentials are not a complete renewal design.

The pinned server replaces prior bearer sessions for the same desktop-bootstrap
subject on every bootstrap exchange. Sharing that credential between owner
probes and the native client therefore invalidates the other connection. Each
native client needs an independent paired session, with one-time grants and
bounded renewal supplied by a private inherited owner channel. Keep the master
bootstrap secret in the owner. Test owner probing and native HTTP/WebSocket use
together, expiry and concurrent renewal; a startup token alone is insufficient.
Revocation and owner generation changes must fail closed.

Keep the trusted custom-protocol renderer and upstream sender/frame validation.
Do not grant the full preload to an HTTP page. Production packaging must own
Blackcrab's identity, protocols, state/keychain namespace, branding, cloud/update
configuration, helpers, native dependencies and signing. It must not silently
use the upstream app's account state, default URL handlers or release endpoints.

## Native browser reconnect gate

The pinned backend's native browser channel inherits file descriptors 6/7 from
Electron. The independent host has no such connection. Full browser behavior
needs an authenticated reconnectable channel while preserving the pinned browser
command/event payloads and legacy FD mode.

A byte-forwarding wrapper alone is insufficient. Old endpoint finalizers can
send `release` after a new same-key tab attaches. Old pending opens, map cleanup,
download-directory removal and debugger/download callbacks can also affect a
successor. Capture an attachment generation and resource identity on both server
and native-client sides; reject stale writes/publication/cleanup, and isolate
per-context downloads. Disconnect must invalidate existing CDP sessions without
replaying uncertain commands. A drain barrier alone cannot rely on a stalled
Chromium operation eventually completing.

Gate C requires wrong-credential/identity rejection, exclusive peer ownership,
disconnect/reconnect and delayed old-generation race tests, followed by a real
owned-page browser round trip. These checks and complete native workflows remain
open in [the parity ledger](t3-parity-ledger.md). No full desktop certification is
inferred from Gate A or from the source inventory.
