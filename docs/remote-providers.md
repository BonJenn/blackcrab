# Remote provider discovery

The phone's **Providers** tab reads the selected paired host's provider catalog.
Discovery uses authenticated LAN or encrypted relay transport. It lists installation,
desktop integration readiness, remote integration readiness and adapter features
separately; it does not launch a CLI, read account credentials or start a turn.

`providers_request` carries `hostId` and `requestId` inside a version 1 envelope.
Both transports share the same strict decoder. Unknown fields, version skew and
invalid identifiers are rejected. The consumer checks host identity before
checking installed executables. `providers_result` echoes the host and request
identity, an explicit `ok`/`error` outcome, and either a provider array or null.
Results use the existing authenticated event delivery paths.

Installation uses the desktop's existing PATH candidate check. It does not prove
executable permissions, version compatibility, login health or successful model
execution. `desktopReady` and `remoteReady` describe implemented client routes,
independently of installation. Claude's existing remote workflows are supported;
Codex remains unavailable for remote control even when installed, and its general
desktop readiness remains false while the preview verification gates are open.
Adapter features do not promise equivalent workflows on every client.

The mobile controller requests a fresh catalog on each authenticated connection.
Host switches, disconnects and reconnects clear old catalog data and retire old
request IDs. Foreign, stale, malformed and unsolicited replies are ignored. A
host that does not implement discovery times out with an explicit unavailable
message and offers Refresh; this never falls back to a provider action. Catalogs
are held only in memory. No provider executable paths, account data or credentials
are sent by this RPC.

Source fixtures cover strict request/result validation, host/request correlation,
connection generations, old-host timeout and failed handoff. Native host tests
cover rejection before authentication, LAN forwarding, encrypted relay forwarding,
unknown-device/wrong-key rejection, and host mismatch before discovery. Physical
iOS and real LAN/off-LAN catalog display remain separate verification gates.

Provider discovery validation: 109 mobile tests, 48 protocol tests, workspace
TypeScript checks and iOS Hermes export passed. Combined desktop/mobile smoke
passed with 167 desktop and 133 native tests (one installed-CLI probe ignored),
Cargo check and production build. No real provider turn or iOS device claim is made.
