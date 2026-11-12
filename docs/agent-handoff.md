# Blackcrab parity and release handoff

## Current continuation checkpoint — 2026-11-12 18:58 UTC

This section is authoritative over the historical checkpoints below. Recheck
mutable state before acting. The user asks to complete Mac background-service
integration, remove mobile product copy such as “T3 Account”, and keep these
handoffs current. The finish line remains validated parity, a normal Mac app
installed for the owner, and an iOS app available in their TestFlight.

### Exact current state

- **Mac:** normal Electron payload and isolated QA archive are built and verified.
  The service producer is running; combined Root native acceptance, the normal
  Tauri bundle, installation and ordinary launch are pending. No current normal
  app has been installed by this work.
- **iOS:** TestFlight 1.0.0 (4) is VALID / IN_BETA_TESTING and available to the owner.
  It still has the previous product labels. The new branding source is validated
  locally but has no PR, merge, OTA update or new binary yet.
- **Cloud:** relay/database health and access rejection checks passed; the hosted
  app was promoted. Signed-in/off-LAN/provider/APNs acceptance remains separate.
  Existing credentials and the approved small deployment budget remain authorized.
- **Product model:** free open-source local/self-hosted use; official public
  endpoints; invite-only hosted beta, followed by server-enforced paid access,
  quotas and cost controls. The plan is in the desktop worktree's
  `docs/hosted-service-plan.md`. Prices/provider and public paid launch are not set.

### Active worktrees and process ownership

P = `/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes`.

Mac: `P/desktop-delivery-m6ki1jlt/source`, branch
`parity/desktop-delivery-integration`, local integration head
`1da28f8d137ee8ad5835bce8d7f389ffe39c2a3c` plus uncommitted reviewed fixes.
All 17 reviewed desktop/service stack tips are ancestors. No integration PR yet.
Do not overwrite its uncommitted source or change frozen producer inputs.

**Service attempt 3 is running through original shell handle 28186.**
Plan: `/private/tmp/blackcrab-service-delivery-wJ2lcU/service-profile-controller-bDE8cZ/plan.json`.
Result will be the sibling `result.json`.
Output: `P/service-profile-build-7XbKuE/quarantine/artifact`.
`desktop-delivery-m6ki1jlt/service-build-plan-pointer.json` and
`service-build-attempts.json` identify the current attempt. The final input,
protected-store, reference, metadata and Cargo audits must succeed. Never reuse a
started plan or adopt a discovered process PID. The build has not activated a host.

Attempt 2 exited 1 through original handle 10664 at the 4 GiB resource floor,
before compilation. All captured children settled; its failure audit verified
protected inputs/caches unchanged. The owner approved deleting only the local
Time Machine snapshot dated November 12 at 09:43. tmutil returned an error, then
diskutil reported no snapshots; free space rose to about 9.5 GiB. Do not claim
which operation removed it. External backups were untouched. Latest free space
was about 8.9 GiB. Do not repeat backup cleanup or delete user data.

Mobile: `P/mobile-owned-branding-4pdd465l/source`, branch
`parity/mobile-owned-product-copy`, based on verified stage
`25bc6985ca95c443ad6a6a812289f831763d5755` (#262 merged).
The generator and registry use 57 pinned adapters. Product copy includes account,
Connect, settings, onboarding, navigation/accessibility, notifications, widgets,
update text and diagnostics. Vendor source, internal native modules/protocols
and original attribution remain intact.

### Mobile validation and next publication

- All **46 activation tests pass**; effective TS/TSX parses with the compiler.
- Consumer verification passes: **23 packages / 3,147 files**.
- AST audit of **1,041 effective mobile source files** finds no remaining T3
  product literals. This is a scoped source audit, not proof of every server string.
- Full native UI generation succeeds: **3,214 generated files**. The generator
  still reports native validation pending; no live app acceptance is inferred.
- `git diff --check` passes. Evidence is under the mobile worktree's parent:
  `validation-summary.json`, `branding-audit.json`, `activation-final-tests.log`,
  `consumer-verification.log`, `generated-ui.log` and `dependency-links.json`.
- Initial failures came from old/missing dependency links. The isolated checkout
  now links the existing lock-matching Expo 58 graph, while @t3tools resolves its
  current verified workspace packages. Shared dependency caches were not changed.
  Root React 19.1 and mobile React 19.3 remain separate.

Next: commit the explicit mobile files and these handoffs, push the branch,
create/link one PR to stage, inspect required checks/reviews, then merge. Record
its actual URL/head in both handoffs and a local receipt. If waiting on CI, watch
and end the turn. After merge, compare the build-4 native runtime fingerprint
with the proposed update before selecting an Expo update or a new signed binary.
Follow `docs/mobile-updates.md`; source tests do not prove phone delivery.

Legal URLs now use blackcrab.app. Its /legal, /privacy-policy,
/terms-of-service and /security-policy routes currently return 404. Owned policy
publication is an outstanding public-release requirement; do not substitute T3's
policies, invent binding terms, or claim the documents are already published.

### Mac next actions after the current build

Use the reviewed helpers in `P/desktop-delivery-m6ki1jlt` in order:

1. Consume the current controller's final result and original handle. On a real
   successful build with final audits, run `record-service-freeze.py`, then the
   source-freeze test. A partial artifact is not eligible.
2. Run `prepare-root-pins.mjs`, then `root-qa/compile/run.mjs --run` with pinned
   Node, retaining the original handle. Do not launch before positive compile.
3. Run `root-qa/package-root.py`, then its generated `root-controller.py --run`
   with a captured TTY. Use actual original Root UI for service enable/status,
   desktop open/reuse/normal quit/reopen and service restart/stop/start. Preserve
   identity/catalog. No provider run is required for this bounded acceptance.
4. Stop through that controller's `stop-owned`, verify all captured cleanup and
   record `root-qa/native-ui-acceptance.json` only from actual positive evidence.
5. Commit/review the coherent desktop integration; PR to stage, required CI and
   merge. Then `build-normal-root.py` and `install-normal-root.py` with their
   evidence prerequisites, followed by actual launch verification.

Normal Electron artifact: `desktop-delivery-m6ki1jlt/desktop-production-artifact`;
its result is `desktop-production-result.json`. QA artifact/result use
`desktop-qa-attempt-3-artifact` / `desktop-qa-attempt-3-result.json`.
QA archive evidence: `root-qa/desktop-resource-preparation.json`.
These are not the final installed Root application. Target installation is
`/Applications/Blackcrab.app`, bundle `com.bonjenn.blackcrab`, version 0.3.0.
Local ad-hoc signing is separate from public notarized distribution.

### Continuity rules

Keep both handoffs synchronized whenever a build, check, PR or delivery changes.
Keep each edited AGENTS.md/CLAUDE.md pair byte-identical. Preserve the dirty main
checkout and its index; use the two isolated worktrees above. Do not create
replacement goals or assume an old cancelled background process will finish.
Completed test/generator logs above are retained; no mobile build/upload is live.
Only service handle 28186 is known to be active at this checkpoint.


## Historical checkpoints and supporting evidence

The following dated material preserves provenance. Its old live-process, stage,
PR and next-action claims are superseded by the current checkpoint above.

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
