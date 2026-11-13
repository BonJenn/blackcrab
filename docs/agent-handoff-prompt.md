# Copyable continuation prompt

Continue fixing Blackcrab 0.4.1 Full desktop and the original desktop/mobile parity task.
Read AGENTS.md and the CURRENT checkpoint in docs/agent-handoff.md first.
The owner confirmed 0.4.1 still fails; do not repeat the old integrity checks or claim
that publishing 0.4.1 resolved it. Native UI reproduced Open failing after Refresh.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Work in REL/desktop-launch-041-fix, branch fix/native-desktop-launch-041, base
0606456e2d9cb3274901266e5b89d6d70ad34047. Read REL/desktop-launch-041-diagnosis/plan.json
for current handles, results and PR. Never redispatch an already completed command.

Concrete cause: the service helper was copied from the signed Root app binary,
but macOS rejects it outside the app bundle: invalid Info.plist and exit SIGKILL.
The candidate builds/signs/notarizes a dedicated standalone helper and embeds its
bytes into Root before signing Root. It also upgrades an inactive service helper
without changing workspace config/generation, preserves actionable native errors,
and adds a primary Full desktop toolbar entry. Its standalone signature/argument
execution and the corrected fresh native readiness/upgrade regression passed;
see standalone-acceptance-result.json. Production helper notarization and actual
Root UI/service lifecycle validation remain. Final local checks passed: 34 native
unit tests, 16 Node tests (3 explicit opt-in skips), 12 focused renderer tests,
TypeScript and production web build. No build/test handles remain active.
Commit/create the PR if not yet recorded in plan.json; inspect CI/reviews and merge
validated work, then build and verify the corrective release. Actual full-window/service lifecycle acceptance is still needed.

The diagnostic service is stopped and its unloaded LaunchAgent archived outside
LaunchAgents; workspace data is retained. See service-test-cleanup.json. CUA was
working but last returned cgWindowNotFound; this is not proof of application exit.
Do not adopt/kill discovered PIDs, delete user data, weaken package verification,
or modify the dirty main checkout/index. Keep paired AGENTS/CLAUDE files identical.

Preserve published v0.4.0 and v0.4.1 assets and current site downloads until a new
verified release is ready. User authorized publishing fixes and testing afterward;
do not invent passed native acceptance. Remaining finish line includes real desktop
agent workflows and mobile/hosted remote acceptance. TestFlight 1.0.0 (4) is already
available. Continue existing cloud authorization/budget; do not request them again.

For PR waits: push/link, watch and end the turn. On wake inspect current head,
checks/reviews and merge only validated work into stage; unwatch before handback.
