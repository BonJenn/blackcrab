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
