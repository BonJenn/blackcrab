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
accepted artifacts. No native compile/export is running. The device archive
passed; corrected export failed on Apple's App Groups API authorization.
Read the handoff for the reusable archive, exact reports and pending owner action.

Known source state: stage b512cc0ab53d1302694c0bf2965cd4b798f7dcb4.
Current release worktree: evidence root/ios-device-release-102m5jw4/source,
branch parity/ios-device-release, with the release helper/configuration changes.
Its parent directory's release-pr.json records publication when available;
recheck the actual PR head/checks and preserve the native signing acceptance gate.
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
reviewed small database/Workers quote approximately $20/month. On 2026-11-12
the user explicitly instructed using the existing credentials, superseding the
earlier Clerk rotation hold. Continue deployment with the private stored keys.
Never log environments/secrets or publish credentials. Existing intended Apple
team push credentials were also linked/configured privately; no APNs delivery
proof or new key creation is asserted.

Release: Node 26.12.1, npm 12.2.2; upstream producers pnpm 12.14.0. Mobile is
Expo58/RN0.88/React19.3 with iOS18 minimum; root React is19.1. Existing iOS
helper now adds explicit iphoneos archive/export; 19 helper tests pass.
Existing Apple team YF28W3NGG6, distribution certificate and submission API key
were verified through the user's EAS account. App Store app 6780360079 and Expo
project @bonjenn/blackcrab-remote already exist. Build 4 compiled successfully.
The first unsigned-archive export silently stripped capabilities: DO NOT upload
that IPA. The corrected helper preserves generated entitlements before automatic
signing and verifies every capability afterward. Its export is blocked by the
App Group association; the owner was asked to link group.dev.blackcrab.remote to
all three bundle IDs. Other capabilities are enabled and verified. Apple's App
Groups lookup returns 401 with the current API key; cached Apple login is invalid.
Automatic export may still need a valid Apple ID session or explicit profiles
after linking. Existing keys remain authorized. No new TestFlight upload is
asserted. Read the handoff for private signing paths; never print their contents.

Cloud source typecheck and 324 tests pass; hosted app is staged READY on Vercel
with no aliases promoted. Relay/database are not operational: PlanetScale
requires the owner's billing verification, and Cloudflare needs the additional
account_api_tokens:create permission. Both owner questions were asked; the
five-minute Cloudflare request expired unapproved. Existing keys ARE authorized;
key rotation is not a prerequisite. Continue independent release work.

PR #261 is merged to stage at b512cc0. Immediate work: implement
and validate device archive/export/TestFlight delivery, reconcile and validate
the current desktop/service stack, finish real workflows and owned cloud access
using the authorized existing keys, then install the Mac build and confirm processed
TestFlight tester availability. Follow current tool instructions for PR linking,
watching and handoff. No unasked new top-level threads or replacement goals.

Keep AGENTS.md and CLAUDE.md byte-identical within every important directory.
Before context/token exhaustion, update docs/agent-handoff.md and this prompt
with current PR/head/checks, worktree, artifact evidence, live handles, blockers
and the exact next action. Continue concrete work rather than responding with
only a plan or an offer to continue.
