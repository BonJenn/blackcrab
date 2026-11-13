# Copyable continuation prompt

Continue the authorized Mac 0.4.0 release, website, blog and release notes. Read
AGENTS.md and the latest docs/agent-handoff.md checkpoint. The owner will test UI,
service lifecycle and upgrade behavior AFTER publication; do not restore capture
or approval gates. Still verify actual signatures/notarization/updater/payloads.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes;
REL=P/mac-release-040-v2llrqsa. Read REL/plan.json and REL/notary-auth-fix-pr.json.
Active checkout REL/notary-auth-fix, branch release/0.4.0-notarization-auth.
PR267 already merged to stage cbf167200b740fab7fc34bb125b99dd95bf3c826 and unwatched.
Its npm/Rust version fix worked: run 43333392902 compiled and signed 0.4.0, but
notarization failed HTTP 401. API preflight passed; Tauri preferred the stale Apple
ID/password also supplied. Monitor 38476 is settled. No app or service is running.

The new managed wrapper selects complete API credentials and REMOVES Apple
ID/password from its child env (empty values still trigger Tauri's priority).
Complete Apple ID-only config is supported. Five new tests pass; combined focused
suite 33 pass / 3 opt-in skips. No native code or dependency graph changed. Finish
PR/link/checks/review/merge to stage. For required PR waits watch and end, no polling.

After merge prepare a NEW exact-source OWNER_TESTING_AUTHORIZED ZIP and update
the owned draft v0.4.0 target/input/hash, then dispatch corrected release.yml.
Do not rerun old 43333392902 or reuse its source-bound ZIP. Signed/notarized inner
payloads are unchanged at /private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads/{desktop,service-host}.
The root's unchanged updater key/verifier are at REL/updater-verifier.
Update SOURCE/workflow ID in REL/verify-final-artifacts.py and sourceRevision in
REL/artifact-verification-plan.json, then verify actual release assets. The script
only downloads/verifies/read-only mounts, never launches or installs. Do not
claim its prepared checks passed. Publish GitHub stable/latest only after success.

Then merge website PR12 https://github.com/BonJenn/blackcrab-landing/pull/12,
checkout REL/website, head 45074e77ae990e71983a0d0f657461bed76eca03. Tests/types/lint/
build and Vercel checks passed. It stays draft pending actual Mac release. Use
existing blackcrab-landing Vercel project/team bonjenns-projects for www.blackcrab.app
(not hosted app.blackcrab.app). Verify home/blog/changelog/releases and actual Mac
download plus previous-platform fallback. All preview tabs/access links are closed.

Do not touch main dirty checkout/index, shared caches or installed app incidentally.
TestFlight 1.0.0 (4) is available; newer branded mobile export is unpublished and
remote/APNs/retention acceptance still remains. Full parity is not complete.
Keep handoffs and all changed AGENTS/CLAUDE pairs current and byte-identical.
