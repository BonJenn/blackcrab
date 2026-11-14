# Blackcrab parity and release handoff

## Current checkpoint — physical native dependencies; continue through 0.4.4 release

Owner explicitly reiterated: do not stop until 0.4.4 is downloadable for Mac,
Windows and Linux. Do not end a successful-merge wake at the milestone: continue
implementing the next release requirement. Required CI waits still use the PR
watch and end the turn; resume automatically on that result. Promote tested stage
to main before publishing the release from the validated main commit, as promised.

Active worktree P/desktop-portable-dependencies-044, branch
feat/desktop-portable-dependencies, base fc7f09773dec5a724232fd9f89d889918b69ab07.
P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes. Read the adjacent
P/desktop-portable-dependencies-044-plan.json for exact PR/head/CI status.

Portable dependency staging now materializes physical node_modules trees without
symlinks/junctions, preserves nested versions and ancestor cycles, retains notices,
rejects package-content escapes and refuses missing required native companions.
Mac staging retains its existing path. Native CI installs the authenticated pinned
source's frozen graph and loads real keyring/accessibility/FFI/passkey/Playwright
modules under the exact Electron runtime, without invoking user operations.
The application payload is still synthetic; full UI/service/installer work remains.
Local tests: 114 managed-desktop/QA tests passed with zero skips, including five
new relocation/version/cycle/missing-addon/source-escape cases. Logs are
P/desktop-portable-dependencies-focused.log and desktop-portable-dependencies-full.log.
No local build/test is running. Native Windows/Linux results for this increment
remain required. Review failures and fix them; do not substitute a fixture-only
pass for real modules. Then continue platform app metadata, actual Root launch,
authenticated transport, per-user services and signed/verifiable installers.

TestFlight Remote 1.0.0 (5) is delivered. 0.4.4 is NOT published. Keep existing
public assets, user data and the Mac production service manifest unchanged until
the reviewed upgrade. Main checkout remains untouched. Website redesign is
separate and its Vercel quota issue must be resolved before site publication.

PR296 native CI follow-up: Linux successfully loaded the actual keyring,
accessibility, FFI, passkey wrappers and Playwright dependency closure under
Electron 44.10.1 / Node 24.22.1 (job 132338945611). Windows job 132338945845
passed all 16 staging/manifest tests but installed no dependencies: pnpm 12's
extensionless placeholder remains when installed with --ignore-scripts, causing
Windows OpenWith rather than execution. Invoke its shipped bin/pnpm.mjs explicitly
through Node on both runners; keep dependency lifecycle scripts disabled and the
frozen lockfile. The missing-dependency check correctly failed, and was not relaxed.
PR296: https://github.com/BonJenn/blackcrab/pull/296. Native Windows verification of
the correction remains required before merge; then continue the next product step.

---

## Previous checkpoint — PR295 merged; native artifact checks passed

PR295 merged to stage fc7f09773dec5a724232fd9f89d889918b69ab07 after all 11 checks
passed on 0f1d72a6d30d44258917a1e1556ce294a48e2afb. No reviews, review threads or
comments remained; PR295 is unwatched. Native Windows job 132311565283 and Linux
job 132311565494 verified the complete format-2 runtime artifact (454/453 entries),
loaded the synthetic payload in Electron 44.10.1 / Node 24.22.1 and cleaned up.
The Windows CRLF checkout defect is fixed without changing trusted hashes.
This is synthetic payload/runtime acceptance, not full workspace or service UI.

Next start an owned branch from the stage merge for physical Windows dependency
closure, platform metadata, native Root launch/transport and service lifecycle,
then actual 0.4.4 installers. Producers remain disabled and 0.4.4 is not published.
No local build is running. TestFlight build 5 is already available. Preserve the
main dirty checkout, the Mac production service and all user data. Exact plan:
/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/desktop-portable-manifests-044-plan.json.

---

## Previous checkpoint — portable manifests implementation and CI correction

Continue the authorized Windows/Linux 0.4.4 work. Active source:
P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes;
P/desktop-portable-manifests-044, branch feat/portable-desktop-manifests, base
f22e310b9a255d69d154819b6082b4de6dd808f8 (merged/unwatched PR294).
Read P/desktop-portable-manifests-044-plan.json for current PR/head/watch state.

This increment adds target-bound format-2 Windows/Linux artifact inventories and
verification. Mac format-1 output remains compatible. Windows inventories omit
nonportable POSIX execute flags and reject links, case aliases and reserved paths;
Linux requires its native entry point to be executable. Both verify pinned runtime
identity, all files, source patches, branding, boot entry and build provenance.
The native CI now verifies a full real-runtime inventory and loads a SYNTHETIC
payload in Electron Node mode. This is not the real workspace, service or installer.
Producer gates stay disabled; do not change them until actual integration works.

Local focused artifact/Mac-QA checks: 22 passed. Complete managed-desktop plus
native QA recipe suite: 108 passed, zero skips. Logs:
P/desktop-portable-manifests-focused-2.log and desktop-portable-manifests-full.log.
A first fixture attempt lacked referenced runtime patch files; the fixture now
copies each exact registry source and preserves all production verifier checks.
Actual pinned archive inventory evidence is recorded in
P/desktop-portable-manifests-044-native-fixture.json: both actual runtime archives
passed (Linux 453 entries, Windows 454). No native runtime was launched on the Mac.
Native CI for
this new source remains pending; inspect final head/checks/reviews before merging.
Next implement physical Windows dependency materialization, native app metadata,
Root launch/authenticated transport and per-user service lifecycle, then installers.
Never publish the synthetic test payload. 0.4.4 is NOT released.

Windows CI follow-up: initial PR295 head 8425ff4 passed the Linux native job but
Windows rejected pinned payload hashes. A Git checkout reproduction found 33
source files converted from LF to CRLF; restoring LF matched every trusted digest.
The managed-desktop attributes now preserve all producer bytes, not only .patch
files. A private-Git regression exercises real checkout filters with autocrlf=true;
it and seven portable-artifact tests passed (8 total). Digests/verifier checks were
not changed or bypassed. Log: P/desktop-portable-manifests-windows-checkout.log.
Final-head native/required CI still needs to pass before merge.

TestFlight Blackcrab Remote 1.0.0 (5) is already AVAILABLE to the existing owner;
no mobile build/upload is running. Do not repeat upload. Website redesign is
implemented in its separate session but Vercel's transfer-limit pause blocks its
publication. These facts and account identities are retained below. Keep existing
Mac service/user data and the dirty main checkout untouched.

---

## Previous checkpoint — TestFlight build 5 delivered; runtime PR294 merged

Updated 2026-11-13 Pacific / 2026-11-14 02:04 UTC. Blackcrab Remote **1.0.0 (5)**
is AVAILABLE to the existing owner in TestFlight. Apple build
8e31043e-b547-4264-9c27-d312772e7bdc is VALID, not expired, IN_BETA_TESTING and
attached to Blackcrab Internal Release (e0956911-71d7-4b8e-a339-7c846bd673b7).
The account-holder tester is a verified member. Testing notes are saved and
notifications enabled. This proves availability, not installation on the phone
or actual device haptic/login/retention acceptance. The owner was told to update.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
D=P/mobile-testflight-polish-xn2t7paa. Authoritative delivery proof:
D/testflight-delivery-verification.json. Source revision
93edbe827fb52c4011cbbe52d5b954dc5de15111 includes merged, unwatched PR292/293.
The signed IPA is /private/tmp/blackcrab-ios-Zgmgz1/artifacts/export/BlackcrabRemote.ipa,
SHA256 38759e70456df516bdd285d383fd88a51110add4b32dbfa2a437258411e18e77. All three
app/extension identities, build 5, entitlements and distribution signatures passed.
Team **Jonathan Benn/YF28W3NGG6**, app 6780360079, bundle dev.blackcrab.remote.
Actual Hermes has Blackcrab Account/Connect, zero T3 Account/Connect strings and
Previously paired hosts. The extra header is removed and bottom-button haptics
included. Existing owned Expo project/channel are retained. No OTA was published;
keep build 4 as the previous version. Do not create another app or repeat upload.

No mobile build/upload command is running. Archive session 78178, uploader 75457,
and final delivery verification 10732 all completed successfully. The first build
failed for missing native RaTeX assets in a JS-only donor; the pinned installer
restored them without disabling native features, and the signed rebuild passed.
D/build-attempt-1-report.json retains the failure. Source staging is
/private/tmp/blackcrab-ios-Zgmgz1, DerivedData P/blackcrab-ios-polish-derived-cdK0rD.
Read D/build-report.json, apple-submission-result.json and plan.json. Do not
restart completed controllers. Signing material remains private outside Git.

Clerk Native API and iOS registration/redirect, GitHub and Apple sign-in are
configured. Google is explicitly owner-deferred. Actual user OAuth/native login
and full two-computer+iOS off-LAN control/revocation/push remain separate acceptance.
The previous checkpoint below records account IDs and setup evidence; no repeated
owner authorization or key rotation is needed for the already completed setup.

Desktop runtime PR294 MERGED into stage at
f22e310b9a255d69d154819b6082b4de6dd808f8 after all 11 checks passed on exact head
a32f13c39d8d695eac9c07144576184402e9bbd5. No reviews, review threads or comments
remained. PR294 is unwatched. The actual Electron 44.10.1 / Node 24.22.1 binaries
executed successfully on native Windows x64 and Linux x64 runners, with complete
notices and cleanup verified (workflow 43544788701; jobs 132293452101 and
132293451983). Six staging/target tests also passed on both native runners.
This is runtime Node-mode acceptance only: no full workspace, service or installer
was launched and no producer gate was enabled. Local 90 managed-desktop and 11 QA
recipe checks also passed; three-platform archive/layout evidence is retained.
Completed worktree P/desktop-portable-packaging-044, branch
feat/portable-desktop-packaging. Start the next owned branch from the stage merge;
preserve these updated handoff files for that increment. Continue platform metadata,
dependency closure/manifests, native launch/transport/service and installer work.
Read P/desktop-portable-packaging-044-plan.json for exact evidence and next steps.

Updater PR290 is merged, but no 0.4.4 is published. Public Mac remains 0.4.3 and
Windows/Linux 0.3.0. Preserve the exact production Mac service manifest
c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83 and user data.
Older 0.4.2/0.4.3 users need the outer updater or a manual 0.4.4 app replacement once
public; docs/desktop-updates.md now records the manual path. Include it in website
and release notes without pointing to nonexistent 0.4.4 assets. Continue the already
authorized three-platform release; no additional publication confirmation is needed.

The owner requested a separate website redesign session, created at
<t3-thread://v2/95c98c5c-276e-4ac8-b422-c5d8447bafe7/mcp:launch:52c478392d53de435662458de3e6d1957fa5cc9fe7cdab0af947fe25ae477d77>.
It IMPLEMENTED the redesign in blackcrab-landing PR18 (head 9e03f93), with local
build/types/lint/download/layout checks, but publication is BLOCKED by Vercel's
Hobby Fast Origin Transfer quota. That session verified the existing public site
is paused too, until December 13 absent account resolution. It did not merge,
change a paid plan, or deploy. Read P/website-redesign-session.json and that thread
before continuing website work; do not duplicate or overwrite its design branch.
Project root /Volumes/G-DRIVE PRO/Programming/blackcrab-landing; separate worktree
/Users/jonathanbenn/.t3/worktrees/blackcrab-landing/design-blackcrab-product-site.
Resolving the Vercel account pause is now also needed for website publication.
The existing Cloudflare/PlanetScale spending authorization did not authorize a
Vercel paid upgrade. Original app work remains active; this is not a global pause.

---

## Previous checkpoint — Apple/GitHub enabled, mobile polish merged

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
Current owned worktree: P/mobile-account-recovery-e49g7nr9/source, branch
fix/native-account-preflight-shape (PR292). The main dirty checkout is untouched.
PR293 (feat/mobile-connect-polish) merged into stage at
41935585301936192105d631cbf2aaa79bc95674 after all nine checks passed on
fc06d667eca1111049638b334064e08b3fee7f61; no review threads or reviews remained.
PR292 is updated with that stage merge; its documentation conflicts are resolved
in favor of the current checkpoint. The checker code is unchanged, accepts the
actual native environment shape, and remains separate from the app bundle.
Read parent mobile-connect-plan.json for the latest PR/head and validation state.
PR292 remains watched; handle its new checks/reviews before merging. PR293 is
unwatched. Do not poll CI or restart completed local handles.

The merged mobile source removes the extra Blackcrab/Legacy hosts header, retains
older pairings under Settings → Connections → Previously paired hosts through the
same guarded root lifecycle, and adds selection/light-impact feedback to actual
native tab and compose events. Programmatic iOS tab events stay silent; failing
haptics cannot block navigation. The managed app and storage owners stay alive.
Physical mobile types, all 100 source/activation tests, 11 root/navigation tests,
consumer verification (23 packages/3170 files) and 13 native resource checks passed.
The reviewed React Compiler keeps immutable originals and exact recorded adapters.

Hermes export COMPLETED from source 935b634628fb161bdea111741b82328bf21af181;
fc06d66 changes only handoff documentation after that source. No build is running.
Read parent mobile-connect-export-reviewed-result.json and mobile-connect-bundle-audit.json.
Physical source: /private/tmp/blackcrab-ios-dXRCWc/repo.
Export: /private/tmp/blackcrab-ios-dXRCWc/artifacts/mobile-connect-export.
Runtime 2cbb84d9fbdb180f1af5bfe3e049108c47d628cb matches TestFlight 1.0.0 (4).
Hermes SHA256: 263cb20915cf16b49979771fa50bc0c13cbd1813d3d4d7ed7a609f5ed1d87544.
The byte audit found zero T3 Account/account/Connect strings and the retained-host
label. This bundle is NOT PUBLISHED. Installed update/retention/reconnect/rollback
and device haptic behavior remain unaccepted. The previous account-only and
branding-only exports are superseded; do not publish those older candidates.

Clerk Native API is ENABLED in Blackcrab production and the native endpoint
returns 200. Do not ask the owner to enable it again. The app is the existing
Vercel bonjenns-projects Marketplace application app_3Lxx0HOT2YePJBXeoWQl82HUFfh,
production instance ins_3Lxx0IT1GVzmRLAWkPZLtQ6vCKk. Do not create another app.
PR291 merged at 0b305bc3079b0568370f3c0836f2a4c3f48331bb and is unwatched.
Native iOS registration in Clerk is complete: App ID prefix YF28W3NGG6, bundle
dev.blackcrab.remote, redirect dev.blackcrab.remote://callback. Final IPA profile,
entitlement, URL schemes and installed ClerkKit/bridge source were checked. That
SDK uses browser OAuth for Google/GitHub and native Apple for Apple; do not require
an unnecessary native Google SDK rebuild based only on newer documentation.

GitHub sign-up/sign-in is ENABLED. OAuth app Blackcrab Connect:
https://github.com/settings/applications/4019324, client ID Ov23lijAU07Se2R9l3Q8,
homepage https://blackcrab.app, callback
https://clerk.app.blackcrab.app/v1/oauth_callback. Only read:user/user:email scopes
were requested. The owner completed GitHub verification. Its generated secret was
supplied privately to Clerk and cleared from transient agent storage.

Apple sign-up/sign-in is now ENABLED in Clerk under **Jonathan Benn — YF28W3NGG6**.
The dashboard initially selected Between The Lines LLC; the owner corrected this.
No resources/settings were changed in that wrong team. Verify Jonathan Benn and
YF28W3NGG6 on every subsequent Apple session before any mutation; do not trust the
dashboard's default team. Registered Services ID app.blackcrab.connect (resource
84X6G8U998), linked to primary YF28W3NGG6.dev.blackcrab.remote. Web domains are
clerk.app.blackcrab.app, app.blackcrab.app and blackcrab.app; callback is the same
Clerk OAuth URL above. Created key QLVW98S6TC named Blackcrab Connect Sign In,
scoped only to Sign in with Apple for that primary App ID. The private .p8 was
saved with mode0600 outside the repository under the user's private Blackcrab
credentials directory and supplied privately to Clerk; never print or commit it.
Clerk saved the Services ID/team/key and enabled sign-up/sign-in. Apple registered
Clerk's exact sender bounces+118644049@clkmail.app.blackcrab.app and displays the
SPF check indicator. This establishes configuration, not a real user login/session
or email-delivery acceptance. Neither Apple nor GitHub has a completed real user
OAuth/native login acceptance yet.

Google setup is explicitly deferred by the owner ("I'll do it later"). Preview
sign-in failed with "This browser or app may not be secure". The owner was asked
to sign into Google Cloud Console in normal Chrome and leave the tab open. Await
that readiness before continuing account-dependent Google work; don't keep asking,
retrying preview login or create a duplicate account. Google remains disabled.
No provider secret belongs in Expo extras, the bundle, handoffs or chat. Existing
Clerk AuthView and hosted sign-in render configured social connections.

Next: merge PR292 after its refreshed checks/reviews; validate the compatible
polish update's installed retention/reconnect/rollback, then deliver through owned
Expo project 33fb14fd-4b87-4e85-920c-b6d4204e4567 / production channel. TestFlight
remains 1.0.0 (4); no new binary or OTA was delivered. Validate actual account
login and full two-computer+iOS discovery/off-LAN control/revocation/push separately.

Updater PR290 is merged. Mac 0.4.3 and Windows/Linux 0.3.0 remain public; 0.4.4
native packaging/publication for all three platforms remains open. Preserve the
production c04c4d44… service artifact and all user data. Finish with validated
parity, a current normal Mac installation, a working TestFlight app and the
requested Windows/Linux delivery. Publication is authorized; do not ask again.

---

## Historical account-recovery checkpoint (superseded where noted above)


The owner reports “T3 Account / Checking” greyed out in TestFlight. The exact
production Clerk native request returned HTTP 400 / native_api_disabled, while
ordinary browser environment requests return 200. This is a verified account
configuration blocker, not a guessed connectivity problem. The owner was asked
to enable Native API; their direct Clerk login did not show the app. Vercel CLI
confirmed a marketplace installation owned by bonjenns-projects (team
team_lnU3T6uVH1qWNsPuzZyybRUr), installation icfg_StWkesT4wBqXQ6OUUeYWynJ7,
resource blackcrab / app_3Lxx0HOT2YePJBXeoWQl82HUFfh. Use
`vercel integration open clerk blackcrab --scope team_lnU3T6uVH1qWNsPuzZyybRUr --format=json`
to retrieve the correct SSO link. The connector's integration read lacked access;
the existing CLI login succeeded. No fresh account or authorization is needed.
The Clerk account email is not established. Do not create another application.

Current worktree is P/mobile-account-recovery-e49g7nr9/source, branch
fix/mobile-account-loading; P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
Read its parent plan.json and validation logs for current revision/process state.
The recorded activation adapter keeps the account/Connect entries tappable,
replaces indefinite loading/blank auth with a bounded actionable message, and
returns to the original Clerk sign-in/profile as soon as auth loads. No storage,
provider identity, native dependency or authenticated command semantics change.
The native-account-preflight is read-only and never prints credentials.
PR291 is https://github.com/BonJenn/blackcrab/pull/291. The physical staged source
/private/tmp/blackcrab-ios-yP6Wlk/repo passed the full mobile typecheck and all 94
experience/activation tests with no skips; the consumer verifier also passed.
Initial mixed dependency-overlay failures are superseded by that actual physical
validation. Runtime/export state is in parent account-export-result.json. No
production update or new TestFlight binary has been published by this change.
The export completed at source d6a3a6e9ff3d8cf2d0ed2c19155574fe2ef91676:
/private/tmp/blackcrab-ios-yP6Wlk/artifacts/account-export, native runtime
2cbb84d9fbdb180f1af5bfe3e049108c47d628cb matches TestFlight build4. Hermes SHA256
099c4db00a51001f5a05079c5a05d8888683407643197ba811806c30440910f3. Byte audit found
zero T3 Account/account/Connect strings and the new account recovery strings.
All local processes completed; no build is running. Next: inspect current PR291
CI/reviews on its wake, merge validated source, confirm native readiness after
the owner's dashboard change, then validate installed OTA retention/reconnect
and publish through the owned production channel. Do not publish the older
branding-only export or change the runtime hash to force compatibility. The
corrected bundle is compatible, but installed update acceptance is still pending.

Branding source changes from PR264/266 already merged, but their compatible
Hermes export was NEVER PUBLISHED. TestFlight 1.0.0 (4) still contains older copy.
Existing unpublished export: /private/tmp/blackcrab-ios-4AS02K/artifacts/shared-copy-export,
runtime 2cbb84d9fbdb180f1af5bfe3e049108c47d628cb. A new account-fix candidate must
include both branding layers and use the same owned Expo production project;
verify runtime compatibility and retained storage/reconnect before delivery.
Do not describe source changes or an export as an update installed on the phone.

The desktop 0.4.4 updater PR290 merged to stage at
a2d753a5e0a37dc7954902d9bede6ff82660b95f after all nine checks passed on
e20672a773960580bc4757dcf9c3d449c6479f6e. Its Chromium notification regression
actually ran and passed in CI, superseding the local browser dependency blocker.
There are no outstanding review threads; PR290 is unwatched. Its worktree is
P/mac-release-040-v2llrqsa/workspace-updates-044; read workspace-044-plan.json in its
parent for completed validation details. Do not restart completed preparation.
The mobile branch integrates this stage merge and preserves both handoffs. Mac 0.4.3 and
Windows/Linux 0.3.0 remain public; native Windows/Linux packaging, three-platform
0.4.4 publication and full two-computer+iOS Connect acceptance remain unfinished.
Website PR17 is merged and verified. Preserve existing service manifest c04c4d44…
and all user data. The finish line remains validated parity, a current normal Mac
installation and an available, working TestFlight app, plus Windows/Linux delivery.

## Desktop delivery checkpoint — updater merged, 0.4.4 release pending

The owner's current request is to fix the workspace Check for updates control,
restore the install notification, show download/installation progress, and publish
0.4.4 for Mac, Windows and Linux. Publication is explicitly authorized. This does
not certify unperformed native tests. Mac 0.4.3 remains public; Windows/Linux
remain 0.3.0. No 0.4.4 release, version bump or replacement installed app exists yet.
The latest Connect status question is additional scope/status, not cancellation.
Website follow-up PR17 is merged at c2f36d77885a5deb727a864d37d286380af03601;
production dpl_8d7vebB8T5HnYG3VPpaMjBMLigGT is READY. Preserve that newer docs work
in addition to the historical 0.4.3 release article below.

Completed updater worktree: REL/workspace-updates-044, branch fix/0.4.4-workspace-updates,
based on stage ef3f4aea11734d8059698d12b7d2211b4d545cf1. REL is
`/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa`.
Read REL/workspace-044-plan.json for current PR/head and validation handles. Do not
restart historical build handles below. Main checkout remains dirty and untouched.

The root cause is that the extracted Electron workspace's updater was deliberately
disabled while the signed outer Tauri app's manual updater lived in a hidden
launcher. The reviewed source now delegates the existing desktop update service
through a separate inherited FD5 socket to a native outer-app updater. FD3/FD4
retain descriptor/pairing duties. Only fixed actions and an expected install
version cross this channel; the renderer cannot supply a URL/path/key/process.
Automatic checks advertise availability, and installation remains an explicit
user action. Real byte progress stays below 100 until signature verification;
unknown lengths and installation have indeterminate bars. Installation surfaces
Root, pauses its workspace-exit monitor, closes only its captured workspace,
installs/restarts the outer app, and retains the independent background service.
Failures remain actionable; check/download/install races must not exit recovery.
See docs/desktop-updates.md for the protocol and delivery scope.

Source validation lives in REL/workspace-044-validation. The pinned prepared
upstream source is blackcrab-desktop-source-TUnd5B; all 307 final production target
files match registry hashes, including the notification regression.
Do not repeat the completed 18-minute dependency preparation. Root types/build
and 155 tests passed, followed by eight focused renderer tests after fieldset
coordination. The complete managed Node suite passed 118 tests. Native updater
and inherited FD isolation tests passed (two each). Full pinned desktop/web types,
the actual desktop bundle and web production build passed. Final reviewed native
and adapter tests passed. All nine CI jobs passed in run43526316952. The Chromium
notification regression passed in cloud-client job132232854479 (one selected
notification test; four unrelated tests skipped by the explicit filter). This
supersedes the local read-only dependency overlay failure for that regression.
It is browser behavior evidence, not native installation acceptance.
All local build/test processes have completed. These checks do not establish
native signed installation/restart or retained-service acceptance. The adapter
also suppresses the in-progress install message from the workspace result because
its existing result handler otherwise treats any such message as an error toast.

Next actions:
1. Updater PR290 is merged at a2d753a5e0a37dc7954902d9bede6ff82660b95f.
   Preserve that integrated source and the compatible mobile candidate described
   above. PR291 still needs current CI/review acceptance before merging.
2. Implement Windows/Linux native package layouts/dependency closure/manifests,
   Root launch, authenticated transport and per-user background-service lifecycle.
   Start at docs/cross-platform-workspace-delivery.md and managed-desktop/targets.mjs.
   Pinned Electron ZIPs are groundwork only. Do not enable a target or relabel a
   historical root-only installer to claim full workspace delivery.
3. Bump all root versions to 0.4.4 together, build target-native installers, verify
   actual downloaded artifacts/updater signatures and perform appropriate native
   checks. The current request authorizes publication, so do not request it again.
   Publish website download links, article and release notes after real assets.
4. Preserve the exact Mac service manifest
   c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83.
   A host change requires a stopped, data-preserving migration. Never interrupt
   running agents just to change diagnostic copy. Older 0.4.2/0.4.3 workspaces
   need the outer launcher's updater or one manual 0.4.4 install to gain this fix.

Blackcrab Connect: sign-in/environment discovery/relay/database integrations are
implemented; historical owned relay health/database and unauthenticated denial
checks passed. Full two-computer + iOS sign-in, environment/session discovery,
off-network agent control, reconnect/revocation and actual push delivery are
still unverified. Do not equate infrastructure provisioning or installer delivery
with cross-device acceptance. Continue those tests after desktop delivery work;
preserve the existing authorized cloud credentials and account connections.
The accepted hosted model remains free local/self-hosted, paid hosted remote,
initially invite beta; public billing/entitlement acceptance is separate.
TestFlight 1.0.0 (4) remains available under prior evidence, not newly validated.

The finish line remains validated parity, a current normal Mac installation and
an available TestFlight build, plus the now-requested Windows/Linux 0.4.4 delivery.
Keep paired directory guides identical and this prompt/checkpoint current.

## Historical checkpoint — published Mac 0.4.3

Mac [v0.4.3](https://github.com/BonJenn/blackcrab/releases/tag/v0.4.3) is public,
stable/latest, from 18055fbc080faa4f6d518c420b19040ce45e3296. Release workflow
43512623914 passed. All twelve downloaded-artifact verification groups passed:
workflow/source, asset hashes, updater cryptography, Root identity/architecture/
signature/notarization, independent embedded helper, both archive/manifest pins,
complete payload inventories/signatures, workspace version, DMG signature/ticket,
DMG/updater app equality and owned unmount. Anonymous installer/updater endpoints
returned 200 and update metadata/signature bytes matched the verified artifacts.

The release fixes pane control overlap, recognized imported monitor presentation
and service permission attribution. Existing service registrations update metadata
only during an explicitly stopped start/restart; do not interrupt running agents
or substitute the newly re-signed service copy. The shipped production host still
has manifest c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83.
The desktop producer was 7a3a642d94bc4fe6224e2f5b373ecf6727631764; its source inputs
match the final release commit. Preserve both revisions as distinct provenance.

Native lifecycle acceptance remains OWNER_TESTING_AUTHORIZED with eight deferred
checks, bound to this release, current update request and existing manual-testing
instruction. No final GUI/service lifecycle PASS or newly installed user app is
claimed. The owner will test the published update. Preserve public 0.4.0–0.4.3
assets and tags; any further shipped change needs a new version.

Website PR16 merged as 7aebba7bbd55b2deefd3f2012d2ba058cc996115. Vercel production
dpl_Eekh2ZQt8YhrjHtXJMFGnKMyn6xq is READY at www.blackcrab.app. Anonymous home,
0.4.3 article, changelog, releases, docs/mobile anchor and all platform download
redirects passed. Mac resolves to 0.4.3; Windows/Linux correctly retain 0.3.0. The
first Mac redirect used stale 300-second release metadata, then revalidated; no
route-code change was necessary. New-deployment runtime logs had no error groups.
TestFlight 1.0.0 (4) remains unchanged. App PRs 286–288 and website PR16 are merged and
unwatched. No build/verification process remains running.

Windows/Linux input groundwork (#288) merged as 24080b6bebc5675c2ff9149f6a4a3cc2a4f0383c.
Official Electron 44.10.1 archives and actual Mach-O/PE/ELF architecture headers
were verified; 97 desktop/cloud Node tests and all 9 CI checks passed. This only
adds pinned target inputs/layouts and Mac producer checks. Windows/Linux producers
remain unimplemented, with no new full-workspace installers. Next implement
native package extraction/layout/dependency closure and manifests, then Root
launch, authenticated browser transport, persistent per-user services and native
install/update/lifecycle tests. Start at managed-desktop/targets.mjs/build.mjs,
artifact-structure.mjs, src-tauri/src/managed_desktop.rs and
managed_service_control.rs; follow docs/cross-platform-workspace-delivery.md.
Do not enable a target by merely changing producerImplemented.

Local evidence (paths may be absent elsewhere): REL/workspace-043-plan.json and
REL/workspace-043-delivery/{publication-result,public-download-verification,
website-production-verification}.json. Final artifact report is in
workspace-043-delivery/final-artifact-verification-4otey0cx/result.json. REL is
/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
The next owned docs worktree is REL/cross-platform-targets on
docs/0.4.3-published-handoff; frozen producer/final-release worktrees stay immutable.
The finish line remains validated parity, a current normal Mac installation and
an available TestFlight build. Public delivery is complete for 0.4.3; full parity
and Windows/Linux delivery are not complete.

## Historical release preparation — 2026-11-13: Mac 0.4.3

The owner requested: “continue and update it. where are w with the windows and
linux builds?” Prepare the next Mac update as 0.4.3, preserving public 0.4.2.
All three fixes merged into stage 9a265383072f9b69a9e7f95cb8c94a8447f35f63 after
nine passing checks each: Mac permission attribution (#283), imported monitor
presentation (#284), pane move/close control placement (#285). Their watches are
cleared. This release branch changes the Root/npm/Cargo versions together; the
managed workspace derives its displayed and packaged version from them.

Active release worktree: REL/workspace-release-043, branch
release/0.4.3-workspace-fixes. Delivery directory: REL/workspace-043-delivery;
live state: REL/workspace-043-plan.json. Read that state before starting/resuming
commands. Keep the unchanged c04c4d44… production service artifact. Desktop producer
7a3a642d94bc4fe6224e2f5b373ecf6727631764 completed build/types/inventory verification;
PR286 merged as 81f5d0172b4d4e42c8d73d135ca74d40e5858917 with all nine checks passed.
Signing/notarization is running under captured shell handle 76314; read the live
plan/report before resuming. The website download, lint, types and production
build checks passed; its prepared changes remain unpublished.

The current update request continues the owner's previously requested manual-test
release workflow. The narrow 0.4.3 policy records both current request and original
manual-testing instruction, exact final source and immutable published 0.4.2
baseline; no lifecycle check is asserted. Verify signing/notarization, downloaded
installer/helper/payloads and updater cryptography before publication. Update the
website only after public assets are verified. Frozen producer B must not change
while signing runs. The policy worktree is REL/workspace-043-release-source on
release/0.4.3-owner-update; use a new clean final source after it merges.

Windows/Linux status: shared source and compile checks exist, but the managed
producer, native launch/transport and persistent service remain Mac-specific.
Their public downloads are still 0.3.0 and are not full-workspace parity. Follow
docs/cross-platform-workspace-delivery.md for the native implementation and
installer validation; do not relabel the legacy Root-only packages.

## Historical follow-up — 2026-11-13: notification merged, pane CI pending

PR283 (Mac permission attribution) merged as ec746f13e377f60077794fba62ca99164a023df4.
PR284 (imported monitor notifications) merged as
cc54beb2335cf3b414e62504110299399a36a238. Both passed all nine checks with no review
objections, and both watches are cleared. Stage now contains both fixes; this is
source integration, not a new installer or native permission-dialog acceptance.

PR285, branch fix/pane-toolbar-placement in REL/pane-toolbar-placement, now targets
stage and includes cc54beb. Its previous head 0c70f37 was tested against the feature
parent; validate the new combined head in CI before merging into stage. Its desktop,
cloud, QA and workflow inputs match the tested 0c70f37 bytes; its native/Root changes
match stage. The pane patch graph has 346 records, and the QA recipe's full-registry
pin is f68b16b2…. The previous CI failures were corrected without weakening checks:
reviewed QA registry pins and Ubuntu 24.04 for pinned Playwright 1.60. PR284's new
Linux browser/CI run passed; local full Node suites passed 103 tests for284 and
104 for285, with zero skips/failures. Original combined source also passed actual
web/desktop types and four Chromium notification/pane cases. See
REL/imported-task-notifications-validation and docs/pane-toolbar-placement.md.

All local test/build processes have completed. No app, provider run or user data
was used for these corrections. The owner confirmed workspace startup succeeded.
Public 0.4.2, website and TestFlight 1.0.0(4) remain unchanged. Next: merge285 after
required checks, build and validate a new Mac delivery, then implement Windows
x64/Linux x64 full-workspace packaging. Keep native acceptance separate from source
checks. The finish line remains validated parity, a current normal Mac installation
and an available TestFlight build. No full-parity claim is made.

The owner asked why releases came from stage. The original instruction authorized
stage integration; 0.4.2 was manually dispatched from its verified commit. Promotion
through main was discussed as a cleaner future release flow, but no release-workflow
or branch-protection change has been made. Preserve existing public tags/assets.
The live plan and D/delivery-handoff.md carry exact current heads and CI state.

## Historical follow-up — 2026-11-13: permission identity and imported notifications

The owner confirmed the public workspace opens after Try again and responding to
macOS permission prompts. Do not treat startup as still blocked. Their remaining
reports are macOS dialogs naming `t3` and older imported threads showing raw Claude
`<task-notification>` monitor events as user bubbles. The owner also reported
rightmost pane move/close buttons obscured by panel controls. They requested Windows
x64 and Linux x64 packages with the full workspace after these Mac fixes.

`fix/macos-service-identity` adds the signed Root bundle identifier to the owned
LaunchAgent's AssociatedBundleIdentifiers and supplies Blackcrab local-network
usage text. Legacy owned units remain readable; only a confirmed stopped start or
restart upgrades their metadata, retaining installed PATH, runtime/owner binding
and user data. Status only reports that a restart is needed; no running agent is
automatically interrupted. This does not replace the pinned host artifact.
Validation: 8 actual-crate native service tests, 25 focused renderer tests and
root TypeScript passed. Actual macOS permission-dialog attribution is pending;
source tests do not establish native prompt acceptance. Public 0.4.2 is unchanged.

Active owned worktree: REL/macos-native-identity; base stage 20bea615 (PR282 merged,
all nine checks passed, watch removed). Evidence: REL/macos-native-identity-validation.
Both native/frontend test processes completed. Notification and pane follow-ups
are implemented in REL/imported-task-notifications and REL/pane-toolbar-placement.
Their combined pinned source passed full web/desktop types, 17 focused checks,
and 4 Chromium behavior cases (2 notifications, 2 six-pane hit-area scenarios).
All 346 patch records / 301 final targets were verified; 40 unrelated timeline
cases were filtered out. Browser setup initially failed on relocated CommonJS
cache shims; putting the unchanged copies under owned node_modules resolved it.
All local processes completed; no app/provider was launched against user data.
Next: finish separate imported-notification rendering, validate
and merge coherent PRs, then implement cross-platform full-workspace packaging.
Do not ship a root-only Windows/Linux app or claim the old 0.3.0 downloads are parity.

## Published baseline — 2026-11-13: Mac 0.4.2 published

Mac [v0.4.2](https://github.com/BonJenn/blackcrab/releases/tag/v0.4.2) is public,
stable/latest, from `cb586b1f4832714e624c4a328b777ef321670fd3` (PR281 merged after
nine passing checks). Release workflow
[43488304042](https://github.com/BonJenn/blackcrab/actions/runs/43488304042) passed.
Actual downloaded installer/updater files passed all twelve verification groups:
asset digests, updater cryptographic signature, Root identity/arm64/signature and
notarization, embedded standalone helper, both payload archive/manifest pins,
complete payload inventory/signing/notarization, Electron/native/package version
0.4.2, DMG signature/notarization, DMG/updater app equality, and owned unmount.
Anonymous public DMG/updater requests returned 200 and metadata/signature bytes
match the verified downloads. Preserve this public tag and its assets.

The owner authorized publication with “you have plenty of usage get this published”.
`native-acceptance.json` is OWNER_TESTING_AUTHORIZED for this exact source and the
immutable 0.4.1 baseline. It does not claim PASSED lifecycle acceptance. The owner
confirmed the preceding private sole-workspace candidate works; final polish was
validated with focused tests, types and browser pane/picker tests. Current final
Mac UI/lifecycle/upgrade acceptance remains separate from artifact verification.
This turn did not replace or quit the owner's running private candidate, change
user data or send provider prompts. If that candidate already says 0.4.2, use the
public DMG to replace it rather than relying on a higher-version update prompt.

The shipped changes remove the retired interface, open the workspace directly,
correct the signed helper startup defect, show Blackcrab 0.4.2, remove the reviewed
workspace/provider product labels and unowned GitHub app action, add Home/External
drives/Computer picker shortcuts, and route split-pane image drops to the target
conversation. Saved compatible IDs and upstream notices remain intact.

Website PR14 is merged at `7b4cf8594001ff0b236508bcbf911446f0523051` after its two
checks passed. Production deployment `dpl_GmaW6yasnWX5PmwCWWMvG9eoeemi` is READY and verified.
Anonymous home/blog/changelog/releases/docs requests passed. The Mac route serves
the actual 0.4.2 DMG; Windows/Linux retain working 0.3.0 downloads. The apex domain
also reaches the verified www site. Evidence: `D/website-production-verification.json`. The announcement, changelog, docs and downloads are in
BonJenn/blackcrab-landing; www.blackcrab.app is separate from app.blackcrab.app.
TestFlight 1.0.0 (4) is unchanged; no new mobile build or full parity is claimed.

### Authoritative paths and completed work

REL=`/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa`.
D=`REL/workspace-final-042-delivery`.
Live delivery state: `REL/workspace-polish-042-plan.json`.
Publication: `D/publication-result.json`; public downloads:
`D/public-download-verification.json`; final package evidence:
`D/final-artifact-verification-bvan3ly0/result.json`.
The exact installer is in that verification directory's `downloads` subdirectory.
DMG SHA-256: `66680b6b0047e092b37622da456443348faa8dd3d271d5588afacb338d7ce9b3`.

Frozen release source: `REL/workspace-publish-042`, clean detached cb586b1.
Desktop was built from a62414a; `D/desktop-producer-equivalence.json` proves the
complete relevant desktop inputs equal the final merged source. Do not relabel
that producer revision. Apple accepted inner notarization submission
`d3a133e3-923e-45d5-9160-8d7e17bbcc80`; final desktop manifest is
`79c5c68d51b0592d39131aa2d5e3820cd53beee9ed98f9313a685a38bc6a26b5`.
All build/sign/package/dispatch/verification/publication handles for this release
have completed. No native build is running; do not restart old handles.
Check the live plan for any later documentation/deployment work.

### Remaining service branding and safe upgrade work

The release deliberately retains the ORIGINAL production host at the temporary
path `/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads/service-host`,
manifest `c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83`.
Some host-generated diagnostics still contain upstream terminology; the public
notes disclose this. Do not replace it with the unused re-signed host copy.

Local-only follow-up: `REL/workspace-polish-042`, branch
`fix/host-product-copy-042`, commit a62414a7219a9506b5d022564c2d29cb4f59f312.
It adds 159 exact product-copy patches, service profile wiring and a 256-record
manifest bound (257 rejected). Thirty-three focused source/artifact tests passed;
the new Rust test has not run locally and this branch has no PR. Host build 69082
was cooperatively cancelled; its terminal audit is FAILED_NO_ADOPTION with no
output and preserved reference/metadata/cargo-seed inputs. No host was activated.
Do not refresh its source freeze without a successful real build.

Next implementation: inspect `attachment_binding`, `verify_payload_config` and
`refresh_bundled_issuer` in `src-tauri/src/managed_service_issuer.rs` and the selected
runtime directory rules. Existing attachment binds the compiled host manifest and
fixed version directory; swapping the artifact breaks existing installations.
Implement and test an explicit stopped-service migration preserving environment,
identity, credentials, catalog and generation before shipping a rebuilt host.
Use owned fixtures, never the user's existing service for a migration experiment.

Then continue the scenario ledger for desktop/mobile/cloud behavior, native
acceptance, current normal Mac installation and TestFlight availability. Those are
the finish line; merged PRs and publication are not full parity. Keep the main
checkout's unrelated dirty files and all public release assets intact.

---

## Historical checkpoint — 2026-11-13: publish the workspace fixes now

The owner explicitly renewed publication. Release branch release/0.4.2-owner-publication
in REL/workspace-publish-042 starts from merged c0e9fbd (PR280 passed nine checks).
Its only code change records the exact renewed 0.4.2 owner-publication instruction,
bound to the final source and immutable published 0.4.1 baseline; it does not claim
native lifecycle acceptance. Retain the existing production service artifact/pin.
The separate local a62414a host-copy branch changes 159 source files, but cannot
yet ship: existing service attachment binds the old compiled manifest and runtime
version directory. It requires a deliberate stopped-service manifest migration.
Its producer build was cooperatively cancelled through original handle 69082;
await the final audit before calling it stopped. Do not refresh its source freeze.

Desktop build handle 53133 uses immutable REL/workspace-final-042-release at a62414a.
The desktop producer inputs and 337 patch records are unchanged from c0e9fbd; verify
that equality before signing/reusing the artifact for the publication branch.
Output is REL/workspace-final-042-delivery. All actual handles and release state
are in REL/workspace-polish-042-plan.json. The old 1140889 build remains superseded.

Next: complete the current desktop build; verify producer equality; sign/notarize
with the ORIGINAL production host; merge the publication PR after required checks;
pack the exact merged source, replace only the private v0.4.2 draft assets, dispatch
the managed release workflow, verify actual downloaded installer/updater/signatures,
publish GitHub and then the website. Keep service-message cleanup as an explicit
remaining follow-up. Do not claim every host message or full parity is complete.


## Historical checkpoint — 2026-11-13: compiled audit caught provider branding; release held

The 1140889 desktop build completed, but an audit of its actual JavaScript found
T3 product copy in shared schemas: OpenCode's server setting and GitHub app metadata.
The renderer also carried three legacy account API descriptions. The GitHub link
targeted T3's app, not a Blackcrab-owned integration. Do not install or publish that
candidate. Signing handle 18842 was cancelled through its original handle (exit 130)
while still SIGNING, before notarization; partial output is retained. No release
assets, installed app or user data changed.

Active worktree remains REL/workspace-polish-042, now on
fix/provider-product-branding-042. Four new exact patches remove that copy, omit
the unowned GitHub app action while retaining GitHub CLI/token auth, and correct
the desktop CLI recovery error. Saved IDs, ownership markers and upstream notices
remain intact. The producer and hosted builder now check the compiled renderer for
upstream product labels and the unowned app URL, including schema-generated UI.
Eighteen focused tests, twelve cloud tests, full desktop/web types and all 337
fresh patch applications pass. The guard reproduces rejection of the old compiled
bundle. Renderer build handle 49347 completed; after the guard was corrected to
preserve the compatible `t3 connect status` command, all 958 output JavaScript files
passed. V/provider-renderer-validation.json records the final result.
No replacement production build is running yet.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
D=REL/workspace-polish-042-delivery; V=REL/workspace-polish-042-validation.
Read REL/workspace-polish-042-plan.json for current handles and PR state.
Corrective PR280 is open and watched. Its first frontend CI run failed because the
QA recipe still pinned the previous 333-record production registry. Verified all
333 existing records are unchanged, the four appended records match fresh source,
and none touches the QA identity targets; refreshed only the complete-registry pin
to fd0109a54ea9129593d3b2b74e4c6faa3be3fa067ab4d72e50d79e992946e31e.
The failed test group plus native-keychain producer tests now pass: 70 passed,
one existing skip, no failures. Review evidence is V/provider-copy-qa-pin-review.json.
Next: inspect CI on the pushed correction and merge only when all checks pass.
The deeper audit also found host-originated provider/status/runtime-instruction
copy: D/host-product-copy-audit.txt. Review those strings before claiming every UI
surface is owned. Host source preparation has its own 71-record service profile;
desktop-only patches do not update the running host. Human-facing host changes
require a reviewed host patch layer and rebuilt host, with normal stopped-service
upgrade preserving identity. Never relabel an old artifact or weaken profile pins.
Historical reuse of the original host below is valid only while its code is unchanged.

Website 7281830 is locally committed and passes download tests, lint, Next build and
types. It remains unpushed/unpublished. Mac 0.4.2 remains a private draft at d9b5601d;
do not publish its superseded assets. The owner is still using the previous working
candidate. TestFlight 1.0.0 (4) remains available; full parity is not certified.

## Historical checkpoint — 2026-11-13: all polish fixes merged; desktop built and signing

Branding/version PR277, external-drive picker PR278 and pane-local attachment PR279
are merged to stage. Each passed all nine CI checks; all are unwatched. Final source
is 1140889d5a6730d336b6f1a16347d2d1d33ca82c. The resulting tree equals the tested
pane PR head. Full desktop/web types, 38 picker logic tests, transfer tests, producer
registry/version checks and all four browser tests passed. All 333 patches applied
to fresh pinned source; prepared sources match the final 293 target file digests.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Authoritative live state: REL/workspace-polish-042-plan.json.
Frozen release checkout: REL/workspace-polish-042-release at the exact merge SHA.
D=REL/workspace-polish-042-delivery. Managed desktop build 20725 completed successfully.
D/desktop-build-result.json records BUILT_VERIFIED_UNLAUNCHED, 3,600 files and the
exact source above. Signing/notarization is running through original handle 18842,
controller D/sign-notarize.mjs. Resume that handle; do not rebuild or start a second signer.
Signing tools are linked only after matching both package/lock files to the prior
verified release. D/prepare-inputs.py is prepared, not run.
D/native-acceptance.json remains DRAFT_VALIDATION_PENDING for this exact source.

The internal disk hit its limit. Only the known duplicate review download
~/Downloads/Blackcrab_0.4.2_new-workspace_aarch64.dmg was replaced by a symlink to
its verified, unmounted, checksum-identical archive on G-DRIVE PRO. Evidence:
D/relocated-review-download.json. User data and the running app were untouched.
Use external output/temp directories; do not delete user files or shared caches.

After the desktop build passes, sign/notarize its new copy. Retain the ORIGINAL
unchanged production service artifact and pin from the live plan; do not select
the newly re-signed unused host copy. Next, adapt the prior private-draft dispatch
and artifact verifier to this source, preserving verified backups of all five
current private v0.4.2 assets. D/previous-draft.json confirms the old draft still
points at d9b5601d424e9808ee2c8dcac5bf42f8cf97d137. It is not public. Require actual
new Electron/native/renderer version 0.4.2, signed/notarized Root and helper,
archive pins and updater signature. Complete native UI/lifecycle acceptance,
normal installation and publication before describing the new build as delivered.

Website REL/website-patch-042 is 72818307284f15b656ad134bfcfed3dd0040b576, committed but unpushed/unpublished. It
includes /docs#mobile for the owned workspace link and truthful invite-only iOS
beta information. Download tests, scoped lint, full Next build and types pass.
The final notes cover branding/version, drive shortcuts and pane drops; all checks
passed in D/website-final-validation.json. Publish only after the Mac installer is public. TestFlight
1.0.0 (4) is still available; no new iOS build is implied. Full parity is not certified.

## Historical checkpoint — 2026-11-13: workspace works; owner requested polish

The owner unlocked the Mac. The previous Root quit normally; read-only process
inventory showed both old Root/client exited. The exact verified 0.4.2 Root from
sole-workspace-042-delivery then automatically opened the new Electron workspace.
The first-launch catalog, configuration, environment identity and keybinding hashes
match the pre-upgrade baseline (one project, four v2 threads, no runs). No provider
prompt was sent. The owner reports it looks and works fine, but requests complete
visible branding cleanup, the correct 0.4.2 version, easy external-volume selection,
and fixing image drops that currently go to the rightmost pane.

Publication is held for these fixes. Do not publish the prior private draft.
REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Current implementation: REL/workspace-polish-042. Live state:
REL/workspace-polish-042-plan.json. Validation and prepared pinned producer source:
REL/workspace-polish-042-validation. PR276 merged at 512c96eb8068290b9aa57d124fe60548843924b9
and is unwatched. Main dirty checkout and immutable prior artifacts are preserved.

Branding fixes cover shared runtime/contracts and theme labels as well as web and
desktop copy; preserve internal protocol/storage IDs and upstream license notices.
Managed Electron/package/renderer versions must derive from Blackcrab's root
release version, including the web cache key and native bundle metadata.
The pane bug is a shared composer ref in ChatView; scope attachment insertion to
each pane and register only the focused composer for global palette commands.
The folder picker should expose Home, External drives (/Volumes on the selected
Mac environment) and filesystem locations without typing hidden mount paths.

Branding/version PR277 merged after all nine CI checks at
cc2232b88d9077c06a18b4132d994bdfc6e148fc. The workspace producer now takes the
Blackcrab release version for renderer/package/native metadata and web-cache identity.
The external-volume change adds visible location shortcuts to the actual project
picker and an explicit choose-folder action when creating a project. It preserves
selected-environment routing and existing folder creation/conversation behavior.
Local validation: 38 folder/palette logic tests, six patch-registry tests and full
web types pass. The two real-browser shortcut tests pass. The browser harness needs
explicit prebundling of both use-sync-external-store selector import spellings
because the reviewed dependency cache uses workspace symlinks; no UI logic is
replaced by that harness. The actual palette integration test also passes: real clicks switch the selected
Mac to /Volumes/ and back to ~/. It loads the real stylesheet, and the local
cache harness prebundles the icon and use-sync-external-store CJS entry points.

External volumes are in PR278 (branch fix/workspace-volume-picker-042, head
33f4ca9a25011c66407e4d5883c8b1aef8149d04), based on stage. Pane fix PR279 branch:
fix/workspace-pane-attachments-042, stacked on PR278. Each ChatView now owns its
composer handle and provides it to its descendants; only the focused pane registers
for global commands. File drops focus their destination and stop bubbling. Full
web types, the existing two transfer-splitting tests and the real-browser three-pane
regression pass, including focus changes and unmount cleanup. Keep the original
production service artifact/pin when rebuilding; these are client-only changes.

Next: review checks/comments and merge PR278 to stage, retarget PR279 to stage
without losing its parent, then merge it. Rebuild the exact merged source, then complete native lifecycle/installation and
publish Mac/website updates. Full parity is not certified. TestFlight 1.0.0 (4)
remains available. Finish line remains accepted desktop/mobile/hosted parity,
a normal current Mac installation, and TestFlight availability. No native build
is running; local source validation is complete and active handles/PR heads are
tracked in the live plan. Website source REL/website-patch-042 is now bb01d27,
unpushed/unpublished, with the matching /docs#mobile anchor and invite-only beta
copy. Scoped lint passed; full website checks are required before publication.

## Historical checkpoint — 2026-11-12: installer verified; Mac locked

The owner wants the older interface removed and the new workspace to open directly.
PR275 passed all nine checks and merged to stage
`d9b5601d424e9808ee2c8dcac5bf42f8cf97d137`; it is unwatched. Do not rewatch it.
This source removes legacy views, launches the workspace automatically, retains
service recovery/updates, and replaces onboarding/environment/account branding.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/desktop-default-042-plan.json for authoritative current paths/status.
Frozen release source: REL/desktop-default-042-release at that merge SHA.
Docs worktree: REL/desktop-default-042, branch docs/sole-workspace-delivery-042.
Delivery directory D=REL/sole-workspace-042-delivery. Main dirty checkout/index
and frozen release source remain unchanged. No build is still running; handle
5635 completed successfully. Do not restart or dispatch the completed build.

Release workflow 43380980343 passed. Downloaded Root, helper, DMG and updater
passed Developer ID signatures, Apple notarization, Gatekeeper, updater crypto,
payload inventories and archive pins. The mounted DMG app matched the updater
app and the mount was removed. Evidence:
D/final-artifact-verification-rhld0rqc/result.json.
Verified Root: D/final-artifact-verification-rhld0rqc/updater/Blackcrab.app.
New desktop manifest:
1c8425779907103e2d370e1c90c4ef99d1de0ec51d11cb0eef543f92dc69c56d.
Retained service manifest:
c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83.
Use the plan's serviceArtifact: native attachment requires the existing service
pin. Host code is unchanged. Do not select the newly re-signed unused host from
D/notarized-payloads. Helper SHA:
84247061376750240246a5bd0450f5d9eabb3c724d51b1cb3ecdf5863726db62.
Draft input ZIP SHA:
01cf7268deb6868f00d275e8da1db30864957f807230162ce650166f2c07ff7b.

The current blocker is a locked build Mac. Read-only IOConsoleUsers reports the
current user on-console with CGSSessionScreenIsLocked=true. CUA reports
cgWindowNotFound for the old Root/client and Finder, even after reconnect/reset.
No normal quit succeeded, and the new app has NOT been launched or installed.
The old Root/client/service remain running. No provider commands were sent.
The owner has been asked to unlock the Mac and bring Blackcrab to the front.
After unlock, quit the old app normally through CUA, launch the exact verified
new app, then validate automatic launch/reuse/reopen/quit and service recovery.
Do not adopt or kill discovered PIDs. After Quit, inspect Finder/process counts;
getApp/getAXState can relaunch a quit Mac app. D/snapshot-catalog.py records only
hashes/counts. Baseline before-upgrade-catalog.json: one project, four v2 threads,
no runs. Check catalog/configuration/identity retention across the native tests.

A byte-verified review DMG is available at
/Users/jonathanbenn/Downloads/Blackcrab_0.4.2_new-workspace_aarch64.dmg
(SHA-256 eeaa46ca88d1235d309e98b82ff728a24622d4323a7916e8e5fb4eb25832e993).
0.4.2 remains a private draft. DRAFT_VALIDATION_PENDING is not passing native
acceptance. Public 0.4.0/0.4.1 assets are unchanged. After native validation,
publish/install this exact candidate, then publish the website changes.

Website REL/website-patch-042, branch release/0.4.2-website, head 45a3ae7,
is committed locally but unpushed/unpublished. Home/setup/metadata/blog/changelog
now describe the sole workspace; retired grid/shortcut claims are removed.
Download tests, scoped lint, Next build and types passed; paired guides match.
Create/link its PR after the Mac release is public, review the preview, and check
production routes and real Mac/previous-platform download redirects.

Finish line: validated desktop/mobile/hosted parity, a current normal Mac app
installed for the owner, and the processed iOS build available in their TestFlight.
TestFlight 1.0.0 (4) remains available; this change has no new mobile build.
Full parity is not certified. Temporary paths may disappear; inspect evidence
before resuming. Keep credentials private; never print saved auth/env files.

## Historical checkpoint — new workspace becomes the only desktop UI

The owner confirmed the first 0.4.2 workspace looked good, identified T3 branding
in environment selection, and explicitly requested removing the older interface
entirely. That instruction supersedes all historical legacy-view preservation
guidance. The corrected helper already runs in the real signed candidate, the
service is running, Full desktop opened and repeated Open reused one captured
client. No provider prompt was sent by the assistant. This is narrower than full
lifecycle acceptance. The owner is using that candidate; do not kill its processes.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Current worktree REL/desktop-default-042, branch feat/new-workspace-default-042,
based on stage 184500a423f87b47cd49c6ac31d8022d26f3af59. Read
REL/desktop-default-042-plan.json for current handles/validation/PR. The older
REL/desktop-patch-042-plan.json points here. The main dirty checkout/index is untouched.
PR273/274 are merged and unwatched. Private v0.4.2 workflow 43369124588 succeeded;
its artifacts passed signature/notarization/updater/payload checks but are now
superseded by the owner's new UX instruction. Do not publish that earlier draft.

The new source removes legacy renderer components and their obsolete UI tests,
replaces App with automatic managed service/workspace startup, narrows Root native
commands, and stops initializing the old remote-session server. Root retains only
startup/recovery, service controls and signed updates. AppKit activates only the
captured child before Root hides. Workspace Quit exits Root while leaving the
service running; crash recovery stays visible. User data is never deleted.

123 exact pinned producer deltas replace human-facing T3 wording across desktop
and web surfaces, shared logo components, onboarding environment/account selection
and instructions. Internal protocol/package names and upstream legal notices
remain. Upstream T3 Chat subscription/link pages are removed from account navigation;
tunnel usage and management remain, with server limits unchanged. Rebuild the managed
desktop payload; the old branded payload is insufficient.

Validation/evidence lives in REL/desktop-default-042-validation. Root frontend
TypeScript, 151 renderer tests and Vite production build passed, as did native
`cargo check --locked`. Full upstream web and desktop typechecks passed after all
branding/account changes. Managed producer/identity/contract checks passed 85 tests;
cloud configuration checks passed 12 tests. A fresh pinned source extraction applied
all 197 patches exactly. These are source checks, not packaged GUI acceptance.
Final launcher typecheck/build and 26 focused startup/settings/updater tests passed
after the last updater cleanup change. Service/update controls prevent navigation
while their operations are in flight.
Read the live plan for final source, PR and any active handles.

PR275 CI initially failed both hosted-web jobs on the same stale
`hosted-owned-privacy` predecessor. The correction also rebases hosted welcome and
empty-state patches on the shared branding output. Fresh single/channel hosted
preparation now passes all 197 shared plus nine hosted patches, and 13 cloud tests
pass, including a regression for that layer boundary. Full CI build/types/tests
still need to rerun on the corrected head; do not count source preparation as a
completed hosted production build. PR275 remains watched.

Next: create/link the coherent PR, merge only after current CI/review, rebuild and
notarize the branded desktop payload, then build the new exact-source Root draft.
Verify automatic first launch, reopen, quit, service survival and recovery in the
actual signed app before publication/installation and website updates.

The existing website 0.4.2 branch is validated but local/unpublished; rewrite its
copy to this final single-workspace behavior before creating its PR. Keep current
public 0.4.0/0.4.1 assets immutable. TestFlight 1.0.0 (4) is available. Overall
finish line remains accepted desktop/mobile/hosted parity, a current normal Mac
app installed, and TestFlight available. No full-parity completion is asserted.

## Historical checkpoint — helper fix merged; preparing draft 0.4.2

PR273 merged to stage 8aaa56fd9b0d34d3bd433c1d0d07e088c77db3bf after all nine
checks passed on 0126076c02b05cd877bfe2f5b6eb0fea925f03c1. It is unwatched.
The actual 0.4.1 service-helper signature failure and its hidden setup error are
reproduced; the dedicated signed helper and preserved-configuration upgrade passed
local native tests. See desktop-startup-041-diagnosis.md for the precise scope.

The active worktree is REL/desktop-patch-042, branch release/0.4.2-service-startup.
REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/desktop-patch-042-plan.json for the current head, PR, release and handles.
The original fix and its evidence remain at REL/desktop-launch-041-fix and
REL/desktop-launch-041-diagnosis. No corrected installer has been built/published.
The main dirty checkout/index and public 0.4.0/0.4.1 releases are preserved.

This change prepares root version 0.4.2 without changing dependency versions or
mobile version. It adds explicit draft-only build validation so the final signed
installer can be produced before asserting its UI behavior. DRAFT_VALIDATION_PENDING
is bound to exact source/tag and lists all untested lifecycle checks; it requires
--draft-build. The workflow independently checks isDraft and leaves output a draft.
Normal validateAcceptance rejects this state. The old owner-testing exception is
unchanged; no successful native UI evidence is asserted or fabricated.

Next: validate/merge this preparation PR; reuse the exact notarized inner payloads;
pack source-bound draft inputs, create a new draft v0.4.2 and dispatch release.yml
at that source. The new helper is independently signed/notarized before embedding.
Download and verify final Root/DMG/updater/helper, then exercise actual service
installation, Full desktop open/reuse, quit/reopen and upgrade preservation before
publishing. Update the website only after that new release is verified/public.
Native CUA last returned cgWindowNotFound; retry current capture, do not infer
application exit from it or relabel missing UI evidence as passed.

The 21 release/helper tests passed, with no skips. Locked Tauri npm/Rust
compatibility, Cargo metadata, unchanged npm dependency graph and paired guides
were verified. CI and final native packaging/runtime checks still remain.

No build/test process is currently owned. The diagnostic service is stopped and
its unloaded LaunchAgent archived; workspace configuration remains for upgrade
validation. Continue scoped native service controls and captured children; never
adopt discovered PIDs. TestFlight 1.0.0 (4) remains available. Full desktop/mobile/
hosted runtime parity and a usable installed Mac app remain the overall finish line.

## Historical checkpoint — 0.4.1 failure reproduced; standalone service helper fix

The owner reports 0.4.1 still cannot open Full desktop. Native CUA reproduced it
in the actual 0.4.1 DMG app on this Mac: Refresh makes desktop ready; Open returns
unavailable. The packaged desktop passed real native extraction/verification.
The fresh host had no configuration. Full desktop swallowed the instruction to
enable the background service. Enabling it through the actual app then exposed a
second failure: the service launcher repeatedly reported bootstrap unavailable.

The installed issuer was an exact copy of Root's signed app executable outside
its app bundle. `codesign --verify --strict` reports invalid Info.plist; an owned
preflight child exited by SIGKILL before emitting anything. This is a concrete
signed-package defect, not a missing archive or a cache-permission guess.

Worktree: REL/desktop-launch-041-fix, branch fix/native-desktop-launch-041,
base stage 0606456e2d9cb3274901266e5b89d6d70ad34047. REL means
/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Live evidence/handles: REL/desktop-launch-041-diagnosis/plan.json. Read it before
resuming anything. The main checkout/index and the published source are untouched.

The candidate adds a dedicated CLI helper, signs/notarizes it independently,
and embeds those signed bytes into Root. Root's signature protects the embedded
helper; the installed standalone copy no longer depends on an app Info.plist.
Explicit install/start/restart may refresh an inactive owned helper while keeping
configuration, environment, generation and journal. Active/uncertain sessions
and Direct ownership remain protected. The native Open response keeps retry
available and gives fixed service setup/start instructions. A primary toolbar
button opens a modal containing service setup and Full desktop together.

The new 2.3 MB standalone helper passes Developer ID verification and executes
its CLI argument validation. The corrected opt-in native regression also PASSED:
fresh real runtime setup, old-helper replacement, active-owner refusal, unchanged
configuration/generation, strict relocated signature, real readiness and clean EOF.
It sent zero authorization frames/provider commands and installed no OS service.
See standalone-acceptance-result.json and standalone-acceptance.log. The standalone
helper still needs production notarization in the release pipeline; full Root UI
acceptance is separate. No corrected release has been published. Preserve v0.4.0/v0.4.1 tags/assets and website history.

During diagnosis the fresh service was enabled through UI, then stopped through
UI after its repeated failure. Its stopped/unloaded LaunchAgent was verified and
archived outside LaunchAgents to prevent another broken retry at login. The
workspace/configuration remain intact for the product upgrade path. See
service-test-cleanup.json; no discovered PID was killed. Native CUA later returned
cgWindowNotFound again. Do not infer that the app closed or that UI passed.

Final local checks passed: 34 native unit tests (7 entry, 21 issuer, 6 service
control), 16 Node tests (3 native opt-ins explicitly skipped), the 12 focused
renderer tests, TypeScript and the production web build. The real native opt-in
readiness/upgrade regression passed separately. No build or test handle remains
active. Inspect plan.json for the corrective PR/head after publication.

Next: commit/create the corrective PR, inspect/merge it after CI, deliver a new
signed and notarized patch, and verify actual service startup + Full desktop opening. Then
continue the parity ledger. Finish line remains validated parity, a normal usable
installed Mac app and owner TestFlight availability. TestFlight 1.0.0 (4) exists;
mobile/hosted runtime acceptance and commercial-service work are still pending.

## Historical checkpoint — 0.4.1 publication before owner failure

This historical checkpoint preserves the earlier publication evidence. Its old
statements about active PRs, shell handles, pending authorizations and next steps
are not current instructions. The Current checkpoint above controls continuation.

PR270 (native availability detection/startup diagnostics) and PR271 (0.4.1
preparation) each passed nine checks, merged into stage and were unwatched.
The release source is 62ef3868d65252ba062bbee0200d6cb74a27ea6f. Mac 0.4.1 is
PUBLIC and stable/latest after successful workflow 43355513074 and verification
of the actual downloaded files. The website announcement and download are also
live. The owner authorized testing the 0.4 release after publication; native
acceptance remains deferred, not PASSED.
The owner's work-Mac failure is not yet confirmed resolved.

### Authoritative local state

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
REL=P/mac-release-040-v2llrqsa. Temporary /private/tmp paths may eventually expire.

- REL/desktop-patch-041-plan.json: current source, build, publication and handles.
- REL/desktop-patch-041: frozen release worktree, clean at the source above.
- REL/patch-041-delivery: source-bound payload ZIP, native-acceptance record,
  artifact verification plan/script and results. ZIP SHA256 is
  f3045ce005b2187d74a53ab7188b6ab58aef0c4f0d006bafc8ca38afd8719f0c.
- REL/website-patch-041: clean branch release/0.4.1-website at
  03d923c554d0c20c5048e0a62a632d93d493b2fe. Download tests, typecheck, lint and
  production build passed. Vercel preview dpl_Ht6YAxaK4t2oyoTaxy9bvCbUoXNV is
  READY; authenticated HTTP checks of home/blog/changelog passed. Website PR13
  merged to main 5db4f74ca9c13a83e7a16988def991250ee080f7 and was unwatched.
  Production deployment dpl_9R2eAnezPdPpNpStmHZb6YcthpY8 is READY; live home,
  blog, changelog, releases and actual platform downloads passed verification.
- REL/patch-041-handoff: this documentation worktree. Check the plan for its
  final PR/head, rather than assuming an earlier checkpoint's PR is active.
- REL/desktop-patch-041-continuation.md: copyable local live-state prompt.

All shell/build/verification handles have completed. No app, host, service,
simulator, mounted image or browser is owned/running. The verifier ejected its
captured read-only DMG mount. Do not redispatch completed builds or restart old
handles. The main dirty checkout/index, shared caches and installed Mac app
were untouched. The work Mac is still only confirmed installed at 0.4.0.

### Confirmed scope and acceptance boundary

The owner has verified the public 0.4.0 arm64 executable and both bundled payload
hashes on their work Mac at /Applications/Blackcrab.app. Cache/path/ownership/lock
checks passed, and quit/reopen did not help. Full desktop was disabled with one
unavailable line. Do not ask for another reinstall or repeat those diagnostics.

0.4.1 queries native availability directly, rather than assuming notBundled when
a JavaScript runtime marker is absent. Regression tests reproduce that client
misclassification. It also preserves specific native package/storage/lock errors.
This is a tested candidate correction and better diagnostics, not proof of the
owner's original cause. No user data or cache permissions were repaired/deleted.
See desktop-startup-040-diagnosis.md and the private diagnostic report directory.

The unchanged notarized inner desktop/service payloads are reused. Root app
identity, data locations and the existing updater key are preserved. Public
v0.4.0 source caf57b6fab1b4391836c6635882a15a88edfac0d and assets are immutable.
The readonly diagnose-macos-040.pl report is pinned to 0.4.0 hashes; do not ask
someone with a newer app to use it as a current-version integrity check.

### Published artifacts and evidence

- Release: https://github.com/BonJenn/blackcrab/releases/tag/v0.4.1
- Installer: https://github.com/BonJenn/blackcrab/releases/download/v0.4.1/Blackcrab_0.4.1_aarch64.dmg
- Website notes: https://www.blackcrab.app/blog/blackcrab-0-4-1-desktop-startup
- Successful workflow: https://github.com/BonJenn/blackcrab/actions/runs/43355513074
- Actual artifact report: REL/patch-041-delivery/final-artifact-verification-_pmt61l7/result.json,
  state RELEASE_ARTIFACTS_VERIFIED. Checks include GitHub file hashes, unchanged-key
  updater cryptography, arm64/version/bundle identity, hardened Developer ID and
  notarization, embedded archive/manifest pins, inner inventories/signatures,
  DMG signature/ticket and exact app equality between DMG and updater.
- Public updater manifest exactly matches the verified draft artifact; the public
  installer returns HTTP 200. Site /download/macos redirects to the 0.4.1 arm64
  DMG. Windows and Linux continue to their 0.3.0 installers. Internal payload ZIPs
  remain excluded from site installer cards. See public-release-receipt.json,
  public-download-verification.json and website-publication-verification.json in
  REL/patch-041-delivery.
- DMG SHA256: 6c7cb2b0c018951e91473ea42d7953432234027ac47b7cf767065b96cbde75b3.
- Updater archive SHA256: 0719bd6ebc11bde0b58bb652e87810298ffbda5533b6287e9de70b9610565c70.
- Root executable SHA256: e957f32e4715761c01d10e316b648e446be8963c011d154039695b7b4e97e375.

### Next actions and remaining finish line

1. Finish this delivery-handoff PR to stage after its required checks/review.
   Read REL/desktop-patch-041-plan.json for its exact URL and head. Preserve the
   public release/tag and website; they are already published and verified.
2. Ask the owner to try Settings → Full desktop → Open full desktop on 0.4.1.
   If unavailable, obtain the complete new status/error text. If it opens, record
   the tested scope and continue service enable/start, desktop reuse, quit/reopen,
   restart, stop/start and retained data checks. Preserve existing user sessions.
3. Make the full desktop discoverable from the primary app experience. Startup
   still opens the original Root UI; publishing the bundled workspace did not
   make it the default UI. Do not describe this entry work as completed.
4. Continue the parity ledger's actual desktop/mobile agent workflows and hosted
   remote validation. TestFlight 1.0.0 (4) is available to the owner; no new iOS
   build is part of 0.4.1. Newer branding export/OTA publication, physical-device
   retention/reconnect, off-LAN operation/APNs and hosted billing/signup/policies
   remain broader-plan work; validate latest evidence before changing them.

Finish line remains validated T3 parity, an ordinarily usable installed Mac app,
and owner TestFlight availability. Artifact publication, green CI or PR count
alone do not finish it. Do not invent a completion percentage. Existing cloud
credentials and the smaller backend budget are authorized; do not request those
approvals again. Keep the main dirty checkout/index and shared caches intact.
For PR checks, finish changes, link/watch as required and end the turn. Never
poll PRs. Keep all changed AGENTS.md/CLAUDE.md pairs byte-for-byte identical.

## Historical checkpoints — evidence only

The following records are retained for provenance. Their former active handles,
open PRs and next-step lists are superseded by the current checkpoint above.


### Historical — 0.4.1 corrective release preparation

PR270 passed all nine checks at 7054c3b62a353344aae01419c1eb607d75eeb093,
merged to stage 1af8e72562afda52d0891c64d666d2be914d360a and was unwatched.
The owner's work-Mac issue remains unconfirmed fixed; only the reproducible
client misclassification and diagnostics are corrected. No 0.4.1 build or public
release exists yet. Do not overwrite v0.4.0 or claim native UI acceptance.

Active worktree REL/desktop-patch-041, branch release/0.4.1-desktop-startup.
REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/desktop-patch-041-plan.json for current PR/head/handles. Version 0.4.1
is synchronized across root npm/Cargo/Tauri manifests and locks. No dependency
resolution or inner desktop/service source changes are intended. Release notes
are docs/releases/v0.4.1.md. The release input validator allows this single
corrective follow-up of the owner's 0.4 test delivery, with the original public
tag/source explicitly bound and all lifecycle checks still marked deferred.
It does not allow 0.4.2 or later and does not manufacture passing evidence.

Next validate/merge the version PR, prepare a NEW source-bound release-input
archive from the unchanged notarized production payloads, and dispatch the
managed-apple-silicon release workflow at the merged source. Preserve all Apple,
payload and updater checks. Verify actual downloaded artifacts before publication
and use the owner test to establish whether the desktop opens on their Mac.
No owned app/host/service/mount is running. The published 0.4.0 and website remain
intact. The broader finish line remains validated parity, a usable Mac installation
and the already-available owner TestFlight app; PR merges alone do not finish it.


## Investigation checkpoint — published 0.4.0 Full desktop is disabled

The owner installed the correct signed arm64 release at /Applications/Blackcrab.app.
Executable and both payload SHA256 values match the immutable public 0.4.0 files.
Their pinned read-only report passes all 19 checks: cache ownership/modes/marker,
no symlink ancestors and initialization lock availability. Filesystem ownership
was unknown due to a report bug; its fix is locally validated. Full quit/reopen
does not help. The owner confirms ONE unavailable line and previously reported
Background service → Enable visible. No successful full desktop launch yet.
Do not repeat reinstalls/restarts or claim that cache corruption was found.

Read [the investigation](desktop-startup-040-diagnosis.md). PR270, branch
fix/desktop-bundle-startup, worktree REL/desktop-startup-fix, is the active fix.
REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/desktop-startup-fix-plan.json for exact head/checks/handles. It includes
stage's merged PR269 publication handoff. The previous de86fe44 head passed nine
checks; subsequent client/cache-diagnostic changes need fresh head checks.

The client previously fabricated notBundled when the JavaScript isTauri marker
was false. It now invokes native status unconditionally and preserves native
string errors. Three real-API/stubbed-bridge regressions fail with the old client
and pass with the fix. This is a candidate explanation of the owner's symptom,
not proof of their runtime marker state. Native constructor failures now retain
specific filesystem/cache/lock errors without disclosing paths or contents.
Validation: 21 payload tests pass, three opt-in skips; six entry tests and seven
renderer/client tests pass. The read-only report passes 20 checks on an isolated
fixture with byte/mode equality. See private diagnostic evidence for exact logs.

CI on 89bb45e failed three ManagedWorkspaceEntry assertions because they read
the first alert across all Settings sections. Full desktop now correctly reports
an absent native bridge in the browser fixture. Assertions are scoped to the
Managed workspaces section, and retry coverage verifies that its sibling desktop
alert remains intact. No product code was changed for this correction. The full
frontend suite now passes all 186 tests in 34 files; TypeScript and Vite production
build also pass. Required CI must pass on the subsequent pushed head.

Native capture returned cgWindowNotFound even for Finder. No released app or
host was launched for this attempt. No production data, permissions, caches or
installation was repaired/changed. Full parity remains incomplete. Complete CI,
review and merge the final PR head, then deliver a new patch release and verify
the actual ordinary launch. Never overwrite v0.4.0 or certify native UI from
unit tests. Keep the new desktop's primary-entry/discoverability work outstanding.
TestFlight 1.0.0 (4) and the 0.4.0 website publication remain completed delivery
work; do not redo them to investigate this Mac startup problem.


## Historical first 0.4.0 test — desktop entry is not discoverable

The owner updated, then deleted/redownloaded the app, and reports that Settings
shows version 0.4 but the app looks like the previous version. Inspection of the
published caf57b6 source confirms that startup still opens the original Root
interface. The new native desktop is reached only through Settings, below Claude:
Full desktop → Open full desktop. Background-service controls are immediately
above it. This is an integration/discoverability issue; reinstalling does not
change the default entry. Do not misdiagnose it as an old download based on looks.

The published artifact contains both verified desktop and service payloads, but
their presence does not establish that the new workspace opens on the owner's
Mac. No successful Full desktop launch, service setup or upgrade-retention result
has yet been reported by the owner. Explain the actual entry path, investigate
any launch error, and make the managed desktop accessible from the primary app
experience while preserving legacy sessions. Any code fix needs a new release;
do not replace the public 0.4.0 assets or mark full parity complete.

## Published baseline — Mac 0.4.0 and website published

On November 12, 2026 Pacific (November 13 UTC), the authorized Apple-silicon
Mac 0.4.0 release and website announcement were published and verified.
This does not mean full T3 parity, manual acceptance or normal installation passed.
The owner explicitly chose to test Mac UI/service/upgrade behavior after publication.

### Public release and source

- Release: https://github.com/BonJenn/blackcrab/releases/tag/v0.4.0
- Installer: https://github.com/BonJenn/blackcrab/releases/download/v0.4.0/Blackcrab_0.4.0_aarch64.dmg
- Updater: https://github.com/BonJenn/blackcrab/releases/latest/download/latest.json
- Public tag and release source: caf57b6fab1b4391836c6635882a15a88edfac0d.
- Successful workflow: https://github.com/BonJenn/blackcrab/actions/runs/43337173131
- PR267 and PR268 each passed all nine checks, merged to stage and were unwatched.
  PR267 fixes six mismatched npm/Rust Tauri pairs; PR268 makes the managed wrapper
  use the validated API credentials instead of simultaneously present Apple ID.
- Version 0.4.0 is stable/latest, not a draft. Never retarget, overwrite or rebuild
  this public tag to incorporate later changes. Use a new release version.

The DMG SHA256 is 211b5b8547a5b0d71fdeefc73fb6be4a47e6002a5e9ed18d195ace502d3d92fd
(336480293 bytes). The updater archive SHA256 is
d1d95f629cb2b15419d25302da6bbd9fb37531c9b85e7970641d3119750d6cc0.
Apple accepted app submission 7c58ba8d-a3a2-4f59-9314-48b1bad6276a and DMG
submission c6c76ade-9ff9-4d23-9ca8-fbe1723e447c. Developer ID team YF28W3NGG6.

Actual downloaded files passed GitHub asset digests, Root identity/version/arm64,
hardened Developer ID signatures, stapled tickets and Gatekeeper. The updater
cryptographic signature verifies with the unchanged v0.3.0 public key. Its
manifest advertises only the current Apple-silicon artifacts. The exact compiled
archive and manifest pins, inner desktop/service inventories and all native
signatures passed. The app inside the read-only mounted DMG is identical to the
updater app. The captured mount was ejected and removed; no app was launched.

### Website publication

Website PR12 merged to ff4c3442a53dc446a4a126ca9df79654b509571a. The existing
Vercel blackcrab-landing project on bonjenns-projects deployed production
dpl_4SvMsmqXhW99c23iykH3DWKRiHgc and assigned www.blackcrab.app / blackcrab.app.
This is the marketing site, separate from app.blackcrab.app.

- Home: https://www.blackcrab.app
- Blog: https://www.blackcrab.app/blog/blackcrab-0-4-0-managed-mac-workspace
- Changelog: https://www.blackcrab.app/changelog
- Releases: https://www.blackcrab.app/releases

The live homepage was visually inspected. Blog index/article, changelog and
releases returned 200 with the new content. Internal input ZIP is hidden from
user installers. Actual homepage button downloads verified the Mac 0.4.0 DMG,
Windows 0.3.0 EXE and Linux 0.3.0 AppImage against GitHub digests. An initial Mac
request returned a stale 0.3.0 download, then the normal route revalidated and
served 0.4.0; no purge or redeploy was needed. For future releases, account for
the website's five-minute data cache and verify actual buttons after publishing.
The owned preview tab is closed and its temporary downloaded copies are removed.

### Evidence and continuation

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
REL=P/mac-release-040-v2llrqsa. Keep these owned records; temporary paths may
disappear, so public release/CI/source evidence above is the durable reference:

- REL/plan.json and REL/published-release.json / published-tag.json.
- REL/final-artifact-verification-cr8kp25e/result.json: RELEASE_ARTIFACTS_VERIFIED.
- REL/website-publication-verification.json: actual public page/download proof.
- REL/release-workflow-caf57b6-{watch.log,result.json}: successful run.
- REL/OWNER-TESTING.md: manual steps mapped to the current UI labels.
- Release checkout REL/notary-auth-fix stays clean at the published source.
- Documentation checkout REL/post-release-handoff, branch
  docs/0.4.0-published-handoff; read REL/post-release-handoff-pr.json for its PR.

All build/validation handles are settled. No owned native app, service, simulator,
mount or preview tab remains running. The main dirty checkout/index and shared
caches were not modified. /Applications/Blackcrab.app was not replaced. The
owner can download/update on their work Mac and test; do not call it installed.

Next: record the owner's actual first-launch, service setup, desktop open/reuse,
quit/reopen, restart/stop/start, retained catalog/settings and upgrade results.
Use Settings → Background service and Settings → Full desktop → Open full desktop.
Fix concrete failures in isolated worktrees/PRs targeting stage. Preserve sessions,
pairings, credentials and the single-writer model; do not delete app data to test.

TestFlight 1.0.0 (4) is already VALID/IN_BETA_TESTING for the owner. The newer
branded Hermes export remains unpublished; mobile retention/reconnect/OTA,
off-LAN remote control and APNs acceptance still remain. Billing/public signup
and policy publication also remain in the broader plan. Do not reupload build 4
or describe this release as full parity. The overall finish line is validated
parity, a current normal Mac app installed and the iOS app in the owner's TestFlight.

## Historical checkpoint — correct mixed notarization authentication

The owner has authorized publishing Mac 0.4.0 and the website/blog/release notes.
They will test native UI/service/upgrade behavior afterward. Keep artifact and
updater checks; do not restore the native capture gate or ask approval again.
Full parity and normal Mac installation remain unfinished.

PR267 merged after nine passed checks to stage
cbf167200b740fab7fc34bb125b99dd95bf3c826 and was unwatched. The Tauri npm/Rust
version mismatch is fixed. Release run 43333392902 compiled the full optimized
0.4.0 binary and signed the Root app, then failed notarization with HTTP401.
Its API-key notarytool preflight passed. Tauri selected the older Apple ID/password
because both methods were present; its upstream notarize_auth checks Apple ID
first, including empty environment variables. Native code did not fail compilation.
The monitor shell 38476 is settled with exit1; no app/host was launched.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
REL=P/mac-release-040-v2llrqsa. Active checkout REL/notary-auth-fix, branch
release/0.4.0-notarization-auth from corrected stage cbf1672. Read REL/plan.json
and REL/notary-auth-fix-pr.json for current PR/head/checks and command handles.
The fix selects API auth in the managed release wrapper and deletes the legacy
Apple ID/password values from the spawned environment. Complete Apple ID-only
configuration remains supported, incomplete configuration fails early, and
updater/signing values remain intact. It neither rotates nor exports credentials.
Five auth regressions pass, including a real child-process environment check;
the focused release/resource/version suite passes 33 tests with three opt-in skips.
The existing frontend CI wildcard includes the new tests. No package graph,
native application source, signed inner payload or updater identity was changed.

Commit/push/link the correction PR, wait through watch (never PR polling), inspect
its checks/reviews and merge to stage. Then update a clean source checkout and
regenerate source-bound OWNER_TESTING_AUTHORIZED input ZIP in a NEW directory.
The old REL/release-inputs-cbf1672 package belongs to failed run 43333392902, not
the next corrected revision. Reuse the unchanged notarized inner payloads listed
below. Retarget the existing DRAFT v0.4.0 and replace its owned input ZIP/hash;
dispatch release.yml at the new stage SHA. No public v0.4.0 tag has been published.

REL/verify-final-artifacts.py is prepared, not passing evidence. Update its SOURCE
and workflow ID and REL/artifact-verification-plan.json to the next actual run
before executing it. It checks actual downloaded digests, updater cryptography,
Root identity/architecture/signature/ticket, embedded archive/manifest pins, all
inner payloads, DMG signatures and read-only mounted DMG/updater equality. It does
not launch/install the app. The updater verifier/public key are already available
in REL/updater-verifier. The key still matches v0.3.0. Preserve private keys.

Website PR12 remains draft at 45074e77ae990e71983a0d0f657461bed76eca03, with local
validation and both Vercel checks passed. After verified GitHub publication,
merge/deploy www.blackcrab.app using existing blackcrab-landing/bonjenns-projects
and verify pages plus actual Mac download and old Windows/Linux fallback.
No preview tab is open and no temporary access link remains. TestFlight 1.0.0 (4)
is already available; later branded export and remote/APNs acceptance remain open.
The dirty main checkout/index, shared caches and /Applications/Blackcrab.app are
untouched. The finish line remains validated parity, a current normal Mac build
installed and the iOS app available in the owner's TestFlight.

## Historical checkpoint — repair the first Mac 0.4.0 release build

The owner explicitly authorized Mac 0.4.0 publication and will test it afterward,
including the website/blog/release-notes workflow. This still supersedes the old
native window-capture hold. Do not ask for publication approval again or fabricate
PASSED lifecycle evidence. Full parity is not complete.

PR #265 passed all nine checks and merged to stage as
2dee535dce3398d360c61f729f6890cd864f4a15. A draft v0.4.0 exists at that source;
no public 0.4.0 release or normal Mac installation has happened. Its uploaded
blackcrab-managed-payloads.zip is 330197017 bytes, SHA256
6989edd5fc4ac97dd28aa4807696e851aa4a42a0481c3d2760f91560ffd0f43d.

The first release run failed before native compilation:
https://github.com/BonJenn/blackcrab/actions/runs/43328470434
Job 131566853528 passed Apple/updater credential preflights, actual notarized
payload verification, npm ci and signing-keychain setup. Tauri rejected six npm
packages newer than the major/minor lines of their locked Rust counterparts.
The original run watcher 89307 exited1 and is settled; do not rerun that old source.

### Current fix and exact continuation

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
REL=P/mac-release-040-v2llrqsa. Active fix checkout REL/tauri-version-fix, branch
release/0.4.0-tauri-version-alignment from stage 2dee535. Read REL/tauri-fix-pr.json
for the resulting PR/head/CI status and REL/plan.json for live release state.
The old integration checkout R/source remains clean at the failed stage source;
do not use it to prepare the corrected release without updating to the fix.

The fix pins these root npm packages to the existing Rust versions:
api 2.11.1, plugin-opener 2.5.4, notification 2.3.3, updater 2.10.1, dialog 2.7.1,
process 2.3.1. Cargo.lock and all unrelated dependency resolutions are unchanged.
A new check-tauri-versions.mjs guard checks both lockfiles in frontend CI,
before release payload processing and before native packaging. It rejects missing,
ambiguous or mismatched families. Tauri's own package check remains enabled.

The real failed release lock reproduces all six mismatches in the new guard;
the corrected lock passes. Regression evidence: REL/tauri-version-regression.json.
Portable tests: 28 passed, three explicit opt-in skips. Actionlint passes both
workflows. A fresh physical npm ci in the fix checkout passed; it does not use or
modify the main checkout's shared node_modules. Root typecheck/Vite build and actual Tauri CLI info both passed, with no package
mismatch. Results are under REL/tauri-fix-*.log. Handles 89685 and 27163 exited 0;
all local validation commands have settled and no owned process remains.

Next commit/push this correction as a PR to stage, link it immediately, review
required checks and merge the validated head. For a PR check wait, watch and end
the turn; do not poll. After merge, use clean corrected stage source to create a
NEW source-bound OWNER_TESTING_AUTHORIZED record and input archive in a new
REL/release-inputs-<source> directory. Reuse the unchanged notarized inner payloads;
no inner service/desktop source was changed by this fix. Update the existing DRAFT
v0.4.0 target to the corrected merge and replace only its owned input zip with the
new verified archive/hash. Do not republish old inputs or mutate a public tag.
Dispatch release.yml managed-apple-silicon at the corrected source with that hash.

Finish the actual signed outer app/DMG/updater build, verify signatures, tickets,
root identity/version/arm64, embedded payload manifests and updater cryptography,
then publish stable/latest v0.4.0. REL/artifact-verification-plan.json records the
checks, not passing evidence. REL/updater-verifier contains an isolated verifier
built offline from checksum-authenticated minisign-verify 0.2.5, the same crate
locked by the app. The existing public key and app identity match v0.3.0. No actual
0.4.0 updater archive has yet been verified. Never export its private signing key.

### Website and unchanged delivery evidence

Website PR #12: https://github.com/BonJenn/blackcrab-landing/pull/12
Checkout REL/website, branch release/0.4.0-website, head
45074e77ae990e71983a0d0f657461bed76eca03. Previous preview 642b68f passed browser
inspection of home/blog/changelog; the follow-up only corrects metadata. Three
download tests, TypeScript, lint and Next production build passed. Keep it draft
until actual signed Mac artifacts are public, then merge/deploy the existing
Vercel blackcrab-landing project / bonjenns-projects team to www.blackcrab.app.
Verify public home/blog/changelog/releases/Mac download and older Windows/Linux
fallback. This is separate from app.blackcrab.app. Temporary preview access was
revoked and the opened tab closed. No website production change has been made.

Final signed/notarized inner payloads remain:
/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads/{desktop,service-host}.
Developer ID Jonathan Benn / YF28W3NGG6; Apple Accepted submission
2958751f-0bbd-4d03-bc20-e805a52acfc2 covers all 37 native CDHashes. Exact manifest
hashes and source references remain below and in REL/artifact-verification-plan.json.
No owned native app/host/simulator is running. Preserve the main dirty checkout,
its index and shared caches. Keep private live handoff pointers current.

Mobile TestFlight 1.0.0 (4) is already VALID/IN_BETA_TESTING. The newer branded
Hermes export is not published; retention/reconnect/OTA/remote/APNs validation
remains separate ongoing work. Do not reupload build 4 or claim full parity.

## Historical checkpoint before first release build — Mac 0.4.0 publication

This checkpoint supersedes the older native-capture merge/publication hold below.
The owner explicitly said: “publish the mac release and ill test it myself. this
will be version 0.4”, followed by “go through the workflow of publishing it through
the website too and updating the blog and release notes and all that”. Version is
0.4.0 / v0.4.0. No further publication approval is needed. The owner will perform
manual Mac UI, service lifecycle and upgrade-retention tests after publication.
Do not claim those tests passed or that full parity is complete. Signing,
notarization, payload integrity and updater cryptography still require verification.

P = `/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes`.
R = `P/desktop-delivery-m6ki1jlt`; desktop source = `R/source`, branch
`parity/desktop-delivery-integration`, PR #265 targeting stage. Previous head
45479589bb742297c01084fe2f2833935b33f01e passed all nine checks, with no reviews
or comments. The 0.4.0 release revision is being committed on this branch; read
`R/integration-pr.json` for its exact current head and checks before merging.
Stage currently includes #266 at 49bedbd8196575ee0b1280c9d80803657b29159b.

REL = `P/mac-release-040-v2llrqsa`; website checkout = `REL/website`, repository
BonJenn/blackcrab-landing, branch `release/0.4.0-website` targeting main. Read
`REL/plan.json` for PRs, release/build identifiers and live publication state.
Vercel project blackcrab-landing / team bonjenns-projects serves www.blackcrab.app;
app.blackcrab.app is the separate hosted agent application. Do not confuse them.

### Prepared release and website changes

- Root package/lock, Tauri config and Cargo manifest/lock are version 0.4.0;
  bundle identity and updater public key remain unchanged.
- release-inputs.mjs accepts OWNER_TESTING_AUTHORIZED only for this exact tag,
  version, source SHA and recorded owner instruction, with all eight deferred
  lifecycle checks and no passing-checks object. Never manufacture PASSED.
- Managed release workflow now downloads the actual latest.json asset written
  by tauri-action before verifying it; that action does not leave a local copy.
- Portable release/resource suite: 24 passed, three explicitly opt-in skips.
  Actionlint 1.7.12 passes. New version changes do not alter signed inner payloads.
- GitHub release notes: docs/releases/v0.4.0.md. Website blog copy is mirrored in
  docs/blog/2026-11-12-blackcrab-0.4.0.md. Website blog/changelog/home/docs/releases
  identify Apple-silicon scope and outstanding manual/remote acceptance.
- Website download resolver preserves older stable Windows/Linux installers when
  latest is Mac-only. Three behavior tests pass. Production build and scoped
  ESLint passed; a standalone TypeScript test-import issue was corrected by
  using a .mjs Node test. Final validation logs/results live under REL.

### Next actions, in order

1. Finish local review, commit/push #265, link it immediately and mark ready;
   wait for required CI before merging to stage. Prepare the website PR too, but
   do not deploy its announcement before the real Mac artifacts are public.
2. Use clean committed merged stage source to create the exact source-bound
   OWNER_TESTING_AUTHORIZED record exported by release-inputs.mjs. Pack the
   existing notarized payloads; do not rebuild unchanged inner source blindly.
3. Create draft v0.4.0 targeting that source and upload blackcrab-managed-payloads.zip.
   Dispatch release.yml managed-apple-silicon with tag and independently recorded
   payload SHA256. Do not use the legacy root-only release mode.
4. Verify the actual signed/stapled/notarized outer app and DMG, embedded payload
   pins, updater archive and signature against the existing public key. Publish
   v0.4.0 stable/latest after these artifact checks. Owner manual tests follow.
5. Merge/deploy the website PR to the existing Vercel project; verify homepage,
   blog, changelog, releases and Mac download target in the shared preview, plus
   previous Windows/Linux links. Record release URL, deployment SHA and results.

The final notarized payload directory is:
`/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads`
with desktop and service-host children. Desktop manifest SHA256
fc1b886bb81e682f23106e2db3fbede4c45329d353d480805fe38cd4febbdd12;
host manifest SHA256 c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83.
Developer ID Jonathan Benn, team YF28W3NGG6. Apple's Accepted submission
2958751f-0bbd-4d03-bc20-e805a52acfc2 covers all 37 native CDHashes. Signed
archive roundtrip, stapling and Gatekeeper evidence are in R/notary-ticket-audit.json
and R/notarized-resource-roundtrip.json. Existing GitHub signing secrets are used
only by their intended workflow; never attempt to export the updater private key.

As of preparation, no final outer installer/updater is published and no normal
app has been installed at /Applications/Blackcrab.app by this work. No owned native
app/host/simulator is running. Final short website validation commands are tracked
in REL/plan.json; prior untracked command output was recovered from completed logs.
Never adopt a discovered PID as an owned process. Preserve the main dirty checkout
and index (last SHA256 eea7b021ea64188388c96b9e68693e9bbfbe10ecc682f9717c98ec7450c3155a).

Mobile: #266 is merged and unwatched. TestFlight 1.0.0 (4) is already VALID /
IN_BETA_TESTING for the owner; do not reupload it. The newer branded Hermes export
is prepared, runtime-matched and NOT published. Installed OTA retention, remote
and APNs validation remain separate ongoing work; Mac publication is not full
parity acceptance. The historical sections retain their exact evidence below.

## Historical checkpoint before owner publication instruction — 2026-11-12 21:24 UTC

This section supersedes historical live-state claims below. The owner prioritizes
background-service integration and a signed update for an existing Blackcrab app
on an **Apple-silicon work Mac (M-series)**. The owner is away from the build Mac;
do not ask them again to inspect/unlock its display now. Continue independent
release work. Full parity, ordinary Mac installation and remote acceptance are
not complete. TestFlight 1.0.0 (4) is already available to the owner.

### Current evidence and remaining gates

- Both production inner payloads are built. All 20 desktop and 17 host Mach-O
  signatures use Developer ID Application: Jonathan Benn (YF28W3NGG6), with secure
  timestamps and hardened runtime. Original artifacts remain unchanged.
- Apple accepted submission `2958751f-0bbd-4d03-bc20-e805a52acfc2`. Its actual log
  contains no issues. All 37 binary CDHashes match the notarization tickets.
  Desktop stapling and Gatekeeper pass. The actual native-resource archive
  roundtrip also passes signature, ticket and Gatekeeper checks after extraction.
- Combined Root QA compiled successfully: resource tests, root tsc/Vite, default
  cargo check, 13 QA denial tests, 6 service-owner tests and the debug QA binary.
- Actual Root UI acceptance is **blocked, not passed**. CUA returned
  `-10005 cgWindowNotFound` for both the fresh bundle ID and its exact app path.
  Fresh Finder captures also failed with the same error on the #265 and #266 wakes.
  App diagnostics reported one visible, non-minimized 2200×1560 window; that does
  not establish visual acceptance. The owner answered they are away.
- The captured Root controller was stopped cooperatively and exited 0. All
  captured cleanup passed. Zero service initializations, service actions, native
  children and provider commands occurred. No service was installed by this QA.
  `root-qa/native-ui-acceptance.json` does not exist. Do not fabricate it.
- No final normal Tauri app, signed outer installer/updater, ordinary installation
  or public release has been completed. `/Applications/Blackcrab.app` has not been
  updated by this work. The latest public version is still v0.3.0 from June 15.

### Active checkout and exact artifacts

P = `/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes`.
R = `P/desktop-delivery-m6ki1jlt`; W = `R/source`.
Branch: `parity/desktop-delivery-integration`. PR #265 remains OPEN/DRAFT.
Its previous head `4a635c7f73ef8945b395f227bf0a9905be36a745` passed all nine
checks with no review threads/comments. The branch is now incorporating merged
stage `49bedbd8196575ee0b1280c9d80803657b29159b` (#266); read
`R/integration-pr.json` for the resulting head and current CI/watch state.
Only both handoff files conflicted; they were resolved with the newer evidence.
The 17 service-producer inputs and patch graph still match the real signed build;
6 focused freeze/profile checks pass (1 optional fixture skipped), and the merged
mobile consumer verifies 23 packages / 3,170 files. Native lifecycle acceptance
still gates final merge/delivery. Do not merge merely because CI is green.
All 17 original desktop/service stack tips remain ancestors.

Do not change/reset/clean/switch/stage-all the main dirty checkout at
`/Volumes/G-DRIVE PRO/Programming/blackcrab`. Last verified main index SHA256:
`eea7b021ea64188388c96b9e68693e9bbfbe10ecc682f9717c98ec7450c3155a`.
Stage explicit reviewed paths only. Preserve all unrelated work and shared caches.

Production Electron: `R/desktop-production-artifact`, with
`desktop-production-result.json`. Service: `P/service-profile-build-7XbKuE/quarantine/artifact`.
Service controller `/private/tmp/blackcrab-service-delivery-wJ2lcU/service-profile-controller-bDE8cZ/plan.json`
completed successfully; final input/store/reference/metadata/Cargo checks passed
and children settled. The 17-module / 71-record source freeze is recorded and tested.
Signed copies: `R/developer-id-payloads`.
Final notarized copies:
`/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads/desktop`
and sibling `service-host`.
Final desktop manifest SHA256:
`fc1b886bb81e682f23106e2db3fbede4c45329d353d480805fe38cd4febbdd12`.
Final service manifest SHA256:
`c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83`.
Evidence: `R/notary-ticket-audit.json`, `R/notarized-resource-roundtrip.json`,
`R/inner-payload-notarization-run.json`, `R/developer-id-signing-run.json`.

QA source/build: `R/root-qa/source`, `root-qa/compile/compile-result.json`.
Fresh used QA identity: `com.blackcrab.desktop.root-entry-qa.n31e0815bab7aa86a`.
Captured QA root:
`/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/root-entry-ui-31e0815bab7aa86a`.
Read `R/root-qa/native-ui-capture-status.json` and the root's `parent-terminal.json`.
The old controller refuses an existing root. A later UI retry needs a fresh
reviewed identity/package; do not erase/reuse the previous journal as fresh proof.
No owned app, host or simulator remains active. Original handles 28186, 20453,
33721, 60816, 44062, 23434, 93054, 43230 and 27777 all settled successfully.
Earlier EXDEV and stale QA test nonce failures were corrected and retained.

### Release implementation now prepared

Read `scripts/macos-release/README.md` and paired guides. New tooling signs
immutable payload copies, notarizes/staples/re-inventories them, checks signatures
again after resource roundtrip, and prepares an independently pinned release-input
archive only with real lifecycle acceptance for the exact committed stage source.
The service-only resource-map omission is fixed; its actual service regression
passed 1/1, not just a fixture. Focused integration checks passed 18 with one
opt-in skipped. Portable release/resource suite passed 23 with three opt-in skipped.
Actual notarized resource roundtrip separately passed. All nine required PR checks passed on the previous head 4a635c7; the stage
refresh must pass its own CI before any final merge.

`release.yml` is now explicitly dispatched: managed Apple-silicon is default,
legacy root-only is an explicit alternative. Tag creation no longer triggers the
old root-only matrix. The managed job verifies its draft-release input archive,
builds aarch64-apple-darwin through the real resource wrapper and uses the existing
GitHub updater secret only in the intended Tauri job. Its updater metadata check
rejects stale non-arm64 entries or wrong signatures/URLs. The final release stays
DRAFT. This workflow has not yet produced a release; never claim otherwise.

Next: keep #265 draft until the actual native lifecycle is accepted. Inspect
R/integration-pr.json and current GitHub before any merge. Actionlint 1.7.12 passes
both workflows; 24 launcher/QA/freeze tests pass after the integration fixes. While capture is unavailable, independent release review
can continue. When native UI is available, verify first launch, service enable,
ready state, Electron open/reuse, normal quit with host survival, reopen retaining
identity/catalog, restart/stop/start and reconnection, then captured cleanup.
Only genuine positive evidence may satisfy the acceptance gate. After final
review/CI/merge, commit a stable version newer than 0.3.0 and create the reviewed
release-input archive. Build the signed outer app/DMG/updater, verify actual
embedded resources and updater cryptography, test normal installation and update
retention, then publish. Do not ship a universal app with arm64-only payloads.
Existing build-normal-root.py/install-normal-root.py still require actual native
acceptance and clean committed source; their earlier ad-hoc 0.3.0 recipe is not
public release proof.

### Mobile and cloud continuation

Mobile checkout: `P/mobile-owned-branding-4pdd465l/source`, branch
`parity/mobile-owned-product-copy`, head `996caea0e569f7669f6a49cd9d18c80620052e08`.
PR #264 merged to stage, all nine checks passed and it is unwatched. Do not rewatch.
57 recorded app-copy adapters passed 46 tests and app-only AST audit. Its iOS
export completed; runtime exactly matches accepted build 4:
`2cbb84d9fbdb180f1af5bfe3e049108c47d628cb`.
Export: `/private/tmp/blackcrab-ios-Rymkpu/artifacts/branding-update-export`.
It is NOT published. Actual bundle audit found 27 T3 Connect / 36 T3 Code byte
occurrences in shared runtime. Read the mobile parent's
`runtime-product-copy-findings.json` and `update-export-artifact-audit.json`.
The follow-up is implemented in `P/mobile-shared-product-copy-lymbt5zd/source`,
branch `parity/mobile-shared-product-copy`. PR #266 merged into stage as
`49bedbd8196575ee0b1280c9d80803657b29159b` after all nine checks passed and
no reviews/comments remained. It is unwatched. The mobile checkout fast-forwarded
to that stage merge; only synchronized handoff edits remain afterward. Do not
create another PR for the already merged product-copy source.

There are 24 recorded shared-runtime copy patches. Connection/relay errors,
project actions, schemas and provider settings use Blackcrab names. The inherited
paid T3 Chat upsell is removed; the error reports the actual maximum and unlink
recovery action. No quota enforcement or paid tier was invented. Genuine T3 Chat
and T3 Code for GitHub integration names, protocols and schema URLs remain.
The consumer now reconstructs type/cloud/copy layers in order and retains the
earliest authenticated original when cloud and copy overlap on promptLinks.ts.

Fresh preparation: `/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/mobile-shared-copy-1hvp4u1l/preparation`;
its sibling `consumer` was independently verified and copied to the isolated
worktree. Current consumer verification: 23 packages / 3,170 files. Generated
mobile UI: 3,237 files. The previous consumer is retained at the parent
`previous-consumer`. Do not hand-edit any vendor manifest.

All 87 scoped experience/activation tests pass (83 passed initially; the four
compiler failures were local dependency setup, then all five compiler tests
passed using the current physical dependency tree). Mobile tsc --noEmit passes.
The new graph-wide literal audit finds no unexpected T3 Code/Connect/Account
product text in reachable shared packages. Evidence: parent
`consumer-generation-result.json`, `mobile-experience-retry-tests.log`,
`react-compiler-current-tests.log`, `mobile-typecheck.log`, `generated-ui.log`.
Dependency links are private/read-only and point @t3tools to current source;
shared caches and the dirty main index remain unchanged. No native app/host/
simulator or build is active. The original consumer-generation handle was lost
in compaction; imported-thread recovery returned thread_not_found. Its complete
output verified twice and a read-only command check found no running build.
No process control was recovered from PIDs.

Actual current export is now complete from merged stage 49bedbd, in a fresh
physical source/dependency copy. Original captured exporter handle 22724 exited 0;
no app or simulator was launched and nothing was published. Exact source,
dependency, private-log and output paths are recorded in parent
`shared-copy-export-result.json`. Script: `export-shared-copy.mjs`.
Export root: `/private/tmp/blackcrab-ios-4AS02K/artifacts/shared-copy-export`.
Hermes bundle: `_expo/static/js/ios/index-68db308912533f7c7d59071c5b5904b9.hbc`,
23,309,236 bytes, SHA256
`937094df9fef008f0cebf2ae66d6d1fe6a9f44eb25b70e8c7f51eb6d08bb9d44`.
Native runtime exactly matches accepted TestFlight build 4:
`2cbb84d9fbdb180f1af5bfe3e049108c47d628cb`.
Actual byte audit passes: Blackcrab Account 1, Blackcrab Connect 37, Blackcrab
Remote 5; T3 Account/account and T3 Connect 0; T3 Code 1, exactly the genuine
T3 Code for GitHub name. The inherited paid-tier upsell is absent. Audit script
`audit-current-export.mjs` and `current-bundle-audit.json` preserve the evidence.

Next mobile gate: validate a compatible installed update, retained drafts/outbox,
reconnect and rollback on an owned test installation before production OTA.
Follow docs/mobile-updates.md. Matching source/runtime and successful Hermes
export do NOT prove download, installation, retention or native acceptance.
Do not publish the historical Rymkpu export; this fresh export supersedes it.

TestFlight 1.0.0 (4): VALID / IN_BETA_TESTING, owner available in Blackcrab Internal
Release. App 6780360079, bundle dev.blackcrab.remote, team YF28W3NGG6,
build UUID 0003ebb6-c832-452d-92f9-d3ff9bb0d867. Do not upload build 4 again.
Evidence: `P/ios-device-release-102m5jw4/testflight-delivery-verification.json`.
Accepted IPA: `/private/tmp/blackcrab-ios-bDCQj6/artifacts/export-candidate-tHj97G/export/BlackcrabRemote.ipa`.
SHA256 `cc350063805b35ab55b78d5225b72b648ca417bf4868a06ca9d3b0be0770d2df`.
Expo project 33fb14fd-4b87-4e85-920c-b6d4204e4567, owner bonjenn, production channel.
The old rejected export lost capabilities and must not be uploaded. Native
branding update installation, data retention/reconnect and rollback remain unverified.

Cloud/DNS/account setup is complete for existing scoped work; the user explicitly
authorized existing keys and up to $30/month base plus metered usage. No renewed
rotation hold. Relay/database health, OAuth metadata and unauthenticated rejection
passed; app.blackcrab.app root/deep-link/JS/AASA return 200. Signed-in/off-LAN/provider
and APNs acceptance remain unproven. Do not print secrets. The five PUBLIC client
values are in `/private/tmp/blackcrab-clerk-setup-gjrvqjqi/blackcrab-client.env`;
other files there can contain secrets. Legal/privacy/terms/security pages remain
404 and public-release work is unfinished.
Accepted product model: free local/self-hosted open source, public endpoints,
invite-only hosted beta, then server-enforced entitlements/quotas/cost controls.
HS01–HS06 are planned, not implemented; read the desktop worktree
`R/source/docs/hosted-service-plan.md` (awaiting integration through #265).

Keep paired guides byte-identical and both handoffs current. No new unasked
agents/threads/goals. Control only original captured children, never recovered PIDs.
Use CUA for actual UI; do not substitute backend calls for window acceptance.
Link a created/pushed/taken-over PR as the next tool call. Watch and end the turn
when the authorized merge waits on checks/review; do not poll. Unwatch before
handing the work back to the owner. Read `R/integration-pr.json` for the current integration watch/check state.

## Historical checkpoints and supporting evidence

The following dated material preserves provenance. Its old live-process, stage,
PR and next-action claims are superseded by the current checkpoint above.

## Accepted hosted-service plan — 2026-11-12

The user approved adding the open-source plus paid hosted-service model to the
plan. Follow [hosted-service-plan.md](hosted-service-plan.md): free local and
self-hosted use; official releases with explicit public endpoints; invite-only
hosted beta; server-enforced subscription access, quotas and cost controls before
public paid signup. HS01–HS06 remain planned/unverified. Prices and payment
provider are undecided; no live billing or signup setting was changed by this
planning update. Keep the current Mac installation/TestFlight owner trial ahead
of public paid launch. The parity and mobile plans, G8/X10 ledger extension and
paired root/cloud guides now reference the same direction.


## Desktop delivery continuation — 2026-11-12

The user asks: “finish the desktop app and ill test testflight today”. TestFlight
1.0.0 (4) is already available to the owner. Do not re-upload that build.
Desktop delivery is actively being completed in the owned worktree
`P/desktop-delivery-m6ki1jlt/source`, branch
`parity/desktop-delivery-integration`, from stage `25bc6985ca95c443ad6a6a812289f831763d5755`.
Local merges combine PR #215, the #223–251 desktop chain, the #217–237 service
chain and #234 resource-profile changes. All 17 reviewed live tips are ancestors
of the integration head (stack-ancestry-review.json), including the moved #232
head. No new PR has been created yet.
`P/desktop-delivery-latest.json` and this directory's `plan.json` identify it.

The combined source now prepares 74 desktop, 40 direct-host and 71 service
patches. A three-way launcher patch refresh preserves #260's queued-stop timer
fix; production/native QA descriptor fixtures preserve existing environment IDs.
Five real-source composition tests, 75 desktop/launcher/controller tests,
root typechecking, 182 root renderer tests, and production Rust cargo check
passed. Host/controller checks passed 88 tests with one source fixture skipped;
that real-source composition fixture passed separately. The producer now runs full
upstream desktop AND web typechecking before packaging.

The first QA build caught lost React type peers in secondary dependency-cache
overlays. The producer now preserves DefinitelyTyped dependency edges, covered
by a real TypeScript module-resolution regression. The prior PR #215 dependency tree was missing a compiler bridge file, so it
was rejected. QA attempt 3 uses the original verified primary/secondary caches
with the type-edge fix and all five Blackcrab public cloud settings. Both full
desktop and web typechecks now pass. Inspect `desktop-qa-attempt-3-result.json`
and its original process handle before restarting. Failed first output is preserved; never treat it as
an artifact. Producer service input freeze remains historical until a fresh
successful controlled build records its new 17 code inputs and 71 patch records.

The service controller now accepts an optional strictly public cloud environment;
it rejects secrets/process settings and includes the configuration and all code
imports in its prepared input fingerprint. `service-build-plan-pointer.json`
points at the prepared plan. Service attempt 1 was interrupted through its original shell handle 94616
because serial small-file cache I/O on the HFS hard drive was excessively slow.
Its read-only audit completed with reference, metadata and Cargo seed unchanged; no output was built or adopted. Do not adopt PIDs.
The controller now batches 16 file operations while preserving ordered hashes,
all source/destination checks and settlement of started I/O on cancellation.
Seven cache tests pass, including ordered output and cancellation. Attempt 2 is running through original handle 10664 with plan
`/private/tmp/blackcrab-service-delivery-RlzEHX/service-profile-controller-o5afLo/plan.json`;
inspect service-build-attempts.json and service-build-plan-pointer.json before restarting. The normal desktop package is complete and verified; original handle 99986 exited 0.
Its manifest is 67bdb5fdbacb9c2eb74116bcc659f5846fc145cd2e653affcff05d35382e5e2b
and all 3,348 packaged files and the strict signature passed. See desktop-production-result.json. QA attempt 3 is complete,
verified and unlaunched: manifest cfb17e2d591890793d2b43d538664f93396bbe097ec389bf5071dc6622dfa659,
nonce fe7a14e74ad2396b. Native Root acceptance is still pending. Production Rust service-control tests
passed all six fixed-target/ownership/publication/serialization scenarios.
The five upstream desktop suites passed 119 tests using only two renamed
Blackcrab app-link fixture strings; production code and assertions were unchanged.
See upstream-desktop-owned-links-result.json. The original T3-link fixture failed
as expected against the renamed protocol and is preserved unchanged.

A first-launch review found that opening a fresh service-backed desktop before
explicit service setup could persist direct ownership. The current native fix
refuses that implicit direct start before artifact extraction/configuration and
points to Enable background service; existing selections are unchanged. Service
controls now appear before Full desktop. The isolated QA overlay has the same fix.
The native regression passes, and all 14 focused UI tests pass across the single-worker/retry reports in first-launch-* logs. Initial UI workers
hit startup timeouts, so the retry uses one thread worker without raising the timeout.
The separately prepared QA desktop archive hit its 30-second codesign deadline;
qa-signature-diagnostic.json records a successful strict check taking 157 seconds on HFS. A private APFS copy will be fully reverified for the archive.
The build-only strict codesign deadline is now bounded at five minutes, with distinct timeout errors; all signature/nonce/manifest gates remain mandatory. This verifier-only adjustment does not alter the already built payload bytes. See qa-signature-gates-tests.log.

Native CUA successfully captured Finder this session, clearing the old universal
cgWindowNotFound blocker. The new `root-qa/source` is a clean three-way application
of the isolated test harness to current code (22 files, zero conflicts). It still
needs fresh artifact pins, a fresh fixed identity, compilation, actual original
Root UI acceptance and captured-child cleanup. Do not launch the old harness
or count Finder capture as Blackcrab UI acceptance.

Hosted production was promoted to `https://app.blackcrab.app` using the already
validated deployment `dpl_9hAgt9zC3Zw38ZW1mHfe7FS2qZMh` in project blackcrab-app.
The owned domain is verified; both aliases completed. Root, thread deep link,
entry JS and iOS association file return 200; the association names
YF28W3NGG6.dev.blackcrab.remote. See `hosted-promotion-verification.json`.
The apex landing site is unchanged. Live signed-in remote operations remain
unverified. Older “READY UNALIASED” paragraphs below are superseded.

Next: finish the QA/full production desktop and controlled service artifacts;
refresh build freeze only from successful evidence; compile and exercise the
current isolated Root UI and service lifecycle; publish the coherent integration
PR, merge after checks; package/install ordinary Blackcrab.app and verify launch.
No ordinary current Mac app is installed yet. Preserve the dirty main checkout.


Snapshot: 2026-11-12 16:16 UTC, after TestFlight delivery. This is a continuation checkpoint,
not a completion report. Recheck mutable GitHub/account/filesystem facts before
acting. Root and directory AGENTS.md/CLAUDE.md files are paired guidance.

## User's actual objective

Compare Blackcrab with the user's BonJenn/t3code fork and deliver all applicable
desktop and remote iOS functionality. Preserve Blackcrab's existing app/data.
The user authorized coherent PRs merged to stage, asked to continue until parity,
and now explicitly wants the current Mac app installed and the iOS app in their
TestFlight before they try it. They also requested these matched agent guides
and a comprehensive copyable prompt before context/token exhaustion.

Do not hand back a plan, a stack of green PRs, an older QA bundle, or an unsigned
simulator app as the finished product. A complete delivery needs scenario
evidence, a normal installed Mac build, and a processed, accessible TestFlight
build. Be candid about remaining functionality and operational blockers.

## Read first and authority

- [Root agent guide](../AGENTS.md): working rules, architecture and toolchains.
- [Parity plan](t3-parity-plan.md), [scenario ledger](t3-parity-ledger.md),
  [mobile plan](mobile-ios-parity-plan.md),
  [host architecture](independent-host-architecture.md).
- [Native iOS build guide](native-ios-build.md),
  [managed host](../managed-host/README.md),
  [mobile source integration](../mobile-experience/README.md).
- [Copyable continuation prompt](agent-handoff-prompt.md).

The upstream reference is BonJenn/t3code commit
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`.
Reference archive SHA-256:
`eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6`.
Reuse its backend/contracts/client source with recorded Blackcrab adapters;
do not restart by implementing a second domain backend.

The broad ledger has 144 grouped scenario obligations. Its historical rows are
not a current implementation percentage. Several old pending paragraphs have
later, narrower positive evidence. Use the newest scoped result and actual
stage ancestry, not the first matching historical sentence.

## Working directories and live work

Main checkout: `/Volumes/G-DRIVE PRO/Programming/blackcrab`.
Evidence root (P): `/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes`.
Combined-work directory (D): `P/combined-parity-_s49gx2k`.
Expand P/D literally before using a path; they are documentation abbreviations,
not assumed shell variables.

The main checkout is extensively dirty, including tracked and untracked parity
implementation. Preserve it. Main index SHA-256 at this checkpoint:
`eea7b021ea64188388c96b9e68693e9bbfbe10ecc682f9717c98ec7450c3155a`.
Revalidate before relying on that value; user changes can legitimately alter it.
Do not reset, clean, checkout another branch there, or stage all files.

Current isolated browser integration worktree:
`P/pr215-stage-551qbofv/source`, clean at
`b4edea278ee710a3de6bdb9fd9778cd722cb8a8a`.
Guidance PR #261 is merged to stage at
`b512cc0ab53d1302694c0bf2965cd4b798f7dcb4`; all nine checks passed and its watch
was stopped. The original guidance worktree is `P/parity-agent-handoff-pzvormc3/source`.

Current release worktree (W): `P/ios-device-release-102m5jw4/source`, branch
`parity/ios-device-release`, based on that stage commit. Release evidence (R)
is its parent `P/ios-device-release-102m5jw4`. Release helper/config/guides are
published in PR https://github.com/BonJenn/blackcrab/pull/262. Native release
acceptance is complete; the final documentation revision needs its own CI result.
`R/release-pr.json` records the latest published head. Its initial frontend CI
failure was a stale `assert(!c.owner)` expectation after configuring the verified
Blackcrab Expo owner. The corrected test requires `bonjenn` and retains the
disabled-by-default service/update assertions. All 52 activation/root-shell
tests pass locally using the prepared Node 26.12.1 / Expo 58.0.14 dependency tree.
All nine checks passed on 12236e32f03395a39b3e113c81368ce2556f7cf3 in run
43192800373, and the signed-export gate subsequently passed. Recheck the latest
PR head/checks after this handoff update; the old CI watch was stopped.

No native compile, export or upload is running. Apple validation and upload
passed; captured shell session 92016 exited successfully. Version 1.0.0 (4) is
VALID and IN_BETA_TESTING, with export compliance complete and access verified
for the owner's existing tester account. Evidence is
`R/testflight-delivery-verification.json`. Do not upload build 4 again. The Release
arm64 iphoneos archive passed:
`/private/tmp/blackcrab-ios-bDCQj6/artifacts/device-attempt-3/BlackcrabRemote.xcarchive`.
Prepared workspace: `/private/tmp/blackcrab-ios-bDCQj6`; all 3,380 frozen inputs
were checked before compilation, with only recorded app.json build-number/team
overrides. The current helper's producer hash is separate from that snapshot.
The first exported IPA lost capabilities and must NOT be uploaded. The corrected
export passed after the owner linked the App Group; see the distribution section.
`R/run-verified-export.mjs` copies the successful original archive before using
the latest helper. `R/current-export.json` names the latest attempt:
`/private/tmp/blackcrab-ios-bDCQj6/artifacts/export-candidate-tHj97G/`.
`R/device-export-blocker.json` retains the historical 401 responses before the
owner linked the group; it is superseded by the accepted export report.
No certificate was revoked. The earlier owned temporary signing keychain was
cleaned up; the current exporter uses automatic cloud-managed signing without
importing the P12. Do not terminate unrelated Xcode processes or adopt PIDs.

Older cancelled commands remain cancelled. Some older `/private/tmp` paths are
absent. Recheck existence and hashes before reuse. Last internal free space was
12 GiB; DerivedData is on G-DRIVE. Use one heavy native build at a time and do
not delete shared caches or user data for space.

## Integrated work and current merge state

Last verified stage: `0165cdd541ed480075aa26d3d74b5fc4dc13fc36` (including #263).
PR #263 fixed the inherited Hyperdrive pool limit from 40 to the account's
supported 20; all nine checks passed and it merged. The database, runtime role
and connection were provisioned, then the complete relay deployed successfully.
Evidence: `P/cloud-hyperdrive-limit-7xyd6j7j/merged.json` and
`P/cloud-release-latest.json`. No further watch is active for #263.
Many mobile/cloud increments through #260 are merged. Not every numbered PR
is merged: the desktop and background-service chains below remain open.

Recent completed integrations include:

- #241: app-lifetime legacy mobile queue ownership and recovery-write fencing.
- #242–247, #250: owned cloud/link/hosted-web configuration and smaller backend
  sizing. These are code/configuration integrations, not live cloud delivery.
- #248: composer shows missing provider/project setup instead of a false
  disconnected state; retains historical bounded Root/native UI evidence.
- #249/#252: owned Live Activity and isolated native build inputs.
- #253–256: bounded combined/current-service iOS catalog, rename/archive, cold
  reconnect and foreground recovery evidence.
- #257: explicit owned Expo project/channel configuration and original update
  lifecycle. Live production OTA delivery remains unverified.
- #258/#259: service revocation/recovery evidence and connection accessibility
  semantics. Physical-device spoken VoiceOver is not certified.
- #260: strict durable legacy storage, populated upgrade evidence, and an actual
  launcher shutdown race fix. An in-flight ownership transition could install
  a keepalive timer after stop first cleared timers; queued stop clears it again.

### #215 browser and normal bundled entry

PR: https://github.com/BonJenn/blackcrab/pull/215
Branch: `parity/desktop-native-browser-and-bundle`; base: `stage`.
Head: `b4edea278ee710a3de6bdb9fd9778cd722cb8a8a`.
All nine checks passed in run `43170196210`; no reviews, review threads or
comments were present. GitHub reported CLEAN/MERGEABLE. It remains DRAFT and
UNMERGED because current combined native Root acceptance is incomplete.
The watch was explicitly stopped after the green-check wake; do not assume a
new wake is scheduled without actual pending work and an appropriate watch.

Latest local integration applied all 70 desktop registry records. Complete
desktop and web Effect/TypeScript checks passed, together with 62 focused
desktop/launcher tests and 64 cloud-client tests (126 total). Before that, the
bridge repair also passed 64 actual original preview Manager tests; two real
regressions failed the older implementation. Do not double-count repeated tests.

Important fixes to preserve:

- Effect callbacks use runners bound to the captured service context.
- Browser JSON uses schema codecs instead of throwing JSON parsing in Effect.
- Browser retirement/detach cleanup survives cloud integration.
- Owned hosted/pairing link patches retain strict envelope validation.
- All prior 69 records were retained exactly; the stage composer record is #70.
- Stage's queue/storage and launcher timer changes are included.

Evidence: `P/pr215-current-stage-tdxlleu5/result.json`,
`current-head-ci.json`, `native-capture-recheck.json` and validation logs.
Earlier bridge repair: `P/pr215-stage-551qbofv/cloud-typecheck-jmwd34n8/`.
The fresh prepared source path is recorded in
`P/pr215-current-stage-tdxlleu5/prepared.json`; verify it before reuse.

### Pending stack map (recheck before each merge)

| PR | Current parent/base branch | Scope |
| --- | --- | --- |
| #215 | stage | Native browser and bundled full-desktop entry; draft |
| #223 | parity/desktop-native-browser-and-bundle | Native OS HOME/private state; draft |
| #224 | parity/desktop-native-os-home | Isolated native-keychain QA producer; draft |
| #226 | parity/native-keychain-qa-producer | Secondary desktop runtime dependencies |
| #228 | parity/desktop-secondary-runtime-closure | Full upstream desktop type fixes |
| #230 | parity/desktop-full-typecheck | Sealed QA native lifecycle evidence |
| #251 | parity/desktop-native-lifecycle-acceptance | Cross-volume/temp-alias packaging |
| #217 | parity/desktop-native-browser-and-bundle | Owned service publication; draft |
| #218 | parity/owned-service-publication | Ownership proof/identity; draft |
| #219 | parity/service-ownership-proof | Native-issued service bootstrap; draft |
| #231 | parity/owned-service-bootstrap | Complete offline service producer |
| #232 | parity/service-profile-reproducible-build | Native service attachment |
| #233 | parity/desktop-service-attachment | Existing environment identity |
| #234 | parity/desktop-existing-environment-identity | Native service resources |
| #235 | parity/desktop-existing-environment-identity | Fresh service initialization |
| #236 | parity/native-fresh-service-initialization | Native OS service controls |
| #237 | parity/native-background-service-controls | Native service/browser bootstrap; draft |

Do not merge all draft parents based on a child's green CI. Compare exact source
and evidence, resolve genuine conflicts, validate each coherent integration and
update the base when appropriate. Preserve both browser and service fixes.

## Native evidence and blocker

The older sealed Root QA app based on
`3e74740f36829abfa2f9626abe35b1f28194074a` passed four actual Settings → Full
desktop launches, authenticated clients, retained preference/draft/browser state,
normal menu quits/reopen and captured cleanup. Provider runs/sessions were zero.
Committed result: `managed-validation/root-native-ui/acceptance-result.json`.
That does not certify the newer combined cloud/service build or the later
composer correction inside a rebuilt native app.

The 2026-11-12 native capture recheck still returned
`Computer Use server error -10005: cgWindowNotFound` even for Finder.
The previous combined Root/service attempt also failed capture through bundle
ID, bundle path and display name, then closed its captured Root cleanly with
zero host/native opens. No current normal-entry UI acceptance was substituted.
See `D/root-service-qa-preparation/ui-attempt.json` and
`P/pr215-current-stage-tdxlleu5/native-capture-recheck.json`; the latest check is
also recorded in `R/native-capture-recheck.json`.

Recheck capture capability before launching a new expensive UI validation run.
An unlocked visible desktop may help, but missing permission/lock state has
not been established as the cause. Do not tell the user a guess is a diagnosis.
Do not use API-only calls as proof the actual original button worked.

Installed iOS evidence includes catalog/rename/archive against exact packaged
hosts, cold/foreground reconnect, revocation recovery, accessibility state and
populated legacy upgrade. The latter used baseline
`d1d4d2741a9ffece4b1cf79a5255f667f535fd1e` and candidate
`8254c98fb614181512e95ca7d8422cfacfb5a74e`; four native phases passed with
two saved hosts, three drafts, one pending queue record, explicit original-ID
retry and zero automatic resubmits/provider runs. These are simulator/fixture
results on combined candidates, not current stage/physical/off-LAN certification.

## Cloud: authorized, completed and blocked

Owned domain: blackcrab.app; intended app origin https://app.blackcrab.app.
Cloudflare Workers/R2, Clerk, PlanetScale Postgres and Axiom are the chosen stack.
User approved up to $30/month base plus metered usage; live pricing was reverified on 2026-11-12: AWS us-west-2 PS_5 HA is $15/month
and Workers $5/month, totaling $20 base. Recheck if sizing changes.

Completed owner actions: Vercel team access, Clerk free-plan terms, Axiom
ownership claim, Cloudflare authorization including Secrets Store read/write,
R2 activation, and the GoDaddy nameserver change.
Public parent delegation and Cloudflare resolver now return
`beau.ns.cloudflare.com` and `khloe.ns.cloudflare.com`. All ten original DNS
records had been copied/verified; do not repeat the old request to change DNS.
Cloudflare API activation status should still be refreshed before deployment.

On 2026-11-12 the user explicitly instructed using the existing credentials,
superseding the earlier Clerk rotation hold. PlanetScale and Axiom old
credentials were revoked and replacements checked after a prior diagnostic
exposure. Use the current private stored keys for the authorized deployment.
Do not print credential values or request rotation again as a prerequisite.

Current cloud implementation and deployment evidence:

- Current deployed relay source: `/private/tmp/blackcrab-hyperdrive-tIMNMT/blackcrab-managed-source-bdMc2N`.
  All 133 source files and 18 patches were verified; frozen install, full
  typecheck and 36 files / 324 tests passed. See its sibling validation/result.json.
- Private setup directory (C): `/private/tmp/blackcrab-clerk-setup-gjrvqjqi`.
  `run-relay-deployment.py` supports plan/deploy and targeted database modes.
  The full plan passed (24 creates, one zone adoption). Official Alchemy
  planning bootstrapped the encrypted `alchemy-state-store` Worker/Secrets Store.
- The owner updated PlanetScale billing. Database blackcrabconnectrelay and its
  runtime role were created. Hyperdrive initially rejected 40 connections, then
  succeeded at 20 with #263. No duplicate database was created.
- The owner approved account_api_tokens:create at 15:51:51 UTC. Scoped tokens,
  relay Worker, queues, storage and telemetry resources were then provisioned.
  `C/relay-deploy-latest.json` reports PASSED. The live relay is
  https://relay.blackcrab.app; its health endpoint executes SELECT 1 and returns
  200, OAuth metadata has the owned issuer and DPoP requirement, and an
  unauthenticated environment request returns 401. See
  `P/cloud-hyperdrive-limit-7xyd6j7j/relay-live-acceptance.json`.
  Refresh existing grants when needed; do not ask for completed scopes again.
- Hosted app was built from current pinned source and uploaded successfully to
  Vercel project blackcrab-app under bonjenns-projects with --prebuilt --prod
  --skip-domain. Deployment `dpl_9hAgt9zC3Zw38ZW1mHfe7FS2qZMh` is READY:
  https://blackcrab-24ppiaw36-bonjenns-projects.vercel.app . It has no aliases;
  the existing landing domain was not promoted/replaced. Root and thread
  deep-link HTML return 200. AASA returns 200 and names the intended iOS app.
  Evidence: `R/hosted-deployment-verification.json`, `R/hosted-web-artifact`,
  `R/hosted-release-build.json`, `R/hosted-artifact-files.json`.

The relay/database are deployed and basic live checks pass. This and staged
hosted HTML are not end-to-end sign-in or remote-control proof. Remaining evidence includes
sign-in, host registration, pairing, off-LAN encrypted agent operations,
revocation/reconnect and push/background delivery. An existing APNs key for
team YF28W3NGG6 was found, linked to Blackcrab in EAS, and configured privately
for production relay use. No notification was sent; live delivery is unverified.
See `R/apns-preparation.json` and `C/blackcrab-apns.env` (never print its values).
PlanetScale billing and Cloudflare permission are no longer account blockers.

Read only the needed private setup records; never print environment/key files.
`C/database-current-budget-preflight.json` records live pricing.
`C/relay-deploy-database-latest.json` records successful database/connection setup;
`D/cloud-provisioning/setup-plan.json` retains setup history. Older rotation
hold strings are superseded by the user's explicit existing-key authorization.

## Mac installation and TestFlight

The latest parity changes have NOT been installed as a normal Blackcrab.app.
No ordinary Blackcrab app was found in /Applications or ~/Applications during
the bounded check. Old Blackcrab QA/Entry QA bundles exist under the main
checkout's target/debug/bundle/macos; do not tell the user these are current.

Apple/Expo access was verified without asking for new credentials:

- Personal Apple team YF28W3NGG6; existing App Store Connect app 6780360079,
  Blackcrab Remote, bundle dev.blackcrab.remote. Version 1.0.0 (4) is now
  uploaded, processed and available for internal testing. Build 3 is expired.
  Do not create a duplicate app or reuse build number 4.
- The existing Team (Expo) automatic group did not expose the new build and
  rejects explicit assignment. A manual internal group, Blackcrab Internal
  Release (`e0956911-71d7-4b8e-a339-7c846bd673b7`), now contains build 4 and
  the existing account-holder tester. No new tester was created. API readback
  confirms groupHasBuild, accountHolderIsTester and IN_BETA_TESTING. The tester
  record's INSTALLED state predates this release; installation of build 4 on
  the user's phone is not yet observed. The old automatic group is unchanged.
- Existing Expo project @bonjenn/blackcrab-remote,
  33fb14fd-4b87-4e85-920c-b6d4204e4567; account bonjenn already signed in.
- EAS cached CLI under `/Users/jonathanbenn/.npm/_npx/6bc7bae5c2059953/node_modules/eas-cli`
  has the intended APP_STORE credential and submission key. Its local P12
  identity is iPhone Distribution: Jonathan Benn (YF28W3NGG6), valid through
  2027-02-16. Automatic Xcode export instead uses the existing cloud-managed
  Apple Distribution certificate, SHA-1
  `0ED8DF3FAF6BFA5A4AEA6440ADBAEA89310531D2`, valid through 2027-09-25.
  Both belong to the same intended team; no certificate was created or revoked.
- `R/expo-release-access.json`, `R/apple-release-app.json` and
  `R/signing-preparation.json` contain bounded metadata/private file pointers.
  Owner-only key and certificate files are outside Git in
  `/private/tmp/blackcrab-ios-signing-mXDclq`; do not print them or passwords.

The working release helper adds iphoneos archive/export separately from the
simulator mode; 19 focused helper tests pass. The Release archive succeeded.
An initial automatic export also completed, but inspection found it silently
dropped push, app groups, Sign in with Apple and associated-domain entitlements.
Do not upload `device-attempt-3/export/BlackcrabRemote.ipa` even though it is signed.
The corrected producer ad-hoc signs the archive's frameworks/extensions/app
with generated capabilities before Xcode export, then checks all capabilities,
the actual expected certificate/team, all three bundle IDs and build number 4.
It rejects the real stripped-entitlement regression in the focused tests.

Apple account setup and signed export now pass:

- Main bundle ID `SZ6PPG34P8` and extension IDs `RXPA6QBRK7` / `K4B8S96VB4`
  are registered. Required capabilities were enabled and read back through the
  API: App Groups on all three; Push Notifications, Associated Domains and Sign
  in with Apple on the main app. `R/apple-capabilities-verified.json` records this.
- The owner confirmed `group.dev.blackcrab.remote` is linked to all three
  identifiers. Xcode's next automatic export succeeded with the existing key.
  The prior App Group lookup 401 and invalid profiles are historical failures.
- Accepted IPA: `/private/tmp/blackcrab-ios-bDCQj6/artifacts/export-candidate-tHj97G/export/BlackcrabRemote.ipa`.
  SHA-256: `cc350063805b35ab55b78d5225b72b648ca417bf4868a06ca9d3b0be0770d2df`.
  The sibling build-report.json records verified signatures, all three targets'
  build number 4 and App Group entitlements, production APS, Apple sign-in and
  applinks:app.blackcrab.app. The generated non-exempt-encryption flag is false.

`R/submit-device-ipa.mjs` now targets the accepted export, rechecks its digest,
verified targets and unused build number before validation/upload. Apple
validation and upload passed; `R/apple-submission-result.json` records completion.
Apple build ID is `0003ebb6-c832-452d-92f9-d3ff9bb0d867`, version 1.0.0 (4),
processing VALID, non-exempt encryption false. Internal distribution is verified
in `R/testflight-delivery-verification.json`; the manual release-group setup is
recorded in `R/testflight-internal-release-group.json`. External beta review has
not been requested; this delivery is for the owner's internal tester account.
`R/verify-device-export.mjs` also predates the required expected-entitlements
argument. Use the current production verifier, not that stale diagnostic script.
The owner can open TestFlight → Blackcrab Remote → Install/Update for 1.0.0 (4).
Physical-device installation, off-LAN control and push delivery remain unverified.

The working production EAS profile now explicitly names the existing Expo
project, production update channel, App Store app ID and Apple team. Cloud
public configuration was passed to the local build; private credentials are
excluded from snapshots/JavaScript. GitHub Apple/Tauri secret names exist;
no secret values were retrieved for diagnostics.

Audit the existing `.github/workflows/release.yml`: it creates Tauri installers
and a draft GitHub release, but must include the reviewed managed host/client
payloads before it satisfies this parity delivery. Install the resulting current
Mac app through a reversible replacement and verify its ordinary launch/version.
Future uploads must verify Apple processing and tester access independently;
build 4 now meets those distribution checks.

Official references consulted:
[Apple upload/build processing](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds),
[Expo iOS submission](https://docs.expo.dev/submit/ios/).

## Immediate continuation order

1. TestFlight version 1.0.0 (4) is available to the owner. Preserve the accepted
   archive/IPA and account evidence; do not rebuild or re-upload this increment.
2. Publish or update the release implementation/docs PR to stage after validation;
   link immediately. Signed-export acceptance is now positive; merge after
   required checks pass on the final head. Never count upload alone as delivery.
3. Integrate remaining desktop/service parents in reviewed units, preserving
   all current stage fixes. Rebuild current artifacts as needed and complete
   normal Root/native and independent-host workflows once UI access works.
4. Exercise remaining real application workflows from desktop and mobile:
   agent start/resume/stream/approvals/interrupt/queue, workspace/source-control
   and checkpoints, files/terminal/browser, delegation/goals/schedules and
   settings. Record actual failures, implement fixes and validate each scenario.
5. Promote/configure the hosted app and verify sign-in, off-LAN access and native
   background/push behavior against the deployed relay within the approved budget.
6. Finish signed Mac packaging/installation and physical-device acceptance;
   give the user the exact Mac app path/version. TestFlight delivery of 1.0.0 (4)
   is complete; later runtime fixes may require a new build number.

Keep moving on independent work when one gate is blocked. Do not claim full
parity or shipping readiness by reducing the remaining scenario list.

## Tool/workflow reminders

Use rg for search and purpose-built connectors/CLIs where sufficient.
Read current tool instructions for UI actions and PR link/watch lifecycle.
On T3 Code, link created/taken-over/pushed PRs as required immediately after
the write. Wait for checks through the prescribed watch mechanism, not polling.
An existing watch survives notifications; stop it before a real handback.
Do not spawn extra agents unless the user/current instructions authorize it.
Never create a replacement top-level thread or a new goal to evade an existing
context/budget limit. When nearing the limit, update these documents and provide
the copyable prompt with a truthful live-process and remaining-work summary.


### Latest delivery checkpoint — 2026-11-12 18:31 UTC

The normal Electron payload is built. QA desktop archive preparation completed
with strict signature verification before and after extraction; see
`desktop-delivery-m6ki1jlt/root-qa/desktop-resource-preparation.json`. The pinned
archive is on the restored owned APFS volume under `Root-QA/blackcrab-managed-payloads-NMyRVp`.
The current controlled service build remains active through original shell handle
10664, still copying its private pnpm cache. Do not restart it or edit its frozen
producer inputs. Root QA compilation still waits for the current service artifact.
Completed generated source copies (including the successful QA build's source
copy) have been retired with receipts; the QA and production artifacts remain.
The TestFlight build's disposable private npm install is being retired to retain
internal disk headroom; the uploaded IPA, signed archives, release worktree and
build reports are preserved. See `completed-source-retirement.json` and
`completed-ios-install-retirement.json`. Shared caches and the main checkout are untouched.

The user asked how forks affect cloud bills and for a commercial recommendation.
We explained that bills follow backend use, not Git ancestry. Recommended free
local/self-hosted source, official builds configured for Blackcrab, and server-side
subscription/usage enforcement for hosted remote access, starting invite-only.
The user subsequently approved adding this model to the delivery plan. See
[hosted-service-plan.md](hosted-service-plan.md) for HS01–HS06 and their acceptance
gates. This acceptance records product direction and planned work, not completed
billing, selected prices or a changed signup policy.


### Active Mac integration and mobile branding — 2026-11-12

The user explicitly requested Mac background-service integration and removal of
mobile T3 branding such as “T3 Account”, then reminded us to keep handoffs current.
Service attempt 2 (original handle 10664) has completed its private cache copies
but entered its failure audit after internal free space fell below the 4 GiB
build-start floor. Inspect its result.json when the audit settles; it has not
produced an accepted service artifact. Do not edit frozen controller inputs yet.
The owner approved removing only the local Time Machine snapshot dated 09:43.
The tmutil command returned EX_SOFTWARE; the subsequent exact-UUID diskutil call
reported no snapshots exist. Do not claim we deleted it; recheck free space and
see local-snapshot-space-result.json. No external backup was deleted.

Mobile branding has a separate clean stage-based worktree:
`P/mobile-owned-branding-4pdd465l/source`, branch
`parity/mobile-owned-product-copy`, base 25bc6985ca95c443ad6a6a812289f831763d5755.
Checkout completed (original handle 97035 exited 0). The reviewed proposed
generator is its parent's build-registry.next.py; apply it only after reading
that checkout's guides, regenerate the activation registry, and run existing
activation/link/config checks plus an audit of effective UI strings. Keep vendor
source, protocol identifiers and attribution unchanged. The audit found account,
Connect, settings, onboarding, notification and accessibility labels. The legal
URL still defaults to t3.codes; owned /legal, /privacy-policy, /terms-of-service
and /security-policy return 404, so owned policy publication remains a separate
public-release requirement. Do not present upstream policies as Blackcrab's.
No branding PR or replacement mobile release has been published yet.
