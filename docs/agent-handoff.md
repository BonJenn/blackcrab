# Blackcrab parity and release handoff

Snapshot: 2026-11-12 09:26 UTC (2026-11-12 Pacific). This is a continuation checkpoint,
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
is its parent `P/ios-device-release-102m5jw4`. Release helper/config/guides live
on this branch. This checkpoint precedes publication; `R/release-pr.json` will
record the PR URL and head after publication. Recheck Git and GitHub for its
current status; the native export gate remains unmet.

No native build or export is running. Shell sessions 72436 (compile/first export)
and 51669 (corrected export) finished. The Release arm64 iphoneos archive passed:
`/private/tmp/blackcrab-ios-bDCQj6/artifacts/device-attempt-3/BlackcrabRemote.xcarchive`.
Prepared workspace: `/private/tmp/blackcrab-ios-bDCQj6`; all 3,380 frozen inputs
were checked before compilation, with only recorded app.json build-number/team
overrides. The current helper's producer hash is separate from that snapshot.
The first exported IPA lost capabilities and must NOT be uploaded. The corrected
export preserves them but failed provisioning; see the distribution section.
`R/run-verified-export.mjs` copies the successful original archive before using
the latest helper. `R/current-export.json` names the latest attempt:
`/private/tmp/blackcrab-ios-bDCQj6/artifacts/export-candidate-Q0L6OJ/`.
`R/device-export-blocker.json` records three 401 responses specifically from
Apple's `/xcbuild/v1/appGroups` endpoint. General Apple API access still works.
No certificate was revoked. The earlier owned temporary signing keychain was
cleaned up; the current exporter uses automatic cloud-managed signing without
importing the P12. Do not terminate unrelated Xcode processes or adopt PIDs.

Older cancelled commands remain cancelled. Some older `/private/tmp` paths are
absent. Recheck existence and hashes before reuse. Last internal free space was
12 GiB; DerivedData is on G-DRIVE. Use one heavy native build at a time and do
not delete shared caches or user data for space.

## Integrated work and current merge state

Last verified stage: `b512cc0ab53d1302694c0bf2965cd4b798f7dcb4` (including #261).
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

- Fresh pinned relay source: `/private/tmp/blackcrab-relay-release-47FcSg/blackcrab-managed-source-5YUxF6`.
  All 133 source files and 18 patches were verified; frozen install, full
  typecheck and 36 files / 324 tests passed. See its sibling validation/result.json.
- Private setup directory (C): `/private/tmp/blackcrab-clerk-setup-gjrvqjqi`.
  `run-relay-deployment.py` supports plan/deploy and targeted database modes.
  The full plan passed (24 creates, one zone adoption). Official Alchemy
  planning bootstrapped the encrypted `alchemy-state-store` Worker/Secrets Store.
- Actual database provisioning failed because PlanetScale could not verify the
  account's credit card. User was asked to update billing for bonjennprojects;
  no response yet. Schema generation passed, but no database was created.
- Cloudflare's refreshed OAuth grant works for Workers, Hyperdrive and Secrets
  Store. Account token provisioning returns 403: missing account_api_tokens:create.
  The additional authorization request expired unapproved at 08:14:42 UTC.
  No new permission was asserted. `C/authorize-cloudflare-provisioning.mjs`
  issues a fresh request when the owner is ready. Existing-scope refresh uses
  `C/refresh-cloudflare-existing.mjs`; do not request all authorizations again.
- Hosted app was built from current pinned source and uploaded successfully to
  Vercel project blackcrab-app under bonjenns-projects with --prebuilt --prod
  --skip-domain. Deployment `dpl_9hAgt9zC3Zw38ZW1mHfe7FS2qZMh` is READY:
  https://blackcrab-24ppiaw36-bonjenns-projects.vercel.app . It has no aliases;
  the existing landing domain was not promoted/replaced. Root and thread
  deep-link HTML return 200. AASA returns 200 and names the intended iOS app.
  Evidence: `R/hosted-deployment-verification.json`, `R/hosted-web-artifact`,
  `R/hosted-release-build.json`, `R/hosted-artifact-files.json`.

The relay/database are still not operational, and staged hosted HTML is not
end-to-end sign-in or remote-control proof. Required live evidence includes
sign-in, host registration, pairing, off-LAN encrypted agent operations,
revocation/reconnect and push/background delivery. An existing APNs key for
team YF28W3NGG6 was found, linked to Blackcrab in EAS, and configured privately
for production relay use. No notification was sent; live delivery is unverified.
See `R/apns-preparation.json` and `C/blackcrab-apns.env` (never print its values).
Continue independent local release work while the two account actions are pending.

Read only the needed private setup records; never print environment/key files.
`C/database-current-budget-preflight.json` records live pricing.
`C/relay-deploy-database-latest.json` records the billing failure;
`D/cloud-provisioning/setup-plan.json` retains setup history. Older rotation
hold strings are superseded by the user's explicit existing-key authorization.

## Mac installation and TestFlight

The latest parity changes have NOT been installed as a normal Blackcrab.app.
No ordinary Blackcrab app was found in /Applications or ~/Applications during
the bounded check. Old Blackcrab QA/Entry QA bundles exist under the main
checkout's target/debug/bundle/macos; do not tell the user these are current.

Apple/Expo access was verified without asking for new credentials:

- Personal Apple team YF28W3NGG6; existing App Store Connect app 6780360079,
  Blackcrab Remote, bundle dev.blackcrab.remote. Latest Apple build was 3;
  this release uses build 4. Do not create a duplicate app.
- The existing Team (Expo) internal TestFlight group has one tester and access
  to all builds. Build 3 is processed but expired. The tester matches the account
  holder and is INSTALLED. Xcode registered the share/widgets identifiers during
  the first export. No new build has been uploaded.
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

Apple account setup is now the concrete blocker:

- Main bundle ID `SZ6PPG34P8` and extension IDs `RXPA6QBRK7` / `K4B8S96VB4`
  are registered. Required capabilities were enabled and read back through the
  API: App Groups on all three; Push Notifications, Associated Domains and Sign
  in with Apple on the main app. `R/apple-capabilities-verified.json` records this.
- The actual `group.dev.blackcrab.remote` association remains pending. Public
  App Groups API requests return 404; Xcode's private App Groups endpoint returns
  401 for the existing API key. Restoring the cached Apple login found no valid
  session. Do not misdiagnose this as an expired key or rotate it blindly.
- The owner was asked to register that App Group and associate it under App
  Groups → Configure with dev.blackcrab.remote, dev.blackcrab.remote.sharing,
  and dev.blackcrab.remote.widgets. No response has arrived. See
  `R/apple-session-group-result.json` and `R/device-export-blocker.json`.
- After association, verify regenerated profiles and retry export from a copy
  of the existing archive. If automatic signing still cannot read App Groups,
  use an authorized Apple ID session or explicit profiles with the already
  available team distribution identity; do not strip entitlements to get a pass.

`R/submit-device-ipa.mjs` was prepared but NOT RUN; it still points to the old
failed export and must be updated to the newly verified report before use.
`R/verify-device-export.mjs` also predates the required expected-entitlements
argument. Use the current production verifier, not that stale diagnostic script.
No new IPA upload or TestFlight availability is asserted.

The working production EAS profile now explicitly names the existing Expo
project, production update channel, App Store app ID and Apple team. Cloud
public configuration was passed to the local build; private credentials are
excluded from snapshots/JavaScript. GitHub Apple/Tauri secret names exist;
no secret values were retrieved for diagnostics.

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

1. Preserve the completed archive and failed-export evidence. Await the owner's
   App Group association, then finish profile/export verification without
   rebuilding npm/Pods or revoking other certificates. No process is running.
2. Publish or update the release implementation/docs PR to stage after validation;
   link immediately. Keep it draft while real signed-export acceptance
   is blocked, then merge after that evidence and required checks pass. Submit
   only the verified IPA using existing Apple/Expo access, then confirm Apple
   processing and the user's tester access. Never count upload alone.
3. Integrate remaining desktop/service parents in reviewed units, preserving
   all current stage fixes. Rebuild current artifacts as needed and complete
   normal Root/native and independent-host workflows once UI access works.
4. Exercise remaining real application workflows from desktop and mobile:
   agent start/resume/stream/approvals/interrupt/queue, workspace/source-control
   and checkpoints, files/terminal/browser, delegation/goals/schedules and
   settings. Record actual failures, implement fixes and validate each scenario.
5. Deploy using the authorized existing keys within the approved budget and verify
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
