Continue Blackcrab parity and the authorized 0.4.4 release for Mac, Windows and Linux.
Read AGENTS.md and the CURRENT checkpoint in docs/agent-handoff.md first. Preserve
the dirty main checkout and paired AGENTS.md/CLAUDE.md files. The user wants mobile
updates delivered to TestFlight first, then desktop 0.4.4 on all three platforms.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
D=P/mobile-testflight-polish-xn2t7paa. Read D/plan.json, build-report.json and
apple-submission-result.json before acting. Source 93edbe827fb52c4011cbbe52d5b954dc5de15111
includes merged/unwatched PR292/293. The standalone signed 1.0.0 (5) IPA is BUILT,
with all three target identities/entitlements/signatures verified; actual Hermes
contains Blackcrab Account/Connect, zero T3 Account/Connect labels and the retained
hosts label. IPA SHA256 38759e70456df516bdd285d383fd88a51110add4b32dbfa2a437258411e18e77,
path /private/tmp/blackcrab-ios-Zgmgz1/artifacts/export/BlackcrabRemote.ipa.
Completed archive session 78178 must NOT restart. Correct existing Apple app 6780360079,
bundle dev.blackcrab.remote, team Jonathan Benn/YF28W3NGG6. No new account/app/project.

ACTIVE: D/submit-testflight.mjs, captured exec session 75457. Apple validation passed;
Apple acknowledged UPLOAD SUCCEEDED at 01:59:33 UTC, delivery UUID
8e31043e-b547-4264-9c27-d312772e7bdc. The uploader --wait process is still active;
resume that handle rather than submitting again or adopting a PID.
D/verify-and-deliver.cjs returned WAITING_FOR_APPLE_PROCESSING at 02:02:24 UTC,
build 5 not yet listed. Re-run it to verify VALID processing, the existing release group,
owner tester membership and IN_BETA_TESTING. An upload alone is not availability.
No OTA was published. Installed retention, haptics and real login are separate
acceptance; do not claim them from a build/TestFlight report. Preserve build 4.

Clerk Native API/native iOS registration/redirect and Apple/GitHub sign-up/sign-in
are configured. Actual login acceptance is pending. Verify Jonathan Benn/YF28W3NGG6
before Apple mutations; a previously selected wrong team was corrected without
mutating it. Private keys remain outside Git/chat/logs. Google is explicitly owner-
deferred; do not repeat the request or enable it with unconfigured credentials.

Desktop preparation: P/desktop-portable-packaging-044, branch
feat/portable-desktop-packaging, commit f74fce06d16e0ad81877afe354c85f53f20b3340.
New runtime staging module uses pinned archives and native platform layouts; the
Mac producer calls it. New native CI executes isolated Windows/Linux Electron
Node-mode probes. Producer gates remain disabled for those unfinished platforms.
90 managed-desktop tests and 11 QA recipe tests passed; six focused tests passed
after final cleanup handling. Actual three-platform archive/layout checks passed.
No Windows/Linux workspace, service or installer acceptance is claimed. The branch
is being submitted for CI while Apple processes the received upload. Read
P/desktop-portable-packaging-044-plan.json for exact PR/head/watch state. On the
CI wake, first finish TestFlight delivery if processed, then review/merge the
runtime PR; do not poll CI. Continue actual metadata/dependency/manifests, launch/transport/service
and native installer work before enabling/publishing Windows/Linux.

Updater PR290 is merged. Mac 0.4.3 and Windows/Linux 0.3.0 remain public; no 0.4.4 has
shipped. Older 0.4.2/0.4.3 workspace controls cannot reliably deliver the fix; include
a one-time manual download/app replacement instruction with the eventual 0.4.4
website/release notes, preserving app data. Keep the production Mac service manifest
c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83 until an explicitly
stopped, data-preserving upgrade. Native signing/updater checks remain required.
Publication is already authorized; do not ask for routine confirmation again.

The user requested an independent NEW website redesign session, already running:
<t3-thread://v2/95c98c5c-276e-4ac8-b422-c5d8447bafe7/mcp:launch:52c478392d53de435662458de3e6d1957fa5cc9fe7cdab0af947fe25ae477d77>.
Read P/website-redesign-session.json. Project root is
/Volumes/G-DRIVE PRO/Programming/blackcrab-landing; separate worktree is
/Users/jonathanbenn/.t3/worktrees/blackcrab-landing/design-blackcrab-product-site.
Do not duplicate or overwrite its design work. Keep any new release-version
information coordinated with that session. Original app work remains active.

Finish with real delivered builds, full parity and current handoffs, not just green
PRs. Full two-computer+iOS off-LAN control/revocation/push and hosted beta entitlements
remain separate from the completed source/import/account setup. Refresh this prompt
and the handoff as delivery/active-handle status changes.
