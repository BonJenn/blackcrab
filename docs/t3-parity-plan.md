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
| 04a | Host follow-up queues | Atomic queue/edit/remove/reorder/claim, held work after stop/restart, native APIs and events; real-pipe fixture | Implemented; smoke, 81 native tests and final cargo check passed; awaiting CI and merge |
| 04b | Desktop queue controls | Single/grid composer queue action, edit/remove/reorder, held/resume indicator, event reconciliation and integrated UI validation | Pending, after 04a merges |
| 04c | Mobile queue controls | Shared remote actions/snapshots, stable IDs, mobile queue UI and reconnect/conflict validation | Pending, after 04b merges |
| 05 | Codex adapter and history | Real create/resume/stream/tools/usage/stop/approvals; fake protocol fixture plus opt-in live smoke; account/model settings | Pending |
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
