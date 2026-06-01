# Roadmap

This roadmap tracks Blackcrab's product direction. Each item should land as a
separate pull request with its own tests and focused review surface.

## Operating Rules

- Keep one user-visible feature or infrastructure improvement per PR.
- Merge each PR before starting the next dependent PR.
- Prefer shared data/model fixes before adding UI on top of shaky state.
- Update this roadmap when scope changes during implementation.

## Shipped

The original ten-item product push is complete. Each landed as its own PR with
tests:

1. **Native build & release ergonomics** — one local command for an unsigned
   `.app`/`.dmg`; a separate strict signed release path.
2. **Global session search** — find conversations across projects by title,
   project, model, date, and transcript text.
3. **Session metadata reliability layer** — sidebar, grid, single mode, palette,
   and usage all read session metadata from one source.
4. **Project dashboard** — per-project view of sessions, activity, and
   token/cost totals with quick launch.
5. **Usage dashboard v2** — saved usage history, budgets/thresholds, breakdowns,
   CSV/JSON export.
6. **Backup & restore** — export/import settings, layouts, usage history,
   drafts, and per-session overrides; transcripts and secrets excluded. See
   `docs/backup-restore.md`.
7. **Session conflict UX** — a busy session offers "focus where it's open" or
   "take over here" instead of a raw error. *(Read-only view deferred — see
   Next.)*
8. **Command palette expansion** — keyword/alias search plus commands for
   project switching, rename, archive, delete, duplicate panel, backup, and
   diagnostics.
9. **Diagnostics & logs view** — recent command failures, process state, stderr,
   environment, and a redacted copyable report for bug filing.
10. **Saved layouts & workspaces** — named, per-project grid layouts with
    save/load/delete palette commands.

Infrastructure landed alongside: CI now runs the frontend (`vitest`) and Rust
(`cargo test`) suites on every PR, not just type-check and build.

## Next

Near-term, grounded follow-ups:

- **Read-only session view** — the deferred third action from #7. Let a user
  observe a session that another panel owns without taking it over: render the
  transcript with a disabled composer and a clear read-only indicator, leaving
  the backend single-writer protection intact.
- **Lint in CI** — CI type-checks, tests, and builds, but runs no linter. Add
  ESLint (frontend) and `cargo clippy` (Rust) so style/correctness regressions
  are caught in review.
- **Dependency hygiene** — keep the Dependabot PR backlog moving; batch and
  verify the Cargo and npm bumps.

Pick the read-only view first — it closes out the one explicitly deferred piece
of shipped work.

## Mobile Remote Companion

**Status.** In active development (previously experimental scaffolding).

An iOS/Android companion that pairs to a desktop host and observes sessions and
approvals. Substantial pieces have landed:

- **Pairing** — QR pairing, a desktop pairing service, and a mobile pairing
  screen + Settings UI (`src-tauri/src/pairing.rs`, `apps/mobile`).
- **Transport** — a LAN WebSocket transport plus an end-to-end encrypted relay
  for reaching the desktop off-LAN, with automatic LAN/relay failover
  (`src-tauri/src/transport.rs`, `relay_client.rs`, `crypto.rs`,
  `packages/remote-protocol`).
- **Live data** — the desktop pushes the session list and streams the active
  transcript tail to the companion.
- **Remote actions** — send message / stop session, and approve/deny permission
  prompts forwarded from the desktop.

The desktop remains the single authority over local sessions. See
`docs/mobile-remote.md` for the intended architecture and non-goals. Remaining
work centers on hardening the relay/failover paths, reconnection, and the mobile
UX; track those as their own PRs.
