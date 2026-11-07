# Blackcrab / T3 Code functionality audit

Audited 2026-11-06. Target: the default branch of [BonJenn/t3code](https://github.com/BonJenn/t3code), not an assumed upstream release.

Blackcrab checkout: `6ab00e0a286ed2fa6e97736bfd5935f0e195c9d2` (clean before this document).
T3 reference Git HEAD: `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`. The downloaded GitHub archive root is `BonJenn-t3code-7f02de2/`, matching the Git HEAD; the commit was also verified through the GitHub API.

## Conclusion

Blackcrab already covers much of the local Claude conversation experience. T3 is a substantially broader agent operating environment. Achieving all its functionality requires a durable host service and provider abstraction, then source control, checkpointing, automation, remote environments, and consistent clients. Adding buttons to the current Claude subprocess wrapper will not achieve that scope.

Recommended direction: preserve Blackcrab's Tauri shell, compact grid, existing Claude history integration, usage dashboards, and backup tools. Add a transport-independent application service with durable threads, turns, commands, events, and provider capabilities. Start with Claude and Codex, then expand to every provider exposed by the pinned T3 target. Decide against a prototype of the alternative—Blackcrab as a client of the T3 backend—before committing to a complete independent backend. Backend reuse could save substantial work but introduces Node packaging, T3 contract/migration dependencies, and overlapping ownership of session history. Do not operate two writers on the same provider session.

This is a source audit and implementation plan. No runtime behavior was changed, no apps were launched, and no parity claim is based on end-to-end validation. “Missing” means no equivalent implementation was found in the inspected Blackcrab source; a CLI prompt that asks Claude to do something does not count as an application feature. T3 source presence likewise does not prove production readiness.

## Capability matrix

Present = substantial corresponding implementation, not certified equivalent behavior. Partial = meaningful overlap with important missing behavior. Missing = no corresponding app-level implementation found. Every row needs scenario-level validation before it can be marked parity-complete.

| Capability | Blackcrab now | T3 target and evidence | Work required |
|---|---|---|---|
| Providers and accounts | Claude only; Claude preflight and token handling in `src-tauri/src/lib.rs` | Provider registry, capabilities, credentials, model catalogs; `apps/server/src/provider/`, `packages/provider-*` | Missing multi-provider layer. Add adapters and per-account configuration; validate enabled providers individually rather than infer support from package names. |
| Durable orchestration | CLI JSONL history; in-memory panel processes, local metadata and drafts | `apps/server/src/orchestration-v2/`, `persistence/`; atomic events/projections/outbox | Partial. Persist command receipts, turn lifecycle, queued work, approvals, and recovery separately from provider transcript files. |
| Parallel conversations | Present: up to six live grid panels, named layouts (`src/LivePanel.tsx`, `src/layouts.ts`) | Six resizable/reorderable panes, detach to desktop windows (`docs/user/split-panes.md`) | Partial UI parity: verify sizing, drag/drop, focus behavior, window ownership and restoration. |
| Session browsing and search | Present: Claude history search, rename, archive, delete, export, metadata | Durable thread lifecycle and navigation (`docs/user/thread-sidebar.md`) | Keep history import; add provider-neutral thread identity and lifecycle. |
| Thread organization | Archive, project grouping, attention states | Pin/reorder, settle, snooze/wake, undo, scratch threads that become projects | Partial. Persist each reversible transition and expose it consistently. |
| Composer and attachments | File drop, tracked-file completion, drafts, tool transcript (`src/App.tsx`, `src/LivePanel.tsx`) | Rich composer, citations, file/media previews, queued draft attachments (`docs/user/composer.md`) | Partial. Add structured attachments and context across clients; compare limits and rendering. |
| Follow-up queue and steering | Send guarded while busy in `LivePanel.tsx`; no durable queue found | Queue/steer choice, edit/remove/reorder, restart-held queue (`docs/user/composer.md`) | Missing equivalent durable follow-up workflow. Respect each provider's steering capabilities. |
| Goals and continued work | No app-level equivalent found | Goal commands in composer docs; orchestration goal state | Add persisted goals, pause/resume/clear, limits and completion handling. |
| Permission modes and approvals | Present for Claude, including plan mode; remote approve/deny | Scoped clients, provider capability handling (`docs/user/permission-modes.md`, server auth/policy) | Partial. Normalize modes; enforce effective permissions on the host for UI, MCP, scheduling and delegation. |
| Model settings and usage | Present Claude model/context/token/cost displays, budgets, exports | Provider catalogs, effort/options, account usage limits (`provider/`, `usage/`, `docs/user/usage.md`) | Partial. Expand without losing Blackcrab's reports; avoid assuming equal token semantics. |
| Terminals | Present native PTY and xterm (`src/Terminal.tsx`, backend PTY commands) | Persistent thread terminals across clients (`docs/user/terminal.md`, server `terminal/`) | Partial. Define ownership, reconnect/replay, resizing and recovery. |
| Branches and worktrees | Branch list/switch and Claude `--worktree` on new panel | Managed worktree lifecycle, project setup scripts, reuse, branch synchronization (`project/WorktreeSetupTracker.ts`, `WorktreeBranchSync.ts`) | Partial. Track ownership, setup status, failures and safe cleanup independently of Claude. |
| Workspace diffs and restore | Tool edit old/new text rendering; no checkpoint service found | Turn checkpoints, branch/commit diff views and restore (`checkpointing/`, `CheckpointCaptureService.ts`, `CheckpointRollbackService.ts`) | Missing turn-level snapshots and safe rollback. Tool diffs are not workspace history. |
| Git actions | Branch helpers and remote URL lookup | Commit/push/pull, clone/publish and review workflows (`git/GitWorkflowService.ts`, `docs/user/source-control.md`) | Partial. Add typed operations, progress/failure states and protection of unrelated local edits. |
| Pull requests and code hosts | Linkification of PR references | Review, comments, guides, checks, merge/auto-merge, watching; multiple hosts (`pullRequest/`, `packages/source-control-*`) | Missing application workflow. Start GitHub, then cover all hosts and documented host-specific limitations. |
| Agent delegation | Independent live panels; no host-managed parent/child task lifecycle found | Local/remote delegation, completion and question delivery (`peer/RemoteDelegation.ts`, orchestration delegated-task services) | Missing durable tasks, cancellation, context/settings inheritance, completion and failure delivery. |
| Schedules and triggers | No user task scheduler found | Scheduled tasks, intervals, webhook handling (`scheduledTasks/`, `scheduling/`) | Missing. Persist schedule state, execution receipts, overlap policy, pause/delete and restart behavior. |
| MCP access to the application | Claude can use its configured MCP servers; interactive `/mcp` entry | External agents access T3 threads/actions over authenticated MCP (`mcp/`, `docs/user/outside-agents.md`) | Missing host MCP API. Consuming MCP in Claude does not expose Blackcrab's own capabilities. |
| Browser and visual tools | Local URL side webview; Claude interactive computer-use sidecar | Shared browser automation, page streams, annotations, HTML renders, screenshot tools (`preview/`, `htmlRender/`, `docs/user/snap-shot.md`) | Partial. Build typed host browser operations and agent tools, with reviewable results and remote access. |
| Remote phone access | Real pairing, LAN WebSocket, encrypted relay, reconnect/failover; messages, stop, approvals, attachments and read state (`src/remote/`, backend remote modules, `apps/mobile`) | Broader mobile client with source control, settings, voice, notifications and multi-environment workflows | Partial, not merely a scaffold. Build/device status needs independent verification; mobile README is not sufficient proof of current shipping status. |
| Web and headless host | Vite web development mode; desktop Tauri owns native operations | Usable web client, CLI/background service independent of Electron (`apps/server`, `apps/web`, `docs/user/background-service.md`) | Missing equivalent standalone host and authenticated web deployment path. |
| Multiple machines and access | Mobile host pairing and device revocation | Environment linking/routing, SSH/Tailscale/tunnel access, guest links and scoped grants (`peer/`, `auth/`, `packages/ssh`, `packages/tailscale`, user remote/guest docs) | Partial foundation. Add host-to-host and client-to-many-host flows and enforce destination permissions. |
| Secrets and integrations | Claude token in macOS Keychain; mobile secure pairing storage | Secret references, requests and provider integrations (`secrets/`, `packages/secret-provider-*`, `docs/user/secrets.md`) | Partial. Add scoped secret resolution, redaction and remote delivery without storing secrets in transcripts. |
| Voice input | No application dictation workflow found | Local/server transcription models, language/dictionary, cleanup and review before send (`speech/`, `docs/user/voice-input.md`) | Missing, including desktop/web/mobile microphone and recovery behavior. |
| Notifications | Present desktop completion notifications and attention indicators | Mobile push/background notifications and richer lifecycle delivery (`docs/user/mobile-notifications.md`) | Partial. Add push registration, routing, revocation and background delivery. |
| Diagnostics and recovery | Present diagnostics, failures, stderr report and backup/restore (`src/diagnostics.ts`, `src/backup.ts`) | Activity log, triage, migration, server and provider maintenance (`docs/user/activity-log.md`, `triage.md`, `thread-migration.md`) | Partial. Keep current tools; extend with durable run recovery and environment/provider status. |
| Distribution and configuration | macOS-first Tauri packaging/updater, Expo companion code | macOS/Windows/Linux desktop, web and headless install/service, mobile; extensive settings/keybindings/policy | Partial. Prove each platform and surface; matching framework support is not matching shipped behavior. |

## Architecture contrast

Blackcrab uses React/Vite → Tauri invoke/events → Rust → Claude CLI and native PTYs. It indexes Claude's own session JSONL and persists much of the UI's state locally. Main UI and event handling are concentrated in `src/App.tsx` (over 12,000 lines), with a second event-handling path in `src/LivePanel.tsx`. The existing remote transport and shared protocol are useful foundations.

T3 uses web/mobile/desktop clients → typed RPC/WebSocket → a Node service → durable orchestration and provider adapters. Its orchestrator decides events; storage commits events, projections, receipts and effects together; a worker performs external effects afterward. It has independent domain services for worktrees, checkpoints, Git/PRs, delegation, schedules, secrets and browsers. This architecture makes the same operation usable from a client, an agent tool or a scheduler.

Parity does not require copying Effect, Electron or every internal T3 abstraction. It requires matching user-visible outcomes and failure behavior. The service can be Rust if the team accepts reimplementing the corresponding domain behavior. Reusing T3's backend should be tested as an alternative before choosing that cost.

## Delivery sequence and acceptance criteria

Follow `ROADMAP.md`: one coherent improvement per PR, merge before dependent work. The phases below are milestones, not single PRs. No commits, issues or PRs were created by this audit.

1. **Freeze and inventory the target.** Pin a T3 commit; enumerate its user docs, enabled provider catalog, RPC/MCP operations and settings into a scenario ledger. For every scenario record desktop/web/mobile support, expected outcome, error/restart behavior and proof. Include features discovered outside this first-pass matrix. Full parity cannot be certified from a category checklist.
2. **Choose and establish the host boundary.** Prototype one Claude turn through an independent Rust host service and, separately, a Tauri client against an isolated T3 service. Compare packaging, history import, reconnect and adapter reuse. Choose one ownership model. Acceptance: desktop and a second client observe the same turn; desktop reload does not duplicate execution; host restart recovers to an honest terminal/recoverable state.
3. **Persist the execution model.** Provider-neutral thread/turn IDs, normalized events, commands/receipts, approvals, queues, attachments, subscription replay and capability flags. Move logic out of view components. Acceptance: duplicate requests are safe; disconnect/reconnect preserves order; stale approvals cannot execute; stopped/restarted queues never run unexpectedly. Preserve Claude history import and current backups.
4. **Add multi-provider execution.** Claude adapter first, Codex second, then each configured provider in the pinned T3 catalog, including supported custom registry paths. Acceptance per adapter: discovery/auth, create/resume, stream, tools, usage, interrupt/stop, approvals, options and unsupported-feature reporting. Never present a provider selector that still launches Claude underneath.
5. **Reach the coding workflow milestone.** Durable worktree lifecycle/setup, Git status/diffs/actions, turn checkpoints/restore, then GitHub PR creation/review/checks/watch/merge. Acceptance: unrelated dirty files survive restore; failed setup is recoverable; turn diff excludes imported upstream changes; PR state refreshes correctly after push. Expand to every target code host after GitHub.
6. **Add agent automation.** Host MCP API using the same services as the UI; parent/child delegation, goals, schedules and webhook triggers. Acceptance: child completion/questions are delivered once, cancellation settles the child, permissions cannot escalate, restart does not duplicate a scheduled run, paused/deleted schedules stop launching work.
7. **Complete remote and client parity.** Headless host, functional web client, multiple environments, scoped grants, mobile source control/settings, notifications, secrets, reconnect/offline drafts. Acceptance: every action reaches the selected host, revocation is effective, reconnect converges, and mobile paths are exercised on actual installable builds. Existing encrypted relay behavior must remain covered.
8. **Complete interaction and distribution parity.** Shared browser automation/annotations, visual renders and capture, voice, richer files/citations, panes/windows, thread organization, keybindings, maintenance/triage, cross-platform packaging. Acceptance: scenario ledger passes on each applicable surface; unsupported host/provider combinations are explicit rather than silently omitted.

The first useful product milestone is Claude + Codex, durable queue/reconnect, managed worktrees, turn diffs/restore and GitHub PR workflow. That is a major improvement, but it is not full T3 parity. All later phases remain in scope for full parity.

## Verification and maintenance

This audit used repository metadata, source listings, targeted implementation searches, and user/architecture documentation. It did not install dependencies, run tests, execute providers, build mobile apps or validate a relay deployment. Runtime and packaging readiness remain unverified.

For each future change, run Blackcrab's relevant frontend/Rust checks and focused behavior tests. Validate imported history, single-writer ownership, permission/stop flows and backup compatibility after foundational changes. Test distributed behavior with two clients and a separate host process rather than only mocked UI events.

Use T3 as a behavioral reference. If copying code, preserve its MIT notice and audit copied dependencies/third-party notices; Blackcrab currently declares Apache-2.0. This is an attribution/engineering task to address when choosing reuse, not a blocker to this source comparison.

## Source entry points

- Blackcrab: `README.md`, `ROADMAP.md`, `src/App.tsx`, `src/LivePanel.tsx`, `src-tauri/src/lib.rs`, `src/remote/`, `packages/remote-protocol/src/index.ts`, `apps/mobile/App.tsx`, `apps/mobile/src/screens/`, `apps/relay/src/lib.rs`.
- [T3 README](https://github.com/BonJenn/t3code/blob/main/README.md) and [architecture](https://github.com/BonJenn/t3code/blob/main/docs/internals/overview.md).
- [T3 user guide inventory](https://github.com/BonJenn/t3code/tree/main/docs/user).
- [T3 server domains](https://github.com/BonJenn/t3code/tree/main/apps/server/src) and [shared/client/provider contracts](https://github.com/BonJenn/t3code/tree/main/packages).

The links follow main and will move. Pin them to the final baseline SHA when establishing the executable parity ledger.
