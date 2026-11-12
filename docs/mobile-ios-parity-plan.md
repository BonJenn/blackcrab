# Full remote iOS delivery plan

The user explicitly requested a complete remote iOS application with all
applicable T3 mobile workflows, so users can control their agents remotely.
This is part of the main [T3 parity plan](t3-parity-plan.md), not a reduced
conversation companion milestone. Reference: BonJenn/t3code commit
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`.

## Located implementation

The Programming-folder search found Blackcrab Remote inside this repository:
`apps/mobile` (Expo SDK 54 / React Native), `packages/remote-protocol`, desktop
remote services in `src-tauri`, and `apps/relay`. No separate Blackcrab mobile
project was found by the project-manifest search. Preserve the existing app,
pairings and encrypted transport rather than creating a competing mobile client.

`app.json` already specifies `dev.blackcrab.remote`, version `1.0.0`, an EAS
project and update URL. `eas.json` includes development, simulator, preview and
production profiles. These settings do not establish successful signing,
installation, device operation or App Store readiness. Xcode is available locally.

## Delivery order

| Phase | Scope | Acceptance |
|---|---|---|
| M0 | Authoritative host/connection state | No demo data in normal screens; host/session identities cannot cross views; disconnected approvals cannot be submitted; late callbacks are retired; no automatic decision replay |
| M1 | Provider-aware agent control | Discover supported providers/accounts/models; create/resume threads, stream text/tools/usage, send/queue/interrupt/stop and answer scoped approvals; capability errors are explicit; include Codex |
| M2 | Independent host and recovery | Agents continue while desktop UI closes; phone reconnects to durable host receipts/history; offline drafts and attachment recovery preserve identity without duplicate execution |
| M3 | Complete coding workspace | Projects/worktrees/setup scripts, files and media/context, terminals, Git status/staging/commit/push/pull, checkpoints/diffs/restore and PR workflows through the same host services |
| M4 | Orchestration and organization | Delegated tasks/questions/results, goals, schedules/triggers, pin/settle/snooze/undo and settings; effective permissions remain host-enforced |
| M5 | Full remote access | Multiple hosts/environments, scoped grants/revocation, LAN/relay failover, relay hardening, account/secret workflows and useful connection diagnostics |
| M6 | Native iOS capabilities | Push on completion/failure/approval/input, notification-to-thread routing, Live Activities, voice review/cancel, file/photo/camera flows, foreground/background/locked-device behavior and accessibility |
| M7 | Distribution and parity evidence | Installable signed iOS build, simulator and physical-device scenarios, LAN and off-LAN verification, upgrade/recovery coverage, target-feature ledger and release review |

M0 can proceed alongside desktop integration. M1 depends on typed provider host
contracts. M2 shares main-plan phase 06; M3–M5 share its domain services. Do not
implement mobile-only operations that bypass those services or their permissions.
Each coherent change gets its own PR to `stage` and required checks before merge.

## Verification and release gates

- Record desktop host, relay, protocol, provider and iOS app versions for each
  end-to-end scenario. Fixtures and bundle export prove different things from
  installable device behavior; report them separately.
- Test two hosts with colliding session/approval IDs, two clients, host switching,
  revoked credentials, dropped replies, reconnect, app termination, host restart
  and interrupted uploads. Never replay an uncertain write automatically.
- Keep provider credentials on the host. Review pairing token storage, encryption,
  protocol validation and relay replay/rate protections, including existing
  hardening PRs #154–161, before release.
- Test actual agent creation/resume, approvals, queue control and source-control
  actions from iOS over LAN and off-LAN. Preserve unrelated dirty work and target
  exactly the selected host/provider/thread/run.
- Push requires background delivery infrastructure; an always-open phone socket
  is not evidence of push delivery. Verify foreground, background, locked-device,
  permission-denied, revoked-device and notification deep-link behavior.
- Verify simulator and physical iOS builds, including safe areas, keyboard,
  scrolling, VoiceOver, network transitions and process restoration. Use the
  existing EAS project; verify access/signing when reaching that delivery step.
- Do not claim full mobile parity until every applicable target workflow has a
  scenario and evidence, including honest unsupported combinations.

## Current increment

M0 implementation removes normal-screen sample data, binds incoming UI state to
the active host and focused session, retires stale callbacks, and guards approval
submission against disconnect/host changes and duplicate taps. Validation: 64 mobile and 46 shared protocol tests passed, mobile typecheck
passed, iOS Hermes bundle export succeeded, and repository smoke passed with
147 desktop and 127 native tests (one installed-CLI probe ignored), Cargo check
and production frontend build. Transport and React screen scenarios cover the
new host/approval boundaries; these are not native device evidence. Native device,
off-LAN deployment and full navigation verification remain outstanding.

### Host selection increment

The trusted host/session state foundation shipped in #191. The next increment
adds Connect/Reconnect/Open chats/Disconnect to Hosts and a single connection
owner shared by app startup, pairing, explicit selection, new-session host
selection, forgetting and app disposal. A retired generation's rejection cannot
close the current connection, including when reconnecting to the same host.
Construction failure or an initial identity mismatch preserves the previous
connection. Switching after successful construction closes the old phone
connection; it does not wait for authentication or guarantee seamless handover.
Later failures are reported on the selected connection. Agent stop/send actions
are not replayed by connection management.

Controller and React screen tests cover those transitions. New-session submission
checks the current transport before closing its form; this is not durable
provider-side start deduplication. Native iOS and real multi-host network tests
remain required. The initial increment chose the most recently paired connectable host. The
remembered-startup-host increment below adds persistent explicit selection;
simultaneous multi-host connections remain future work.

Host selection validation: 71 mobile tests and 46 protocol tests passed, mobile
TypeScript passed, iOS Hermes export succeeded, and full repository smoke passed
with 147 desktop and 127 native tests (one ignored), Cargo check and production
frontend build. These checks do not establish signed or real-device operation.

### Durable draft increment

M2 now has per-host/session offline text drafts, serialized persistent saves,
explicit storage retry/reset, and revision-safe composer transfer. Queue recovery
carries local edit identity so confirmation after restart clears only the
original draft, preserves newer edits, and completes draft persistence before
removing the outbox record. Reconnect generations cannot delete a newer outbox.
Attachments still lack durable receipt recovery; independent-host lifecycle,
notifications and native device validation remain pending.

Validation: 87 mobile tests, 46 protocol tests and all workspace TypeScript checks
passed, and iOS Hermes bundle export succeeded. The combined desktop/mobile tree passed repository smoke (152 desktop,
127 native tests, Cargo check and production build). CI now typechecks workspaces
as well as the root application. No signed build or real-device claim is made.

### Queue ownership through legacy navigation

The legacy screen now keeps one queue controller for the app lifetime, including
while the full workspace interface is visible. An in-flight recovery-file write
keeps the queue busy across disconnect, reconnect and screen detachment. A second
send cannot overwrite that unfinished save; a connection change still requires
refresh and explicit retry with the original command ID. A failed save preserves
the draft and releases the busy state for recovery.

Validation: the overwrite regression failed before the fix. Afterward, 39 tests
across queue, draft, transport and composer paths passed, including an actual-file
recovery test using Node filesystem adapters for the Expo boundary. Scoped strict
TypeScript checking uses the prepared Expo 58.0.14 / React Native 0.88.0 dependency
graph. These checks do not establish populated installed-iOS upgrade acceptance,
provider execution or off-LAN delivery; those gates remain open.

### Remembered startup host increment

Explicit connection/pairing choices now persist independently of pairing order.
Disconnect and forgetting the selected host persist a disconnected startup
choice. Missing preferences alone use the legacy default; unavailable, corrupt
or unreadable saved selections do not select another host. Serialized writes
surface save failures with explicit retry, and delayed startup reads cannot
overwrite newer user intent. Cleanup and fatal rejection retain the saved choice.
Native storage uses SecureStore without a memory fallback; web uses localStorage.
Only host identity is stored, with no new credentials or provider writes.

Controller, storage and Hosts-screen scenarios cover startup choice, unavailable
hosts, read/write failures, rapid selection/disconnect, failed connection attempts,
forget during delayed reads and disposal. Native iOS lifecycle and real multi-host
network evidence remain pending.

Remembered-host validation: 102 mobile tests and 46 protocol tests passed, all
workspace TypeScript checks passed, and final iOS Hermes export succeeded. These
are controller/build checks; native device and real network scenarios remain open.

### Provider discovery increment

M1 now has a host-scoped Providers tab using authenticated LAN/encrypted relay
RPC. Installation, client readiness and adapter features remain separate, with
explicit old-host timeout and no substituted provider. Codex remote controls,
account/model discovery and native iOS/network evidence remain pending. The
[contract guide](remote-providers.md) records validation and limitations.

Provider discovery validation: 109 mobile tests, 48 protocol tests, workspace
TypeScript checks and iOS Hermes export passed. Combined desktop/mobile smoke
passed with 167 desktop and 133 native tests (one installed-CLI probe ignored),
Cargo check and production build. No real provider turn or iOS device claim is made.

### Managed workspace source and native connection increment (in progress)

The independent-host architecture now has a native connection path separate from
legacy remote pairings. `vendor/t3` retains the exact pinned source closure of six
public client-runtime entries (207 source files, 20 packages), original package
metadata, dependency lock, MIT notice and one recorded types-only patch. The patch
has identical emitted JavaScript. Export and verification details are in
[the shared runtime guide](../shared-runtime/README.md).

The Workspaces tab uses the shared onboarding, registry, authenticated RPC and
shell snapshot services. Native adapters provide separate SecureStore catalog and
selection namespaces, strict upstream cache codecs, scoped connectivity and
foreground wakeups. Controller ownership fences retired callbacks and serializes
selection writes and replacement runtimes. A cached list is labeled stale;
connection state alone does not establish live data. Existing Hosts, Providers,
Chats and Attention flows retain their legacy ownership.

Real packaged-host integration exercised one-use read-only pairing over HTTP,
live project discovery over WebSocket, disable/re-enable, catalog recovery after
runtime recreation, removal and credential cleanup. It used isolated data/home
paths with no inherited provider credentials. This establishes the direct SDK
connection path in a Node test harness with injected native boundaries; it is not
a native-device or agent-turn certification.

Cloud identity/relay and SSH are explicitly unavailable in these adapters.
Managed thread controls, transcripts, approvals, queued mutations, attachments,
notifications, remaining settings and real-device acceptance remain pending.
This increment does not establish M1–M6 completion or full desktop/mobile parity.

Validation for this increment: 140 mobile tests and 48 legacy protocol tests
passed; the real packaged-host integration passed separately in production mode.
All workspace TypeScript checks, 59 source export/provenance tests, 30 managed-host
regression tests, and product-entry iOS Hermes compilation passed. Repository
smoke passed with 173 desktop tests, 145 native tests (3 ignored), Cargo check and
production frontend build.

The local Xcode 27.1 build exposed existing Expo 54 tooling issues: a pod resource
target below the SDK minimum and shell commands that split the external volume's
space-containing path. An isolated QA project built after local-only workarounds
and rendered the actual Hermes product entry in an iOS 26.2 simulator. The initial
unsigned build could not read secure storage. Rebuilding with Xcode-generated
simulator entitlements resolved that QA setup failure. The actual native app then
paired the isolated packaged host, displayed its live project and idle thread,
persisted its catalog and explicit selection across process restarts, preserved
disconnect and cached data through restart, reconnected with saved credentials,
and stayed empty after forgetting and restarting. The captured host process and
public descriptor remained available after phone process exit and forget. No
provider turn was started.

These simulator observations used Expo 54.0.35 / React Native 0.81.5 and the actual
product-entry Hermes bundle at source head `436a3b5`, with real SecureStore,
filesystem, network and WebSocket adapters. The local-only build workarounds are
not shipping build evidence or repository dependency patches. The next native
build increment must provide a reproducible physical staging workspace and pod
floor adjustment. No distribution-signed release or physical-device claim is made.

### Owned cloud configuration and account activation

The full native interface can be configured with Blackcrab's own Clerk publishable
key, relay JWT template and HTTPS relay origin. The build validates the complete
set, carries those public values through isolated native preparation, and enables
the Clerk native plugin with Blackcrab keychain identity and Apple sign-in support.
The generated interface reads only the owned configuration namespace and attaches
the pinned account service, retaining its relay discovery, account cleanup,
onboarding and notification registration behavior. Unconfigured builds remain
local-only without clearing saved accounts or catalogs.

See [the configuration guide](mobile-cloud-configuration.md). This implements the
previously disabled activation path; it does not establish a deployed Blackcrab
identity/relay service, native account sign-in, off-LAN delivery, push or distribution.
Those M5–M7 acceptance gates remain open.

### Complete native platform increment (merged foundation)

The owned mobile platform now uses Expo 58.0.14, React Native 0.88.0 and React
19.3.0, preserving desktop React 19.1 and existing legacy Hosts, queues and the
read-only Workspaces entry. The complete pinned consumer/native/resource tree is
preserved; this increment does not activate the full T3 mobile interface. Exact
upstream dependency patches and one recorded Expo Widgets workspace adapter are
applied independently of the immutable reference source.

PR #210 merged to stage at `7f62f15652b3398c39fb94952e6f001c45c22d55`.
Its clean source `2fa3808` producer built a standalone Release app with Expo
Modules JSI 58.0.15 in both app and Core contexts, verified its ad-hoc signature
and cold-launched it on a fresh iOS 27.1 Duo simulator. Hermes loaded and the
existing Blackcrab interface rendered without fatal JavaScript/dyld errors.
The preserved native executable SHA256 is
`5eb84dc6edb83118ae352bc8c06f3f81400cedece0a50db43a280cb72a9139b1`.
This validates the platform build/launch foundation, not the full native interface.

On Node 26, all 173 desktop tests, desktop typing and production build passed
after explicitly disabling Node web storage in jsdom test workers. Thirteen native
preparation helper tests cover isolation, exact ABI roots and bounded native/
Metro resources, including an external-cache boundary. Physical devices, signed
distribution and the full native mobile workflows remain open.


### Full native interface integration and bounded installed acceptance

PR #213 merged at `baabfc233714aab00835f0c0899e7250a02fafd1`, followed by
#227 at `3740b343d512964b86953517e0ddbf6941b60e29` and #229 at
`3e7777e622d91b19e22b58d9b5348196a2a94b11`. The full pinned interface is
integrated through one process-lifetime owner with a retained legacy Hosts route.

The standalone Release at source `47b65a55da249591e387cf0beca31a7b55ce44c5`
passed strict simulator signature verification. On a fresh owned iOS 26.2
simulator, both baseline and upgraded UI phases passed with zero failures or
skips. Installing without uninstalling preserved the catalog; native rename and
archive actions were independently confirmed through the shared SDK. The host
closed cleanly with zero runs and zero provider sessions. The committed
[acceptance result](../managed-validation/ios-ui/acceptance-result.json) records
these outcomes. The legacy queue was initially empty, so populated legacy
migration remains unverified.

PR #238 merged at `b387bdbac9058f72d1dddba8a9d480d41de5a484`. Both legacy
LAN and encrypted relay transports now dispatch validated queue results,
queue snapshots and provider responses to their clients. Four wire regressions
failed before the fix; 50 tests across six files and scoped TypeScript checking
passed afterward, followed by all five CI checks. This fixes the event path but
does not supply installed-device or real off-LAN relay evidence.

The native platform configuration also raises widget/share extension targets to
iOS 18 where needed and checks all app/extension build configurations. Earlier
failed dependency clones and native builds remain excluded from accepted evidence.

Provider turns, complete M1–M6 workflows, populated legacy recovery, physical
devices, push/background behavior and signed distribution remain open. The
installed catalog/metadata tests establish only their named behaviors.


### Combined iOS Release acceptance (2026-11-11)

A fresh combined-source Release at `d1d4d2741a9ffece4b1cf79a5255f667f535fd1e`
now builds with an embedded Hermes bundle and a verified ad-hoc simulator signature.
Native staging includes the shared cloud patch inputs, carries the validated hosted
origin, and uses the current Live Activity adapter digest (#249/#252).

The exact product passed a fresh iOS 26.2 baseline-to-upgrade test without
uninstalling. Its paired catalog remained available; rename and archive through the
native interface were confirmed by the independent shared SDK. Both UI phases
passed one test, with zero skips/failures. Legacy storage digests stayed unchanged,
the captured host closed, both owned simulators shut down, and no provider runs or
sessions were created. Thirty controller guards and a new source-bound nonsecret
input canary also passed. See the [structured result](../managed-validation/ios-ui/combined-acceptance-result.json).

This is evidence for a local combined integration candidate against the prior
proof9 packaged direct host. It does not certify the latest managed service profile,
live cloud/off-LAN access, populated legacy migration, physical devices, push,
distribution signing, or the remaining M1–M6 workflows. No merged stage revision is
claimed by this result.


### Current managed service and native iOS acceptance (2026-11-11)

The same combined Release product at `d1d4d2741a9ffece4b1cf79a5255f667f535fd1e`
passed a second fresh-device test against the current 70-record managed service
profile. The service manifest is
`9eac410b7393b18f510fe2d59a756880575bfcfe8fa8c171046f36abd1fa7937`;
the earlier proof9 host result above remains separate historical evidence.

A private Release entry called the unchanged native initializer, current-executable
issuer publisher, original packaged launcher, authentication and pairing code. Fresh
setup and two preflight start/stop cycles passed. Repeated setup and runtime
replacement were refused; desktop attachment did not start a stopped service.

The native baseline paired with a second fresh service owner. Installing the current
app without uninstalling retained the catalog. Rename and archive passed through
the native UI and were confirmed by the shared SDK. The original service then
stopped and restarted; the SDK reconnected and confirmed the same renamed, archived
thread. The service retired all three epochs, configuration stayed unchanged, both
captured owners closed, and both new simulators were confirmed shut down. Provider
sessions and runs remained zero. Thirty controller guards and the source-bound
nonsecret logging canary passed. The app inventory was unchanged. See the
[structured result](../managed-validation/ios-ui/current-service-acceptance-result.json).

This is combined-candidate evidence, with no merged stage revision. The private
entry does not certify the desktop Settings button or OS service-manager controls.
The post-restart assertion covers SDK reconnection and stored metadata; the native
iOS UI's reconnect behavior was not asserted. Cloud/off-LAN, real providers, broader
M1–M6 workflows, populated legacy migration, physical devices, push and distribution
signing remain open.

### Native iOS cold reconnect after service restart (2026-11-11)

The same combined Release app and current managed service now passed the native
cold-reconnect case left open by the previous acceptance result. After the baseline
pairing and upgrade/rename/archive phases, the test terminated the app, restarted
the service, and unarchived that same thread through the independent SDK. A cold
launch displayed the unarchived thread without pairing again. Native rename and
archive then succeeded again, and the SDK verified the exact new title and archive
state on the same thread.

All three native UI phases passed one test each with zero failures or skips. The
source-bound redaction canary and 30 controller checks passed. All three service
epochs closed; both owned simulators shut down; provider runs and sessions remained
zero. The app inventory and service configuration remained unchanged. See the
[structured result](../managed-validation/ios-ui/current-service-reconnect-result.json)
and the [executed XCTest source](../managed-validation/ios-ui/scenarios/service-reconnect.swift).

Earlier attempts reached the reconnect and rename dialog but failed when XCTest's
Command-A shortcut did not select the text. The successful runner uses native touch
selection, asserts an empty field before typing, then asserts the exact new title.
Those earlier attempts remain failures; their cleanup was verified separately.

This remains local combined-candidate evidence with no merged stage revision. It
does not close foreground/background recovery, revoked credentials, live cloud or
off-LAN access, real provider runs, populated migration, physical-device testing,
push/Live Activity, signing, or the actual desktop service Settings/OS controls.

### Native iOS foreground recovery after service restart (2026-11-11)

The same combined Release app and current managed service passed a separate
background-to-foreground workflow. After pairing and upgrade/rename/archive, the
SDK unarchived the thread. The native app displayed it in the catalog and moved to the background via
the Home button. While it remained backgrounded, the service restarted and the SDK
changed the thread title. The app then activated without terminate/launch, displayed
the changed title without pairing again, and renamed and archived that same thread.
The independent SDK confirmed the exact final title and archive state.

All four UI phases passed one test each with zero failures/skips. The runner checked
background state both before the host restart and before activation; at least 25.5
seconds elapsed between the completed background phase and foreground phase. The
source-bound redaction canary and 30 controller checks passed. Product/configuration
remained unchanged, all three native service epochs closed, both owned simulators
shut down, and runs/provider sessions remained zero. See the
[structured result](../managed-validation/ios-ui/current-service-foreground-result.json)
and [executed XCTest source](../managed-validation/ios-ui/scenarios/service-foreground.swift).

This evidence remains tied to the local combined candidate, without a merged stage
revision. It covers a backgrounded app and service restart; it does not establish
OS suspension, locked-phone behavior, Wi-Fi/cellular transitions, off-LAN access,
physical-device delivery, push/Live Activity, signing, populated legacy migration,
or complete background behavior. Desktop service UI and the remaining ledger gates
remain open. Owned mobile automatic updates are also still disabled and require
Blackcrab Expo project/channel configuration and native-compatible update delivery.

### Blackcrab-owned Expo update configuration (2026-11-11)

The original App now retains `installAppUpdateChecks()` and the unchanged pinned
update implementation. The owned Expo entry validates an explicit Blackcrab project
UUID and channel, replaces inherited update configuration, and disables updates
when not configured. Preview/production builds use fingerprint runtime compatibility;
development retains the original app-version policy. EAS build profiles select
explicit environments and the isolated native builder carries validated public
update values without forwarding credentials.

The generated updater's original tests cover persistence flushing, concurrent
checks, deferred installs and rollback. Additional tests cover disabled/native-dev
boundaries and foreground timing. Configuration tests execute the installed Expo
plist plugin and verify the original generated initializer. The snapshot fixture
now stages the actual host inputs present on its branch, then imports and exercises
the production cloud patcher from the snapshot; it no longer assumes a service-only
process-controller module exists on every mobile branch.

See [mobile updates](mobile-updates.md) for build and publication requirements.
An owned Expo project, a newly built update-enabled binary, actual update/rollback
delivery and persisted-state/device acceptance remain open. Earlier simulator
results used update-disabled binaries. These source tests do not close those gates.

### Service revocation and scoped pairing recovery (2026-11-11)

Two original shared SDK clients passed revocation and recovery against the actual
current native service. Revoking the remote session blocked its live connection,
HTTP authentication, RPC-ticket creation and further edits. Pairing the same
environment with a read-only grant preserved one catalog entry and allowed reads;
the host rejected a bare-RPC edit without relying on the client permission guard.
A fresh operate grant restored rename/archive. After a service restart, the
authorized client retained the edited metadata and the old credential remained
revoked. No runs or provider sessions were created, and all captured owners closed.

See the [SDK result](../managed-validation/ios-ui/current-service-sdk-revocation-result.json)
and [executed source template](../managed-validation/ios-ui/scenarios/service-revocation-sdk.test.ts.template).
The native storage/network/app-state ports in this scenario were test adapters.
This does not establish native UI recovery, live relay access, OAuth/DPoP/replay,
other revoke endpoints, physical devices or complete permission coverage.

### Native revocation and pairing recovery (2026-11-11)

The installed combined Release and current service profile passed six native UI
phases: baseline pairing, upgrade retention with rename/archive, holding the live
environment, displaying revoked authentication in expanded diagnostics, pairing
again, and rename/archive after recovery. The app stayed running across revocation
and re-pairing. The scenario checked and acknowledged the original app's exact
legacy-permission notice for its sole host; no system permission dialog was handled.

The independent SDK confirmed a new session with exactly `orchestration:read` and
`orchestration:operate`, one environment, remote metadata visibility, and native
control of the same original thread. All six phases and both pairing-form canaries
passed with zero failures/skips, and 30 controller checks passed. The captured
service owner closed both epochs, the owned simulators shut down, and no runs or
provider sessions were created. App/configuration and legacy digests were unchanged;
the legacy queue was empty. Earlier failed harness attempts remain excluded.

See the [native result](../managed-validation/ios-ui/current-service-revocation-result.json),
[executed Swift source](../managed-validation/ios-ui/scenarios/service-revocation.swift)
and [independent SDK observer](../managed-validation/ios-ui/scenarios/service-revocation-observer.test.ts.template).
The UI test uses detailed diagnostics because the summary row does not expose its
status to accessibility; that gap remains open. This is the update-disabled local
combined candidate, not merged-stage, live cloud, physical-device, populated
migration, all-permissions or complete parity certification.

### Connection summary accessibility

The owned adapter now exposes the visible connection status or diagnosis headline
as the main environment button's accessibility value. Its Manage/Expand action
label and behavior remain unchanged. A fresh combined Release build passed native
checks for the Connected value, the authentication diagnosis after revocation,
and the Connected value after re-pairing. The independent SDK also confirmed
restored rename/archive control of the same thread and a single repaired environment.

An initial canary stopped at a stale widget dylib hash and remains excluded.
The replacement check permits only the observed mode changes for the exact new
product inventory, with unchanged bytes and installed signature verification.

All six UI phases and both pairing canaries passed, alongside 31 controller guards,
29 activation/build-preparation checks, and full staged mobile typechecking. The
captured service owner closed and both owned simulators shut down; no provider
runs or sessions were created. See the [result](../managed-validation/ios-ui/current-service-accessibility-result.json)
and [executed native scenario](../managed-validation/ios-ui/scenarios/service-connection-accessibility.swift).
This verifies native accessibility values on the simulator, not spoken VoiceOver
on a physical device or the remaining G5 scenarios. The build uses the combined
candidate recorded in the result, with cloud and owned update delivery unconfigured.

### Authenticated manual pairing

Legacy manual pairing now accepts a desktop address and code, performs the LAN
handshake, and saves the returned host identity and token only after acceptance.
It no longer creates a placeholder host from the code. Pairing and reconnect reject
mismatched identities; IPv6 endpoints work in both paths. Storage failure and
timeout close the pending connection without reporting a successful pairing.
Existing saved host records remain readable.

Validation: 88 tests across 13 files passed, including real loopback WebSocket
pairing, durable-store readback, token reconnect, negative handshake cases and the
manual form. Scoped strict TypeScript checking passed. Installed iOS and off-LAN
acceptance remain separate work.

### Legacy storage retention

The legacy host catalog and read-position cache now preserve unreadable values,
require durable platform storage and serialize overlapping updates. Pairing closes
its accepted connection when the prior catalog cannot be read or the new record
cannot be saved. The v1 storage formats remain unchanged. The 122 affected tests
and scoped strict TypeScript checking passed. See
[storage behavior and the populated native upgrade gate](mobile-legacy-storage-retention.md).
Four native XCUITest phases passed for a populated baseline, installed upgrade,
explicit queue retry and cold restart on the recorded combined candidate. Older
published-release upgrades, attachments and physical-device acceptance remain open.
