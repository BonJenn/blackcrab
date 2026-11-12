# T3 functionality parity delivery plan

Full remote iOS control is an explicit delivery requirement, including all applicable
T3 mobile workflows. The app lives in `apps/mobile`; see the
[iOS delivery plan](mobile-ios-parity-plan.md). Mobile foundations can proceed
alongside desktop integration; provider actions depend on shared host services.

Target: BonJenn/t3code commit `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`.
Destination: `stage`. Keep one coherent improvement per PR and merge it before
starting dependent implementation. Leave release tags and `main` unchanged.

The audit in [t3-parity.md](t3-parity.md) defines the broader scope. This is an
ordered implementation backlog, not a claim that the rows have shipped.
Mark a row complete only with a merged PR and relevant validation evidence.
Split a row into smaller PRs when necessary; do not merge a provider selector or
client action before its backend works.

## Open source and hosted-service rollout

The user approved the [open-source and paid hosted-service plan](hosted-service-plan.md)
on 2026-11-12: free local/self-hosted software, explicitly configured official
releases, invite-only hosted testing, then paid remote access with server-side
entitlements, quotas and cost controls. URLs are public configuration, not payment
or access credentials. Prices and billing implementation remain undecided.

Finish the current Mac/TestFlight owner delivery while preparing this work.
HS01–HS06 add public-launch gates; they do not replace native acceptance or imply
that subscriptions, restricted signup or a hard spending ceiling already exist.

| Order | Deliverable | Acceptance / evidence | State |
|---|---|---|---|
| 01 | Pin target, plan, staging CI | Stage exists; PR and stage pushes run CI; baseline is traceable | Merged [#171](https://github.com/BonJenn/blackcrab/pull/171), all 3 CI checks passed |
| 02 | Provider-neutral launch boundary | Claude argument/auth/resume behavior preserved; invalid providers fail before replacing a process; capability discovery is honest | Merged [#172](https://github.com/BonJenn/blackcrab/pull/172), smoke + all 3 CI checks passed |
| 03 | Durable execution store | Stable thread/turn/command identity, atomic state updates, idempotent receipts; crash/reload recovery tested | Merged [#173](https://github.com/BonJenn/blackcrab/pull/173), smoke + all 3 CI checks passed |
| 04a | Host follow-up queues | Atomic queue/edit/remove/reorder/claim, held work after stop/restart, native APIs and events; real-pipe fixture | Merged in #174; smoke, 81 native tests and all 3 CI checks passed |
| 04b | Desktop queue controls | Single/grid composer queue action, edit/remove/reorder, held/resume indicator, event reconciliation and integrated UI validation | Merged #175; all 3 CI checks passed, smoke and 84 frontend / 81 native tests passed; visual QA remains unverified due to app automation timeout |
| 04c1 | Remote queue protocol and host | Shared LAN/relay decoder, correlated results and snapshots, stable enqueue IDs, stopped confirmation, conflict and real-pipe tests | Merged #176; all 3 CI checks passed; smoke, 84 native / 84 desktop / 40 mobile / 46 protocol tests and workspace typechecks passed |
| 04c2 | Mobile queue controls | Phone composer/queue UI, persistent retry IDs, reconnect/conflict validation and device evidence | Merged #177; all 3 CI checks passed; smoke, 55 mobile / 46 protocol / 84 desktop / 84 native tests, workspace typechecks and iOS Hermes export passed; device/visual evidence remains unverified |
| 05a | Codex app-server transport | Initialize/JSONL framing, bidirectional requests, bounded queues, timeout and cleanup fixtures; CLI initialization probe | Merged #178; all 3 CI checks passed; smoke, 97 native / 84 desktop tests and installed CLI 0.166.0 initialize/close probe passed |
| 05b | Codex runtime and receipts | Create/resume/stream/tools/usage/stop/approvals, normalized events and durable turn identity; fake provider lifecycle fixture | Merged #179; all 3 CI checks passed; smoke, 110 native / 84 desktop tests and Cargo check/build passed |
| 05c1 | Codex native host routing | Shared session/send/queue/interrupt/stop commands, typed provider events, namespaced ownership and native host fixtures | Merged #180; all 3 CI checks passed; smoke, 115 native / 84 desktop tests and Cargo check/build; clientReady remains false |
| 05c2 | Codex account/model/history services | Read-only catalog/account and stored history APIs with provider identity and pagination | Merged #181; all 3 CI checks passed; smoke, 123 native / 84 desktop tests and Cargo check/build; clientReady remains false |
| 05c3a | Codex desktop history browser | Account/catalog views, filtered thread/turn/item pages and explicit legacy full turn pages; race/error/escaping/focus tests | Merged #182; all 3 CI checks passed; smoke, 92 desktop / 123 native tests and Cargo check/build; read-only, clientReady remains false |
| 05c3b1 | Codex controls bound to a run | Atomic provider/panel/run validation, typed native actions/client bridge; stale-action replacement fixtures | Merged #183; all 3 CI checks passed; smoke, 97 desktop / 126 native tests and Cargo check/build; clientReady remains false |
| 05c3b2 | Codex live client state | Persisted unconfirmed sends, run/turn scoped event state, explicit recovery, queues and one-time approvals; injected backend fixtures | Merged #184; all 3 CI checks passed; smoke, 116 desktop / 126 native tests and Cargo check/build; clientReady remains false |
| 05c3b3 | Codex conversation preview | Dedicated single-workspace start/resume, renderer, composer, queues and one-time approvals; persistent draft/owner lifecycle and DOM scenarios | Merged #185; all 3 CI checks passed; smoke, 130 desktop / 126 native tests and Cargo check/build; dedicated preview, general clientReady remains false |
| 05c3b4a | Development verification isolation | Suppress dev product analytics; record native startup and automation availability accurately | Merged #186; all 3 CI checks passed; smoke, 130 desktop / 126 native tests and Cargo check/build; native automation unavailable |
| 05c3b4b | Independent provider setup entry | Codex preview entry without dismissing/claiming successful Claude setup | Merged #187; all 3 CI checks passed; smoke, 132 desktop / 126 native tests and Cargo check/build; general clientReady remains false |
| 05c3b4b2 | Reproducible native Codex QA | Isolated macOS bundle and local CLI fixture, real native workflow evidence, durable receipt regression | Merged #188; all 3 CI checks passed; native fixture scenarios verified; smoke, 132 desktop / 127 native tests and Cargo check/build; actual model turns remain unverified |
| 05c3b4c1 | Codex multi-conversation desktop workspace | Stable per-pane owners and drafts, six-pane single/grid views, hidden attention, removal/recovery guards and native fixture scenarios | Merged #189; all 3 CI checks passed; smoke, 142 desktop / 127 native tests and Cargo check/build; two-pane native grid, approval, restart/draft and removal scenarios passed; general clientReady remains false |
| 05c3b4c2 | Main desktop provider views | Full-width Codex workspace, persistent provider selection, retained owners/drafts, provider-scoped input and Claude setup | Merged #190; all 3 CI checks passed; smoke, 147 desktop / 127 native tests and Cargo check/build; native provider switch, retained Codex run/drafts and restart passed; mixed-provider grid/window and real model gates remain open |
| 05c3b4c3 | Desktop pane ownership and focus | Disjoint new-pane addresses, preserved legacy identities, window-scoped caches and focus routing | Merged #193; all 3 checks passed; smoke (152 desktop / 127 native), production build and one-window native fixture; multi-window certification remains open |
| 05c3b4c4 | Retained desktop conversations | Removed panes remain discoverable after reload and reopen their original workspace without starting or replaying work | Merged #195; all 3 checks passed; smoke (159 desktop / 127 native), production build and native remove/reopen/restart fixture passed; pre-index removals and cross-window migration remain open |
| 05c3b4c5 | Resizable desktop grid | Persistent aligned dividers, pointer/keyboard/equalize, stable owners and narrow selected view | Merged #198; all 3 checks passed; smoke (167 desktop / 133 native), native four-pane drag/bounds/restart/narrow scenarios passed |
| 05c3b4c | General desktop integration and verification | Single/grid provider selection, owner/window scenarios, visual checks and opt-in real turns; advertise only verified readiness/capabilities | Pending |
| 05c4a | Authoritative mobile host state | Remove demo data, scope snapshots/approvals to active host/session, retire stale callbacks and disable disconnected decisions | Merged #191; all 3 CI checks passed; 64 mobile / 46 protocol tests, mobile typecheck, iOS Hermes export and smoke (147 desktop / 127 native); full remote iOS scope in [delivery plan](mobile-ios-parity-plan.md) |
| 05c4b | Mobile host selection and connection ownership | Connect/reconnect/disconnect from Hosts; retired connection failures cannot clear another host; startup/pairing/forget use one owner | Merged #192; all 3 CI checks passed; 71 mobile / 46 protocol tests, mobile typecheck, iOS Hermes export and smoke (147 desktop / 127 native) |
| 05c4c | Durable mobile text drafts | Host/session draft persistence, revision-safe queue transfer and reconnect recovery | Merged #194; all 3 checks passed; 87 mobile / 46 protocol tests, workspace typechecks and iOS Hermes export; combined-tree smoke (152 desktop / 127 native); native iOS remains unverified |
| 05c4d | Remembered mobile startup host | Explicit selection/disconnect survives restart; failed saves and stale startup reads cannot silently change hosts | Merged #196; all 3 checks passed; 102 mobile / 46 protocol tests, workspace typechecks and iOS Hermes export; device evidence remains open |
| 05c4e | Remote provider discovery | Authenticated shared LAN/relay discovery, correlated results and honest per-client support on the phone | Merged #197; all 3 checks passed; 109 mobile / 48 protocol tests, workspace typechecks, iOS export and combined smoke (167 desktop / 133 native) passed; typed Codex remote actions remain pending |
| 05c4 | Codex mobile integration | Provider-aware remote actions, history/queue/approval UI and device scenarios | Pending, after 05c3b4c merges |
| 06a | Independent-host architecture prototypes | Isolated runtime extraction and pinned T3 source/bundle startup, authentication and persistence evidence; packaging comparison | Merged #199; all 4 checks passed; both prototypes and required smoke passed; decision in [host architecture](independent-host-architecture.md); production host remains pending |
| 06b | Packaged managed runtime | Pinned source/toolchain, full native payload and attribution, relocated authentication/client/restart checks without source or host Node | Merged #201; all 4 checks passed; 30 package tests and required smoke passed; relocated macOS arm64 package passed both starts, protected access and project recovery; supervision/client attachment and other native targets pending |
| 06c | Persistent managed desktop attachment | Native package verification, isolated durable host, rotating bootstrap auth, stable identity and scoped window attachment | Merged [#202](https://github.com/BonJenn/blackcrab/pull/202); 173 desktop / 145 native tests passed, required smoke and native launcher-exit/authentication fixture passed; native window authenticated and host survived window/app exit; GUI relaunch observation unavailable; full desktop bridge and remote iOS remain open |
| 06d | Native managed iOS connection | Shared-source pairing, registry/RPC, project/thread discovery and native state recovery | Merged [#203](https://github.com/BonJenn/blackcrab/pull/203); all four checks passed; packaged-host and iOS26.2 pairing/recovery checks passed; agent controls and full mobile UI remain open |
| 06e | Reproducible standalone iOS build | Physical isolated workspace, locked dependencies, native floor, Release Hermes and simulator signing | Merged [#204](https://github.com/BonJenn/blackcrab/pull/204) at `8e463c7086e62533b5f9d744af6b25072b0f5bc9`; 12 boundary/plugin tests, required clean-commit smoke and all four CI jobs passed; untouched product launched/relaunched after source removal; physical-device/distribution evidence open |
| 06f | Scoped managed desktop native actions | Local folder selection and external HTTP(S) links with live authenticated grants and cross-origin ACL verification | Merged [#205](https://github.com/BonJenn/blackcrab/pull/205); four CI jobs and required macOS smoke passed (173 desktop / 151 native tests, 3 opt-in ignored); actual folder-dialog interaction remains unverified due to automation binding failure; broader native desktop facilities open |
| 06g | Complete pinned mobile source preparation | Authenticated full source/native/resource export with per-owner dependency provenance and generator inputs | Merged [#206](https://github.com/BonJenn/blackcrab/pull/206); reproducible 3,109-file exports, 15 boundary tests and four CI jobs passed; native platform upgrade, own configuration and complete UI activation remain open |
| 06h | Native inventory and packaged thread acceptance | Complete native surface inventory; actual shared-SDK command deduplication, archive/restart and permission checks | Merged [#207](https://github.com/BonJenn/blackcrab/pull/207); scoped types and four CI checks passed; actual packaged-host acceptance passed separately; complete native workflows remain open |
| 06i | Native external project icons | Scoped local icon adapter, host permissions and persistent image recovery | Merged [#208](https://github.com/BonJenn/blackcrab/pull/208); 42 host/source tests, required macOS smoke and four CI checks passed; manual picker interaction remains unverified |
| 06j | Full native desktop client attachment | Full pinned service graph/preload with independent host lifecycle, Blackcrab identity, independent client sessions and native browser reconnect | In progress; [direction and proof boundaries](managed-native-desktop-direction.md); prototype attachment/windows/preferences passed; production package and complete native acceptance open |
| 06k | Complete native mobile platform | Pinned complete source consumers, native modules/resources, locked platform graph and runnable standalone Release | In progress; exact JSI ABI correction passed standalone Release cold-launch probe; 173 desktop tests passed on Node 26; fresh committed-source build and full mobile UI activation remain open |
| 06k1 | Owned native iOS acceptance harness | Pinned runner, private official XCTest evidence, owned-device and live-handle cleanup guards | Harness merged [#220](https://github.com/BonJenn/blackcrab/pull/220); compiler-enabled source47b65a5 passed fresh-device pairing, retained catalog, rename and archive. Both UI phases passed 1/1 with zero skips. Independent SDK verified mutations, unchanged legacy digests, zero runs/provider sessions and captured host closure. Thirty portable guards pass. Broader controls, populated migration and physical-device/distribution acceptance remain open |
| 06 | Independent host and reconnect | Host outlives UI; desktop plus second client converge; no duplicate writer or replayed side effects | Pending |
| 07 | Managed worktrees and project scripts | Provider-independent create/reuse/setup/cleanup; failures recover; dirty user work protected | Pending |
| 08 | Turn checkpoints and diffs | Before/after snapshots, per-turn and branch/commit comparison; upstream-only changes excluded from turn view | Pending |
| 09 | Checkpoint restore | Conflict/dirty-work protections; restores selected scope; interrupted restore recoverable | Pending |
| 10 | Git actions | Status/stage/commit/push/pull/clone/publish with useful errors and no accidental overwrite | Pending |
| 11 | GitHub PR workflow | Create/link/review/comments/checks/watch/merge; state updates after push; permissions respected | Pending |
| 12 | Application MCP API | Authenticated scoped read/write tools call the same services as clients; revoke and stale approval tests | Pending |
| 13 | Delegation | Durable parent/child lifecycle, cancel, question/completion delivery and inherited permissions | Pending |
| 14 | Goals and schedules | Pause/resume/clear, intervals and webhooks, duplicate/overlap protection through restart | Pending |
| 15 | Remote hardening and environments | Reuse/review existing #154–161 where applicable; multi-host routing, scoped access, disconnect/reconnect | Pending |
| 16 | Full web/mobile client workflows | Shared commands, offline drafts, source control, settings, background notification and real device evidence | Pending |
| 17 | Other providers and source-control hosts | Enumerate target registry; validate each adapter/host capability and limitations | Pending |
| 18 | Browser, files, visual tools and voice | Shared browser automation/capture/annotations; file/media/citations; dictation review/cancel | Pending |
| 19 | Thread/pane interaction and settings | Pin/settle/snooze/undo, scratch-to-project, resizable panes/windows, keybindings | Pending |
| 20 | Secrets, maintenance and distribution | Scoped secret references, diagnostics/triage, provider updates, tested macOS/Windows/Linux/headless packaging | Pending |
| 21 | Complete parity ledger | Every target user doc, RPC/MCP action and setting mapped to scenarios and evidence per supported client/provider | [Scenario inventory](t3-parity-ledger.md) covers 47 user docs plus contract/settings registries; all scenarios still require accepted evidence; full certification pending |

## Current integration and acceptance status (2026-11-10)

This snapshot is reconciled against stage `b387bdbac9058f72d1dddba8a9d480d41de5a484`.
The detailed delivery rows above preserve the evidence available when each
increment landed. Use this snapshot for the current integration status.

| Capability | Implementation / integration | Accepted behavior | Remaining acceptance |
|---|---|---|---|
| Independent managed host | Packaged host and runtime integration merged in #201, #202, #207 and #212 | Relocated authentication, project recovery, shared-SDK thread metadata/deduplication and read-only enforcement | Full provider execution, remote exposure and broad domain scenarios |
| Full native iOS interface | #213 and #227 merged to stage | Standalone Release build, strict simulator signature, full-interface installed launch | Physical-device and distribution validation |
| iOS catalog and metadata controls | #229 merged; acceptance result committed | Pair baseline, install upgrade without uninstalling, retain catalog, rename and archive; independent SDK confirms mutations and zero provider runs | Populated legacy migration, broader agent/workspace actions and failure recovery |
| Legacy mobile queue/provider delivery | #238 merged | Actual LAN and encrypted relay transports deliver queue/results/provider discovery; 50 focused tests and scoped typing pass | Installed iOS and real off-LAN relay validation |
| Full desktop native client | Implementation remains in the #215 stack | Packaged client/browser and native lifecycle evidence recorded in the stack | Normal Root entry, reuse, quit/reopen, remaining native methods and merge to stage |
| Background service and native browser attachment | Implementation remains in #217–237 | Native service setup/control fixtures and browser protocol tests recorded in the stack | Current combined artifact/runtime validation and merge to stage |
| Remaining T3 workflows and external services | Covered by the scenario inventory; upstream source inclusion alone is not an integration result | No blanket acceptance claimed | Provider turns, complete coding/orchestration workflows, push, remote/cloud configuration and release gates |

The scenario ledger groups multiple behaviors and surfaces into each row. Its
144 open rows measure outstanding acceptance obligations, not the fraction of
code implemented. Track implementation, integration and accepted behavior
separately; neither merged PR counts nor open-row counts provide a defensible
overall completion percentage. Full parity remains open.

## Implementation decisions

The provider compatibility steps preserved the existing Rust/Tauri backend.
The required isolated comparison now demonstrates both Rust runtime extraction
and pinned T3 backend reuse. The [architecture decision](independent-host-architecture.md)
selects T3 backend/contracts/shared client-runtime reuse for new managed
workspaces, preserving existing views and pairings while production integration
lands. Package and supervise a separate managed host before connecting clients;
provider-session migration must never introduce a second writer. Neither the
prototypes nor the source/bundle startup checks complete phase 06.

Persist execution state on the host, not in React components or only in browser
localStorage. Transcripts remain provider-owned, while Blackcrab owns command
receipts, queued messages, turn state, and orchestration metadata. Unknown or
interrupted execution must require an explicit recovery action rather than
silently replaying a possibly delivered message.

## Verification gates

- Before each PR: focused behavior tests, frontend typecheck/build, Rust check
  where native code changed, and the repository's required smoke check.
- Before merge: read the final diff, resolve review findings, verify checks and
  mergeability, then merge to `stage`. Never bypass failing required checks.
- Validate critical state/protocol behavior with fixtures, including failure and
  restart; UI wiring alone is not enough.
- Provider turns and device tests require explicit recorded evidence. Do not
  label a source-only implementation as end-to-end verified.
- Update this table with PR URLs, validation and remaining limitations after
  every merge. Full parity remains unfinished until row 21 is satisfied.
