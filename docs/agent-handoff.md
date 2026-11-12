# Blackcrab parity and release handoff

## Current continuation checkpoint — Mac 0.4.0 publication

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
