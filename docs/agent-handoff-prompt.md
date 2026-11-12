# Copyable continuation prompt

Continue the authorized Mac 0.4.0 release and website publication. Read AGENTS.md
and the latest docs/agent-handoff.md checkpoint before acting. The owner will test
Mac UI/service/upgrade behavior after publication; no extra publication approval
or native capture is required. Keep signing/notary/payload/updater checks and do
not claim full parity or passing manual acceptance.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
REL=P/mac-release-040-v2llrqsa. Active checkout REL/tauri-version-fix, branch
release/0.4.0-tauri-version-alignment. Read REL/tauri-fix-pr.json for exact head/PR/CI
and REL/plan.json for current command handles/release state.

PR #265 already merged after nine passed checks to stage 2dee535dce3398d360c61f729f6890cd864f4a15.
Draft v0.4.0 targets that source but is NOT PUBLIC. Release run 43328470434 failed
before compilation on six npm/Rust Tauri version mismatches. Signing credentials,
notarized payloads and keychain setup passed. Watcher 89307 settled; do not rerun it.

Fix: exact npm pins api 2.11.1, opener 2.5.4, notification 2.3.3, updater 2.10.1,
dialog 2.7.1, process 2.3.1; Rust lock and unrelated resolutions unchanged. New
check-tauri-versions guard in CI/release/native packaging catches the original
failed lock and passes corrected lock. Portable tests 28 pass / 3 opt-in skips;
actionlint passes; fresh owned npm ci passed. Root TypeScript/Vite build and actual Tauri CLI info passed without package
mismatches; all local validation handles are settled. Read REL/plan.json for the
latest PR and release state. Finish correction PR, link next
after push/create, pass required CI and merge stage. For PR waits, watch and end;
never poll or bypass failed checks.

After merge: clean corrected stage source; NEW exact-source OWNER_TESTING_AUTHORIZED
record and release-input archive under REL/release-inputs-<source>. Original
REL/release-inputs zip is bound to failed 2dee535 and must not be reused. Reuse
unchanged notarized inner payloads:
/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads/{desktop,service-host}.
Update the owned DRAFT v0.4.0 target and replace its input zip/hash, then dispatch
release.yml managed-apple-silicon with the new hash at corrected stage. Verify
actual app/DMG/updater and publish stable/latest only when artifact checks pass.
See REL/artifact-verification-plan.json and REL/updater-verifier. Existing public
key matches v0.3.0; no real 0.4 updater verification yet. Never export private keys.

Website PR #12 https://github.com/BonJenn/blackcrab-landing/pull/12 is draft until
Mac artifacts are public. Checkout REL/website, head 45074e77ae990e71983a0d0f657461bed76eca03.
Local tests/types/lint/build passed; home/blog/changelog preview inspected before
metadata-only follow-up. Merge/deploy to blackcrab-landing Vercel project on
bonjenns-projects, www.blackcrab.app; verify public pages and actual Mac download,
plus prior Windows/Linux fallback. Hosted agent app at app.blackcrab.app is separate.
Browser tab closed and temporary access revoked.

No public 0.4, normal app installation, or local native app/host/simulator is running.
Keep main checkout/index/shared caches unchanged. Keep handoffs and changed guide
pairs identical. TestFlight 1.0.0 (4) is available; newer branded Hermes export remains
unpublished. Mobile retention/remote/APNs acceptance and complete parity remain.
