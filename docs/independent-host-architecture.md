# Independent host architecture decision

Blackcrab needs a host that outlives desktop views and supports the same domain
operations from desktop, mobile, agent tools and scheduled work. The pinned T3
scope includes source control/checkpoints, orchestration, providers, permissions,
secrets, files/browser/voice and multiple environments. A successful Codex runtime
extraction alone cannot satisfy that scope.

## Decision

Reuse the pinned T3 backend, contracts and applicable shared client runtime as
the domain foundation for new managed workspaces. Preserve Blackcrab's existing
Tauri shell and legacy Claude/Codex views during the transition. Do not replace
the working remote companion or its pairings with an unimplemented new protocol.

The executable prototypes below establish feasibility, not production readiness.
The first production boundary must package and supervise an isolated managed
host, negotiate its identity/protocol and connect a client without depending on
the lifetime of a desktop view. No legacy provider session may be resumed by a
second writer. Migration/import is a separate explicit operation; merely sharing
project paths is not permission to claim an existing provider session.

## Evidence behind the decision

Both prototypes ran from isolated data directories with no real model calls.
They remain runnable under `experiments/`.

| Candidate | Verified behavior | Unproven/remaining work |
|---|---|---|
| Existing Rust core in a separate process | A held fixture turn survives disconnected Unix-socket clients; reconnect returns the same receipt; another host preserves the live receipt and cannot own that provider session; explicit interrupt/stop reaps its child | Claude host extraction, shared domain services, remote authentication and event subscriptions, service/update packaging, Windows support and Blackcrab client integration |
| Pinned T3 backend reuse | Source CLI starts independently, enforces HTTP authentication, handles separate project clients, preserves environment/project state through restart; server bundle builds without source edits | Relocated native/runtime dependencies, Blackcrab shell/branding, legacy data and pairing compatibility, provider/session migration, real provider/device scenarios and cross-platform distribution |

The Rust release probe measured 3,599,392 executable bytes, with six direct
dependencies, 41 external lockfile packages and no Tauri packages. It contains
only the existing store/runtime and a private fixture protocol. The T3 bundle
measured 19,018,499 JavaScript bytes excluding source maps, plus a 147,346,352-byte
pinned Node executable, before native/runtime externals and web assets. These
are different feature scopes, not comparable complete distribution sizes.

Rust extraction is smaller and preserves existing code directly. It would still
require independently implementing the target's remaining domain services and
client contracts. T3 reuse has a larger runtime and integration/packaging cost,
but already supplies those domain implementations and their shared permission
and persistence boundaries. Full functionality parity favors reuse over a second
independent implementation of every service.

## Integration constraints and next gates

- Pin and attribute the MIT upstream source and preserve required notices. Keep
  Blackcrab changes traceable; do not silently track a moving upstream branch.
- Use an explicit Blackcrab managed-host data directory. Never start or migrate
  against an existing live T3/Blackcrab database as a side effect of startup.
- Keep one authoritative backend for each managed thread. New client/transport
  adapters must call its domain services and permissions, not mirror mutations
  into the legacy execution journal or automatically replay uncertain writes.
- Validate installed runtime/native modules and relocated resources on each host
  platform. Source-workspace module resolution does not establish distribution.
- Preserve the current desktop and mobile workflows while adding managed-host
  support. Adopt target client functionality through deliberate adapters; Tauri
  desktop APIs, Blackcrab pairing/relay and native iOS behavior require evidence.
- Account/cloud integrations, updates and background delivery must use explicit
  Blackcrab configuration and verified deployments. A fork does not inherit the
  target service's hosted infrastructure or distribution credentials.
- Retain the full parity ledger, including actual provider turns, device tests,
  restart/recovery and packaging gates. These probes do not mark phase 06 or full
  desktop/mobile parity complete.
