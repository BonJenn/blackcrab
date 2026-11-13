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

- The managed Electron workspace is the only desktop UI. Root handles native startup,
  service recovery and signed updates; do not restore the retired Claude/Codex UI.
  Preserve existing user data on disk without starting the retired session server.
- New managed workspaces reuse the pinned T3 host, contracts and shared clients.
  The full desktop client is packaged Electron; iOS is Expo/React Native.
- Maintain one authoritative host/writer per managed thread. Preserve existing
  pairings, databases, drafts and provider session ownership during migration.
- Use Blackcrab-owned cloud, bundle IDs, app groups, update channels and domains.
  Source reuse does not authorize T3's production services or credentials.
- Keep changes to pinned upstream source in the appropriate patch/adapter
  registry, preserving hashes, original behavior, attribution and verification.
  Do not hand-edit vendor inventories or generated output to conceal a mismatch.

## Hosted-service model

The accepted commercial direction is documented in docs/hosted-service-plan.md:
free local/self-hosted software and paid Blackcrab-hosted remote access, starting
with an invite-only beta. Enforce access/quotas on the server; public endpoint URLs
are not secrets or proof of payment. Billing and public signup remain planned
release gates. Preserve the current owner Mac/TestFlight delivery priority.

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
The user explicitly authorized using the existing cloud credentials on
2026-11-12, superseding the earlier Clerk rotation hold. Use them privately
within the approved budget. Preserve completed account authorizations; do not
request them again blindly.

## Handoffs and continuity

Before context/token exhaustion, update docs/agent-handoff.md and the copyable
prompt with the active worktree/branch/head, exact next action, pending PRs,
tests, failures, artifact paths, blockers, user answers and process ownership.
State whether any build is actually running and how its original handle can be
resumed. A cancelled background command will not finish by itself.
Update both members of every changed AGENTS.md/CLAUDE.md pair identically.
Do not claim completion while native acceptance, cloud operation, installation
or TestFlight availability remains unverified.

## Explicit v0.4.0 publication instruction — 2026-11-12

The owner said: "publish the mac release and ill test it myself. this will be
version 0.4" and requested the website, blog and release notes workflow too.
This supersedes the earlier requirement to wait for native window capture before
merging/publishing v0.4.0. Record OWNER_TESTING_AUTHORIZED for that exact release
and source, never PASSED. The owner will perform UI/lifecycle and upgrade testing
after publication. Keep signing, notarization, payload integrity and updater
signature checks. Publish the verified Apple-silicon release and then update the
website to its real downloads. No additional publication confirmation is needed.


## Tauri release compatibility

Keep the root @tauri-apps/api and plugin npm versions on the same major/minor
lines as their Rust crates in src-tauri/Cargo.lock. These npm dependencies are
exact-pinned after broad caret ranges drifted and blocked the 0.4.0 native release.
Run npm run check:tauri-versions when either lockfile changes. The guard runs in
CI and before release payload processing; do not disable Tauri's version check.
Change npm/Rust pairs together when upgrading, and validate actual native packaging.


## Published Mac 0.4.0 baseline

Mac v0.4.0 is public at caf57b6fab1b4391836c6635882a15a88edfac0d. Its signed and
notarized artifacts and existing-key updater verification passed. The website
publication and real download buttons also passed. Preserve the public tag and
release assets; future fixes need a new version. Publication does not establish
manual Mac installation/UI/service/upgrade acceptance or full parity. Start at
the latest docs/agent-handoff.md checkpoint; older checkpoints are historical.

## Current Mac startup investigation

For the owner's disabled Full desktop in verified 0.4.0, read
`docs/desktop-startup-040-diagnosis.md` before asking for diagnostics. All 19
owner-reported file/cache/lock checks passed and a full restart did not help.
One unavailable line points toward notBundled. Only native status should decide
whether a desktop package is bundled; a JavaScript runtime marker is not package
metadata. Preserve the distinction between a reproduced client misclassification
and confirmation of the owner's actual failure. Do not delete/repair data from
speculation or claim that unit tests establish GUI acceptance.

## 0.4.1 corrective delivery

The owner is testing the published 0.4 release and reported a disabled Full
desktop entry. PR270's corrected native-status query and startup diagnostics
merged to stage 1af8e72562afda52d0891c64d666d2be914d360a after nine passing checks.
The single 0.4.1 follow-up continues that delivery/test workflow. Its
OWNER_TESTING_AUTHORIZED record must name followUpOf v0.4.0 and
followUpSourceRevision caf57b6fab1b4391836c6635882a15a88edfac0d, as well as the
exact NEW source revision and all deferred lifecycle checks. This is not a new
claim of passing native acceptance or a blanket exception for future versions.
Signing, notarization, payload verification and updater verification remain
mandatory. Preserve public 0.4.0 assets; release notes must call the work-Mac
resolution unconfirmed until the owner actually opens the new desktop.

## Published 0.4.1 correction

Mac 0.4.1 is published from 62ef3868d65252ba062bbee0200d6cb74a27ea6f. Actual
signed/notarized installer, payload and updater checks passed; website notes and
real platform download redirects were verified. Preserve its public tag/assets.
The owner still needs to confirm Full desktop on their work Mac; publication is
not runtime acceptance or full parity. Read the current handoff checkpoint before
its explicitly historical sections, and do not restart old build handles.

## 0.4.1 signed-helper startup defect

The owner failure is now reproduced. Read the current handoff before historical
startup notes. A signed app executable cannot simply be copied as a standalone
service issuer: its external signed Info.plist is lost and macOS kills it. Use
the separately built/signed/notarized CLI helper embedded in Root. Preserve
existing service configuration/generation during an explicitly stopped upgrade.
Signature verification, real helper readiness and actual app UI acceptance are
different checks; do not label the whole delivery complete from the first two.


## Draft installer validation

A source-bound DRAFT_VALIDATION_PENDING record permits an explicit --draft-build
only. The workflow must independently confirm the release is a draft and leave it
a draft. Build the actual signed/notarized installer, then validate native UI and
service lifecycle; pending evidence is never acceptance or public publication
permission. Default validateAcceptance rejects it. Do not extend old owner-testing
exceptions or invent successful lifecycle checks to build a candidate.

## Sole desktop interface — owner instruction, 2026-11-12

The owner explicitly requested: "remove the older interface entirely. we are
building from the new interfact from now on". This supersedes earlier guidance
to retain legacy renderer views. Launch the managed workspace automatically.
Keep only a small startup/recovery surface in Root, hide it after native
activation, and preserve service/workspace identity. Do not treat a button to
open a second interface as completion. Update onboarding/environment/account
copy and logos through the pinned producer patches, retaining upstream notices.
The first signed 0.4.2 candidate passed package verification and opened the real
workspace, but is a private draft superseded by this UX instruction. Rebuild and
validate the new source before publishing; do not publish the earlier candidate.

## Renewed 0.4.2 publication instruction — 2026-11-13

After testing the working private workspace and requesting branding/picker/pane
polish, the owner explicitly said: "you have plenty of usage get this published".
Publish the verified 0.4.2 follow-up with OWNER_TESTING_AUTHORIZED, that exact
authorization, the final source, followUpOf v0.4.1 and followUpSourceRevision
62ef3868d65252ba062bbee0200d6cb74a27ea6f. Keep lifecycle checks deferred unless
actually completed; never substitute PASSED. This current instruction supersedes
the earlier 0.4.2 publication hold. Signing, notarization, payload inventories and
updater cryptographic verification remain mandatory. It does not authorize later
versions or certify full parity. Retain the current production service artifact:
the separate host-copy branch needs a data-preserving manifest upgrade before
changing the installed service. Publish website notes only after the installer.
