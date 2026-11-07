# T3 functionality parity delivery plan

Target: BonJenn/t3code commit `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`.
Destination: `stage`. Keep one coherent improvement per PR and merge it before
starting dependent implementation. Leave release tags and `main` unchanged.

The audit in [t3-parity.md](t3-parity.md) defines the broader scope. This is an
ordered implementation backlog, not a claim that the rows have shipped.
Mark a row complete only with a merged PR and relevant validation evidence.
Split a row into smaller PRs when necessary; do not merge a provider selector or
client action before its backend works.

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
| 05c3b4c1 | Codex multi-conversation desktop workspace | Stable per-pane owners and drafts, six-pane single/grid views, hidden attention, removal/recovery guards and native fixture scenarios | Implemented; smoke, 142 desktop / 127 native tests and Cargo check/build; two-pane native grid, approval, restart/draft and removal scenarios passed; awaiting PR/CI; general clientReady remains false |
| 05c3b4c | General desktop integration and verification | Single/grid provider selection, owner/window scenarios, visual checks and opt-in real turns; advertise only verified readiness/capabilities | Pending |
| 05c4 | Codex mobile integration | Provider-aware remote actions, history/queue/approval UI and device scenarios | Pending, after 05c3b4c merges |
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
| 21 | Complete parity ledger | Every target user doc, RPC/MCP action and setting mapped to scenarios and evidence per supported client/provider | Pending |

## Implementation decisions

Start by extracting the existing Claude launch contract behind a typed provider
boundary. Keep the current Rust/Tauri backend during this compatibility step.
Do not migrate user transcripts or introduce a second process writer. Before
making the host independent (06), compare a small isolated T3 backend reuse
prototype with extracting Rust services; record the outcome and packaging costs.
No copied T3 implementation is needed for the launch extraction.

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
