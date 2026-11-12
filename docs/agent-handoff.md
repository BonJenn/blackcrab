# Blackcrab parity and release handoff

Snapshot: 2026-11-12 UTC (2026-11-11 Pacific). This is a continuation checkpoint,
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
Guidance worktree: `P/parity-agent-handoff-pzvormc3/source`, branch
`parity/agent-handoff-guides`, based on stage
`f69c62951e868d69a13ed0712f2e4fb448538638`.
Guidance PR: https://github.com/BonJenn/blackcrab/pull/261 (target: stage).
Check `P/parity-agent-handoff-latest.json`, the PR and `result.json` in its work
directory for the latest commit/merge state. Do not assume it has already merged.

No heavy build, native test host, app fixture or simulator run is active at
this checkpoint. No captured process handle is available to resume. Earlier
background commands that were cancelled by a T3 server restart stay cancelled.
Some `/private/tmp/blackcrab-parity-work-i5v1q577/Root-QA` paths are absent.
Verify existence and recorded hashes before reuse; recreate owned work as needed.
Never recover process ownership by scanning/adopting a PID.

Last internal free-space check: about 6.8 GiB; external G-DRIVE has ample space.
Recheck before large installs/native builds. Use physical whitespace-free staging
for iOS and the supported external cache/DerivedData paths. One heavy native
build at a time. Do not delete shared caches or user data to make room.

## Integrated work and current merge state

Last verified stage: `f69c62951e868d69a13ed0712f2e4fb448538638`.
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

The latest native capture recheck still returned
`Computer Use server error -10005: cgWindowNotFound` even for Finder.
The previous combined Root/service attempt also failed capture through bundle
ID, bundle path and display name, then closed its captured Root cleanly with
zero host/native opens. No current normal-entry UI acceptance was substituted.
See `D/root-service-qa-preparation/ui-attempt.json` and
`P/pr215-current-stage-tdxlleu5/native-capture-recheck.json`.

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
User approved up to $30/month base plus metered usage; reviewed smaller database
and Workers quote was about $20/month. Reverify pricing before provisioning.

Completed owner actions: Vercel team access, Clerk free-plan terms, Axiom
ownership claim, Cloudflare authorization including Secrets Store read/write,
R2 activation, and the GoDaddy nameserver change.
Public parent delegation and Cloudflare resolver now return
`beau.ns.cloudflare.com` and `khloe.ns.cloudflare.com`. All ten original DNS
records had been copied/verified; do not repeat the old request to change DNS.
Cloudflare API activation status should still be refreshed before deployment.

Cloud deployment is BLOCKED by Clerk credential rotation. A prior diagnostic
printed secret-bearing environment data. PlanetScale and Axiom old credentials
were revoked and replacements checked. The affected production Clerk key still
needs replacement/revocation. The user was asked again this turn and explicitly
answered: **I'll do it later**. Do not re-prompt in a loop or deploy using it.
When the user is ready, use the private-secret input mechanism; no values in chat.

The database/relay and hosted application are not yet proven deployed. Required
live evidence includes sign-in, host registration, pairing, off-LAN encrypted
remote agent operations, revocation and reconnect, and push/background delivery.
Continue independent local work while the owner-deferred rotation is pending.

Private setup metadata lives under
`/private/tmp/blackcrab-clerk-setup-gjrvqjqi/`; consult only the needed records
and never print credential contents. `credential-rotation-status.json` and
`nameserver-public-delegation-confirmed.json` are status records.
`D/cloud-provisioning/setup-plan.json` contains detailed setup state.

## Mac installation and TestFlight

The latest parity changes have NOT been installed as a normal Blackcrab.app.
No ordinary Blackcrab app was found in /Applications or ~/Applications during
the bounded check. Old Blackcrab QA/Entry QA bundles exist under the main
checkout's target/debug/bundle/macos; do not tell the user these are current.

Local signing inventory includes the user's personal Developer ID Application
identity for team YF28W3NGG6. An unrelated organization's Apple Distribution
identity also exists: do not select it for Blackcrab. No Blackcrab-specific iOS
distribution provisioning profiles were found in the standard local locations.
Xcode 27.1 is selected. Expo's local state reports the bonjenn account signed in;
EAS CLI and fastlane were not on PATH. Verify access before asking for login.

GitHub repository secrets already include APPLE_API_KEY, APPLE_API_ISSUER,
APPLE_API_KEY_P8, APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD,
APPLE_SIGNING_IDENTITY, APPLE_TEAM_ID and TAURI_SIGNING_PRIVATE_KEY.
Names were inspected, never values. Do not retrieve/export them for inspection.
Existing secrets may support release jobs; their iOS API role and current
validity still need checking. No TestFlight app record/build is confirmed.

`apps/mobile/eas.json` has production build configuration but an empty production
submit object. The app bundle is dev.blackcrab.remote with share/widget targets.
`scripts/prepare-mobile-ios.mjs` explicitly builds iphonesimulator/ad-hoc only.
A device archive/export/sign/upload path is still required. A local simulator
bundle cannot become TestFlight simply by changing its filename or destination.

Audit the existing `.github/workflows/release.yml`: it creates Tauri installers
and a draft GitHub release, but must include the reviewed managed host/client
payloads before it satisfies this parity delivery. Install the resulting current
Mac app through a reversible replacement and verify its ordinary launch/version.
Verify Apple processing and availability to the user's tester account after iOS
upload; an upload acknowledgement alone does not finish TestFlight delivery.

Official references consulted:
[Apple upload/build processing](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds),
[Expo iOS submission](https://docs.expo.dev/submit/ios/).

## Immediate continuation order

1. Review the paired guidance PR #261 and merge it to stage once its checks pass.
   Its local result records whether the reviewed guide/handoff files were copied
   into the user's main checkout. Preserve all unrelated dirty source. Recheck
   that result before copying again; never overwrite a successor agent's edits.
2. Inspect existing Expo/Apple/GitHub release access and implement the missing
   reproducible iOS device archive/export/TestFlight path. Verify the app and all
   extension identifiers/team/capabilities. Do not create a duplicate Expo app
   or request already-configured credentials without first checking access.
3. Integrate remaining desktop/service parents in reviewed units, preserving
   all current stage fixes. Rebuild current artifacts as needed and complete
   normal Root/native and independent-host workflows once UI access works.
4. Exercise remaining real application workflows from desktop and mobile:
   agent start/resume/stream/approvals/interrupt/queue, workspace/source-control
   and checkpoints, files/terminal/browser, delegation/goals/schedules and
   settings. Record actual failures, implement fixes and validate each scenario.
5. After the owner rotates Clerk, deploy within the approved budget and verify
   live hosted/relay/off-LAN access and native background/push behavior.
6. Finish signed Mac packaging/installation and iOS distribution/TestFlight;
   give the user exact app path/version and TestFlight app/build availability.

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
