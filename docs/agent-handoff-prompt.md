# Copyable continuation prompt

Paste the following into the replacement agent. Keep the handoff document
alongside it; local evidence paths may not survive on another machine.

---

Continue the Blackcrab/T3 parity and delivery task; do not restart the project.
First read AGENTS.md (CLAUDE.md is identical), docs/agent-handoff.md,
docs/t3-parity-plan.md, docs/t3-parity-ledger.md, and the guides in the
directories you edit. Recheck mutable state; the handoff is a dated checkpoint.

The user wants Blackcrab to have all applicable functionality of their
BonJenn/t3code fork at commit 7f02de2eb8e253e0ec23f005b3cfff8e2c963be8,
including full remote iOS agent control. The finish line is validated parity,
a current normal Mac app installed on their computer, and an app available to
them in TestFlight. They authorized coherent PRs merged into stage and asked
to continue until done. Passing CI or importing source is not completion.

Primary checkout: /Volumes/G-DRIVE PRO/Programming/blackcrab. It has extensive
pre-existing dirty work. Preserve all of it and its index; use an owned separate
worktree. Evidence root:
/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
Read combined-parity-_s49gx2k/integration-plan.json for local evidence, but older
keys can be stale; prefer the dated handoff, latest specific result and GitHub.
Do not adopt PIDs, kill unrelated apps, touch live user databases, or overwrite
accepted artifacts. No heavy build/native fixture was active at the checkpoint.

Known source state: stage f69c62951e868d69a13ed0712f2e4fb448538638.
PR #215 head b4edea278ee710a3de6bdb9fd9778cd722cb8a8a has all nine CI checks
passing and no conflicts/reviews, but is draft awaiting current bundled Root
launch/reuse/quit/reattach acceptance. Its watch was stopped. See the handoff
for the desktop #223–251 and service #217–237 dependency chains; do not merge
all parents just because a child is green. Preserve the Effect callback fix,
strict owned links, composer fix and #260 queued-stop timer cleanup.

Many mobile/cloud increments through #260 are merged. Exact simulator/native
evidence covers bounded metadata, recovery, revocation and populated legacy
upgrade cases without provider runs. It does not prove all current-stage
provider/workspace/off-LAN/physical-device flows. Complete the remaining ledger.

Native UI automation still returned cgWindowNotFound for Finder and the recent
Root QA app. Recheck access, but do not falsely substitute API calls for original
UI acceptance. Old QA apps in the repo are not the latest installed build.

Cloud: blackcrab.app is owned; public delegation now uses Cloudflare's beau and
khloe nameservers. Vercel/Clerk/Cloudflare/R2/Axiom authorizations were completed.
Do not ask for those again blindly. Budget: at most $30/month base plus metered;
reviewed small database/Workers quote approximately $20/month. Deployment is
blocked by rotation/revocation of the previously exposed production Clerk key.
The user most recently said they will do that later. Respect that deferral;
continue independent work and request the replacement only through private input
when they are ready. Never log environments/secrets or publish credentials.

Release: Node 26.12.1, npm 12.2.2; upstream producers pnpm 12.14.0. Mobile is
Expo58/RN0.88/React19.3 with iOS18 minimum; root React is19.1. Existing iOS
helper builds an arm64 simulator Release, not a TestFlight device archive.
Personal Apple team YF28W3NGG6 has a local Developer ID identity; no Blackcrab
iOS distribution profile was found. Do not use an unrelated organization's
distribution identity. Expo state is signed in as bonjenn. GitHub already has
Apple API/signing and Tauri updater secret names configured. Check available
access before asking for credentials; never export secret values for diagnosis.

Immediate work: finish paired guidance PR #261/checkpoint if pending, implement
and validate device archive/export/TestFlight delivery, reconcile and validate
the current desktop/service stack, finish real workflows and owned cloud access
once the Clerk blocker clears, then install the Mac build and confirm processed
TestFlight tester availability. Follow current tool instructions for PR linking,
watching and handoff. No unasked new top-level threads or replacement goals.

Keep AGENTS.md and CLAUDE.md byte-identical within every important directory.
Before context/token exhaustion, update docs/agent-handoff.md and this prompt
with current PR/head/checks, worktree, artifact evidence, live handles, blockers
and the exact next action. Continue concrete work rather than responding with
only a plan or an offer to continue.
