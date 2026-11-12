# Blackcrab — agent working guide

This file and CLAUDE.md in the same directory must remain byte-for-byte identical.
Read the nearest directory guide as well. These guides preserve project context;
current user instructions and verified repository state take precedence.

## Mission and completion

Deliver functionality parity with BonJenn/t3code pinned at
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`, including the full remote iOS app.
The user explicitly wants a current Blackcrab build installed on their Mac and
Blackcrab Remote available to them in TestFlight before their acceptance session.
Merged PRs, imported source, green CI, and simulator builds alone do not finish
that request. Keep implementation, integration, runtime evidence, and delivery
status separate. Do not invent a percentage from PR or scenario counts.

Start with [the handoff](docs/agent-handoff.md),
[the delivery plan](docs/t3-parity-plan.md), and
[the scenario ledger](docs/t3-parity-ledger.md).
[The copyable prompt](docs/agent-handoff-prompt.md) is for a replacement agent.
Historical plan paragraphs describe their original increments; later evidence
supersedes them only for the exact source, artifact, platform and scenario tested.

## Architecture

- Keep the Rust/Tauri root shell and existing Claude/Codex sessions working.
- New managed workspaces reuse the pinned T3 host, contracts and shared clients.
  The full desktop client is packaged Electron; iOS is Expo/React Native.
- Maintain one authoritative host/writer per managed thread. Preserve existing
  pairings, databases, drafts and provider session ownership during migration.
- Use Blackcrab-owned cloud, bundle IDs, app groups, update channels and domains.
  Source reuse does not authorize T3's production services or credentials.
- Keep changes to pinned upstream source in the appropriate patch/adapter
  registry, preserving hashes, original behavior, attribution and verification.
  Do not hand-edit vendor inventories or generated output to conceal a mismatch.

## Repository and Git

The main Mac checkout is `/Volumes/G-DRIVE PRO/Programming/blackcrab`.
It contains extensive pre-existing tracked and untracked parity work. Inspect
`git status`, the current branch, remotes and applicable instructions first.
Use a separate owned worktree for changes. Never reset, clean, switch the main
checkout, stage all its files, or delete untracked files to get a clean build.
Stage explicit reviewed paths; preserve unrelated dirty files and the main index.

The integration target is `stage`. Make one coherent change per PR, inspect its
final diff/reviews/checks and current base, then merge validated work into stage.
Read stacked PR bases before retargeting or merging; green child checks do not
integrate its draft parents. Do not bypass failed checks or native acceptance
gates. Release/TestFlight work is now explicitly requested; use the reviewed
source and existing release process rather than moving main or tags incidentally.

Do not add Co-Authored-By trailers naming Codex, Claude or another AI agent.
Do not describe an AI agent as an author in commits, PRs or release notes.
Do not add generated-by assistant footers.

## Toolchains and checks

- Root and mobile: Node 26.12.1, npm 12.2.2, committed npm lock.
- Pinned T3 producer source: pnpm 12.14.0 and its frozen upstream lock.
- Mobile: Expo 58.0.14, React Native 0.88.0, React 19.3.0, iOS floor 18.
  The root desktop renderer uses React 19.1; do not flatten the two graphs.
- Start with focused behavior tests and the relevant typecheck/build. Complete
  required CI. Do not rerun expensive native builds without a source change or
  unresolved acceptance question. Do not count an intentionally skipped fixture
  as accepted native behavior.
- Useful root commands: `npm run typecheck`, `npm test`,
  `npm run typecheck --workspaces --if-present`, `npm run smoke`.
  Check package scripts and CI for the exact scope before running them.

## Runtime and credentials

Default to fresh isolated QA data, test hosts and owned simulators. Never point
a probe at an existing T3/Blackcrab database, adopt a discovered PID as an owned
process, kill all matching apps, or replay an uncertain provider command.
Control only captured children and record cleanup. Prior native acceptance
used inert fixtures with zero provider runs; keep real provider evidence separate.

Keep secret values out of logs, assertions, reports, Git and chat. In particular,
do not deep-compare or print environment objects containing credentials.
Use the available private-secret mechanism when a credential is needed.
An unresolved Clerk rotation blocks cloud deployment; consult the current
handoff before using existing cloud configuration. Preserve the user's approved
budget and completed account authorizations; do not request them again blindly.

## Handoffs and continuity

Before context/token exhaustion, update docs/agent-handoff.md and the copyable
prompt with the active worktree/branch/head, exact next action, pending PRs,
tests, failures, artifact paths, blockers, user answers and process ownership.
State whether any build is actually running and how its original handle can be
resumed. A cancelled background command will not finish by itself.
Update both members of every changed AGENTS.md/CLAUDE.md pair identically.
Do not claim completion while native acceptance, cloud operation, installation
or TestFlight availability remains unverified.
