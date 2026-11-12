# Copyable continuation prompt

Continue the authorized Blackcrab/T3 parity task, prioritizing publication of Mac
0.4.0 and its website/blog/release notes. Read AGENTS.md and the latest checkpoint
in docs/agent-handoff.md first; it supersedes the historical native-capture hold.
The owner explicitly ordered publication and will test the Mac app afterward.
Do not ask for that approval again, do not wait for window capture, and do not
claim manual lifecycle/upgrade acceptance or full parity. Preserve required CI,
Developer ID/notary, payload and updater cryptographic verification.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
R=P/desktop-delivery-m6ki1jlt; active desktop checkout R/source, branch
parity/desktop-delivery-integration, PR #265 targeting stage. Read
R/integration-pr.json for exact latest head/CI/watch state; old head4547958 had
nine passed checks. Release 0.4.0 changes are prepared on this branch. Link any
PR immediately after push/create. When waiting on required PR checks, watch and
end the turn; do not poll. Merge only the validated final revision to stage.

REL=P/mac-release-040-v2llrqsa. Website checkout REL/website, repository
BonJenn/blackcrab-landing, branch release/0.4.0-website targeting main. Read
REL/plan.json for live PR/build/publication state and validation logs. Keep the
website announcement unmerged until the actual Mac v0.4.0 download is public.
Vercel project blackcrab-landing, team bonjenns-projects, www.blackcrab.app. This
is not the hosted agent app at app.blackcrab.app.

After final stage merge, create the source-bound OWNER_TESTING_AUTHORIZED record
using scripts/macos-release/release-inputs.mjs exports, no checks object. Pack
existing notarized payloads at
/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads/{desktop,service-host}.
Both production payloads are signed/notarized (20 desktop +17 service Mach-Os),
Developer ID Jonathan Benn / YF28W3NGG6. Evidence R/notary-ticket-audit.json and
R/notarized-resource-roundtrip.json. No source change requires rebuilding them.

Create draft v0.4.0 at exact merged stage SHA, upload fixed asset
blackcrab-managed-payloads.zip, dispatch release.yml managed-apple-silicon with
independent payload SHA. Keep draft until actual app/DMG, embedded archives and
updater cryptography pass. Then publish stable/latest; owner performs manual
installation/UI/upgrade tests. Existing signing secrets belong only in intended
workflow jobs; never export the updater private key. Release text is
R/source/docs/releases/v0.4.0.md; blog mirror docs/blog/2026-11-12-blackcrab-0.4.0.md.

Website changes include homepage/version, blog/changelog, release/download labels
and stable Windows/Linux fallback for Mac-only latest. Three download tests pass;
Next production build and scoped lint passed. Final TypeScript import issue was
fixed using a .mjs Node test. See REL validation reports, complete required preview
checks, merge/deploy only after Mac publication and verify the actual public links.

No normal outer app/DMG/updater is published or installed yet. No owned native
app/host/simulator is running. Preserve original child handles; never PID-adopt.
Preserve all main checkout changes/index and shared caches. The earlier blocked
CUA QA remains genuine unaccepted evidence, not a release gate for 0.4.0.

Mobile #266 merged stage49bedbd and is unwatched. TestFlight 1.0.0(4) is already
VALID/IN_BETA_TESTING; do not reupload. Current branded Hermes export is at
/private/tmp/blackcrab-ios-4AS02K/artifacts/shared-copy-export, runtime
2cbb84d9fbdb180f1af5bfe3e049108c47d628cb, SHA256
937094df9fef008f0cebf2ae66d6d1fe6a9f44eb25b70e8c7f51eb6d08bb9d44, NOT published.
Remaining mobile retention/reconnect/OTA/remote/APNs acceptance is separate.
Keep handoffs and each changed AGENTS.md/CLAUDE.md pair current and identical.
