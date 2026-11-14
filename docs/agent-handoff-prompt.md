Continue Blackcrab parity and the authorized 0.4.4 release for Mac, Windows and Linux.
Read AGENTS.md, the latest docs/agent-handoff.md checkpoint, docs/desktop-updates.md,
docs/mobile-cloud-configuration.md and docs/cross-platform-workspace-delivery.md.
Preserve the extensively dirty main checkout. Use only owned worktrees.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
Mobile account recovery PR291 merged to stage at
0b305bc3079b0568370f3c0836f2a4c3f48331bb after nine passing checks; it is unwatched.
Current worktree: P/mobile-account-recovery-e49g7nr9/source, branch
fix/native-account-preflight-shape. Read parent plan.json for the checker-fix PR.
Production Clerk Native API is now ENABLED through the owner's Vercel-linked
workspace, and the live native environment returns HTTP 200 / native_environment_ready.
Do not ask the owner to enable it again. The checker was corrected to match the
actual auth_config/user_settings response without an object discriminator; its
four focused tests pass. Native account login, redirect/associated-app setup as
needed, and full Connect acceptance remain separate. The handoff records the
correct Marketplace app/production IDs and SSO command; do not create a duplicate
app or print keys. No new account authorization was necessary.

Mobile account/Connect entry points stay tappable, time out to useful recovery,
and retain the original auth/storage owners. The physical source passed full
mobile types and 94 experience/activation tests. Its source-bound Hermes export
at /private/tmp/blackcrab-ios-yP6Wlk/artifacts/account-export contains the recovery
UI and no T3 Account/account/Connect strings. Runtime 2cbb84d9fbdb180f1af5bfe3e049108c47d628cb
matches TestFlight 1.0.0 (4). Read account-export-result.json and bundle-audit.json.
This export is NOT published. Validate installed OTA retention/reconnect, then
publish through the owned production channel; do not fake runtime compatibility.
The older branding-only export is superseded. No local process remains running.

Updater PR290 merged to stage at a2d753a5e0a37dc7954902d9bede6ff82660b95f after
all nine checks passed on e20672a773960580bc4757dcf9c3d449c6479f6e. The actual Chromium
notification regression passed in run 43526316952/job 132232854479. PR290 is
unwatched; do not re-create, link or poll it. Its completed producer/validation is
P/mac-release-040-v2llrqsa/workspace-044-validation; do not repeat preparation.
PR291 also merged and integrates that stage change; preserve both handoffs.

The updater connects the Electron workspace to the signed outer-app updater over
private FD5, keeps FD3/FD4 pairing intact, restores notices and real progress,
and preserves the independent service. Signed native installation/restart and
retained-service acceptance remain open. Windows/Linux still require actual
native package producers, launch/transport, per-user services and native checks;
never toggle producerImplemented or publish root-only installers as full parity.

Mac 0.4.3 and Windows/Linux 0.3.0 remain public. 0.4.4 is not built or published.
Keep the production Mac host manifest
c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83
until a stopped, data-preserving migration is implemented. Build/verify the real
0.4.4 installers and updater signatures, publish all three targets, then update
website downloads/blog/release notes. Publication is authorized; do not ask again.

Connect's complete two-computer+iOS sign-in, discovery, off-network agent control,
reconnect/revocation and push are not accepted yet. Keep free local/self-hosted
and paid hosted service plans, with billing/entitlement enforcement as separate
work. The finish line remains validated parity, a current normal Mac installation,
a working available TestFlight app, and the requested Windows/Linux release.
Keep paired AGENTS.md/CLAUDE.md files identical and all handoffs current.
