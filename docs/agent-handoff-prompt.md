# Copyable continuation prompt

Prepare and deliver the 0.4.1 corrective Mac patch from REL/desktop-patch-041,
branch release/0.4.1-desktop-startup. Read REL/desktop-patch-041-plan.json for
current PR/head and docs/agent-handoff.md for the new checkpoint. PR270 merged
with nine passing checks to stage 1af8e72562afda52d0891c64d666d2be914d360a and
was unwatched. The older investigation details below remain evidence, not an
instruction to reopen that PR. No patch build/publication has occurred yet.
Version and release-input changes are preparation; full native/UI acceptance is
still deferred to the owner's 0.4 delivery test, explicitly recorded as such.
Reuse unchanged notarized payloads and preserve signature/updater checks. Never
overwrite public v0.4.0; never label the owner failure fixed until verified.

Continue Blackcrab/T3 parity from the PUBLISHED Mac 0.4.0 release. Read AGENTS.md,
docs/agent-handoff.md (current checkpoint first), the parity plan and ledger.
The owner authorized publication before their manual Mac UI/service/upgrade tests.
Do not repeat release setup or claim full parity/manual acceptance/installation.

Latest owner feedback: Full desktop is disabled before clicking, with ONE
unavailable line. Command-Q/reopen did not help. Their executable and both
resource archives match the public 0.4.0 hashes; all 19 cache/lock/path checks in
the pinned read-only report passed. Filesystem ownership was unknown due to a
report bug, now corrected and validated locally. The Background service Enable
button was reported visible. Do not request another reinstall or repeated checks.

Read docs/desktop-startup-040-diagnosis.md. Active PR270 targets stage from
fix/desktop-bundle-startup, checkout REL/desktop-startup-fix. The client previously
returned notBundled without querying native code when isTauri() was false. It
now asks native status directly; old-client regressions fail and corrected tests
pass. This does NOT yet confirm why the owner's actual app is unavailable.
Native startup errors now identify the failing cache/filesystem/lock operation,
without printing paths or contents or weakening verification. Native capture
again fails for Finder; no actual released app was launched in this investigation.
Check REL/desktop-startup-fix-plan.json for latest head/CI/handles, then finish
review/merge and deliver a verified new patch artifact. Verify ordinary launch;
do not call the candidate correction a confirmed owner fix or full parity.
The 89bb45e CI failure was three unscoped workspace test alerts reading the
sibling desktop error. The test-only correction scopes assertions and preserves
both errors. Full frontend validation now passes 186 tests, TypeScript and Vite;
wait for required CI on the new head rather than using older successes.

Public release: https://github.com/BonJenn/blackcrab/releases/tag/v0.4.0
Source/tag: caf57b6fab1b4391836c6635882a15a88edfac0d, after merged PR267/268,
each with nine passed checks. Workflow 43337173131 succeeded. Actual app/DMG
signatures, notarization, payload inventories and compiled pins passed. Updater
cryptography verifies with the existing v0.3.0 key; read-only installer contents
exactly match the updater app. Never overwrite or retarget the public v0.4.0 tag.

Website PR12 merged to ff4c3442a53dc446a4a126ca9df79654b509571a and deployed to
www.blackcrab.app (Vercel blackcrab-landing, bonjenns-projects). Live home/blog/
changelog/releases and actual Mac 0.4 / Windows 0.3 / Linux 0.3 downloads were verified.
The initial stale Mac redirect revalidated naturally; account for five-minute
website data caching during future releases. This is separate from app.blackcrab.app.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
REL=P/mac-release-040-v2llrqsa. Read REL/plan.json, artifact-verification result
at REL/final-artifact-verification-cr8kp25e/result.json and
REL/website-publication-verification.json. Release checkout REL/notary-auth-fix
stays clean at the public source. Publication handoff PR269 merged to stage 39e2c7f and was unwatched.
Current PR270 state is in REL/desktop-startup-fix-plan.json. Its de86fe44 head
passed nine checks; newer changes need current-head CI, not those stale results.
For PR waits, watch and end rather than polling. Keep guides paired identically.

All local build handles are settled; no owned app/service/simulator/mount/browser
is running. The main dirty checkout/index/shared caches and installed
/Applications/Blackcrab.app were untouched. The owner has verified the 0.4.0 installation on their work Mac, but full
desktop remains disabled. Record actual results for first launch, service enable/start, full
desktop open/reuse, quit/reopen, restart, stop/start and retained data. See
REL/OWNER-TESTING.md and Settings → Background service / Full desktop. Preserve
all existing sessions, catalogs, credentials and pairings when investigating.

TestFlight 1.0.0 (4) is already available. Do not reupload it. Newer branded export
is not published. Mobile retention/reconnect/OTA, off-LAN remote control, APNs,
hosted billing/signup and owned policy publication remain broader-plan work.
Finish line: validated parity, normal Mac installation and owner TestFlight
availability, not merely merged code or a public release. User authorized existing
cloud keys and the smaller backend budget; don't request those approvals again.
