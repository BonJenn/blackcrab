# Copyable continuation prompt

Continue the Blackcrab desktop startup fix and original desktop/mobile parity task.
Read AGENTS.md and the CURRENT checkpoint in docs/agent-handoff.md. The owner still
cannot use Full desktop in published 0.4.1. Do not call that release fixed.

PR273 is merged/unwatched at stage 8aaa56fd9b0d34d3bd433c1d0d07e088c77db3bf, with
nine passing checks. It corrects the copied app-executable service helper that
macOS killed for invalid Info.plist, keeps setup errors actionable, and adds a
primary Full desktop button. Real standalone signed-helper readiness/upgrade tests
passed; actual final Root/service/desktop lifecycle acceptance remains.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Active worktree: REL/desktop-patch-042, branch release/0.4.2-service-startup.
Read REL/desktop-patch-042-plan.json for exact PR/head/handles. No build/test is
currently running. Never restart old completed background commands.

Finish/merge the 0.4.2 preparation PR; then prepare its exact stage source and the
existing verified notarized payloads for a DRAFT release. New --draft-build accepts
source-bound DRAFT_VALIDATION_PENDING evidence without claiming GUI success. The
workflow independently verifies isDraft and stays draft; default acceptance
validation still rejects this state. Do not extend historical owner-testing
exceptions or fabricate acceptance. Build via the existing workflow, verify the
actual signed/notarized helper/Root/DMG/updater, test normal service startup and
Full desktop launch/reuse/quit/reopen/upgrade, then publish and update the website.

The diagnostic service is stopped and its unloaded LaunchAgent archived; workspace
configuration is retained. Last CUA capture failed; retry current UI, never adopt
PIDs or delete user data. Preserve the dirty main checkout/index, public 0.4.0/0.4.1
artifacts, updater identity and paired AGENTS.md/CLAUDE.md files. TestFlight 1.0.0 (4)
is available; remaining mobile/hosted runtime acceptance and commercial-service
work are still part of the goal. Current credentials/budget remain authorized.

For pending PR checks, push/link then watch and end. On wake inspect exact head,
checks/reviews before merging into stage; unwatch before handing back.
