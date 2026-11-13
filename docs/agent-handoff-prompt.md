# Copyable continuation prompt

Continue Blackcrab/T3 parity from the PUBLISHED Mac 0.4.0 release. Read AGENTS.md,
docs/agent-handoff.md (current checkpoint first), the parity plan and ledger.
The owner authorized publication before their manual Mac UI/service/upgrade tests.
Do not repeat release setup or claim full parity/manual acceptance/installation.

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
stays clean at the public source. Current documentation work is in
REL/post-release-handoff, branch docs/0.4.0-published-handoff; its private
post-release-handoff-pr.json records any pending PR/CI. Finish that PR as needed.
For PR waits, watch and end rather than polling. Keep guides paired identically.

All local build handles are settled; no owned app/service/simulator/mount/browser
is running. The main dirty checkout/index/shared caches and installed
/Applications/Blackcrab.app were untouched. The owner will install/update on their
work Mac. Record actual results for first launch, service enable/start, full
desktop open/reuse, quit/reopen, restart, stop/start and retained data. See
REL/OWNER-TESTING.md and Settings → Background service / Full desktop. Preserve
all existing sessions, catalogs, credentials and pairings when investigating.

TestFlight 1.0.0 (4) is already available. Do not reupload it. Newer branded export
is not published. Mobile retention/reconnect/OTA, off-LAN remote control, APNs,
hosted billing/signup and owned policy publication remain broader-plan work.
Finish line: validated parity, normal Mac installation and owner TestFlight
availability, not merely merged code or a public release. User authorized existing
cloud keys and the smaller backend budget; don't request those approvals again.
