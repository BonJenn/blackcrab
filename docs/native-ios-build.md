# Native iOS builds

Blackcrab Remote uses Expo SDK 58.0.14 / React Native 0.88.0 / React 19.3.0. Its checked-in source
can live on `G-DRIVE PRO`; native builds run in a separate physical workspace
whose path contains no whitespace. Expo Constants and Updates currently have
upstream build scripts that split paths containing spaces. Staging avoids
modifying those scripts, their relative package paths, or shared dependencies.

## Prepare

Install Xcode and its simulator platform, CocoaPods, Node 26.12.1 and npm 12.2.2. Select the
intended Xcode with `xcode-select`, or supply `DEVELOPER_DIR` in the environment.
Run from the repository:

```sh
node scripts/prepare-mobile-ios.mjs --mode prepare
```

A clean relevant worktree is required by default. To review current tracked
mobile/workspace changes and the explicitly supported new native-build helper
files before committing them:

```sh
node scripts/prepare-mobile-ios.mjs --mode prepare --include-working-tree
```

This flag does not admit arbitrary untracked workspace files. Commit or move
those files first. The helper copies tracked `apps`, `packages`, and vendored T3
sources plus root manifests/build inputs and the shared cloud patch registry,
payloads and patch runner; it excludes `.env` files, registry
credentials, signing material, Git metadata and installed dependencies. It
rejects symlink inputs and concurrent source edits. Desktop-only source changes
are outside this snapshot. `source-manifest.json` records the revision, relevant
dirty paths and a SHA-256 digest of every copied input.

Preparation creates `/private/tmp/blackcrab-ios-*/repo`, installs the lockfile
with `npm ci`, verifies native and shared-runtime dependency resolution stays
inside that physical workspace, runs Expo prebuild, and installs Pods, then verifies every generated native/resource pod target meets
the minimum deployment floor. It uses
an isolated HOME, npm configuration/cache and temporary directory; account,
provider, npm authentication and shell-startup settings are not inherited.
Public registry and CocoaPods network access is required. The default app
configuration is used unless the validated public `BLACKCRAB_CLERK_PUBLISHABLE_KEY`,
`BLACKCRAB_CLERK_JWT_TEMPLATE` and `BLACKCRAB_RELAY_URL` are supplied together.
The optional `BLACKCRAB_HOSTED_APP_URL` then configures shared links and native
domain association. Preparation and simulator builds do not inherit signing credentials. Device
archives require explicit private signing inputs outside the source repository.

The Expo config plugin `apps/mobile/plugins/with-ios-pod-floor.cjs` sets an
application minimum of iOS 18.0 and adds an idempotent generated Podfile hook.
That hook raises lower pod deployment targets, including resource bundles such
as ReachabilitySwift, while preserving higher requirements. Unsupported symbolic
targets or changed Podfile hook structure fail explicitly. It does not patch
`node_modules`, dependency source, or dependency script phases.

## Build

The following explicitly prepares a new workspace and builds a standalone Release
simulator app with Xcode-generated simulator entitlements and ad-hoc signing. Preparation alone does not invoke Xcode compilation:

```sh
node scripts/prepare-mobile-ios.mjs --mode build \
  --derived-data-parent '/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes' \
  --destination 'generic/platform=iOS Simulator'
```

`--staging-parent /physical/path/without/spaces` can override `/private/tmp`.
It must already exist, resolve without whitespace, and sit outside the source
repository. A fresh directory is created beneath it. A symlink back to the
original spaced workspace or its `node_modules` is not sufficient.
`--derived-data-parent` may contain spaces and must already exist; Xcode receives
it as a separate argument and uses a fresh child directory. DerivedData can live
on an external drive to reduce internal disk use. Arguments are never assembled
into shell commands. The build passes a physical `ENTRY_FILE` explicitly so Xcode’s
`/tmp` alias cannot disagree with Metro’s `/private/tmp` file map.

Both modes print a JSON report identifying the staging workspace, numbered tool
logs and `artifacts/build-report.json`. Build reports identify the generated
workspace/scheme, simulator app, products directory and embedded Hermes bundle hash. Build mode verifies the ad-hoc simulator signature; it uses no distribution identity or provisioning-account access. A Debug/unsigned app would require Metro and can lack the simulated application identifier required by SecureStore, so it is not used here. The report distinguishes
`prepared`, `built`, and `failed`; neither success means the app ran on a device.
Install/launch and behavior checks are separate validation steps.

Tool timeouts and failures retain the staging tree and logs for review. Owned
processes receive termination on timeout/interruption. Remove the exact reported
staging directory and, if used, its separately reported DerivedData directory
when the evidence is no longer needed. Preparation uses additional disk space
for its independent dependency tree, Pods, caches and generated files.

## Checks

```sh
node --test scripts/prepare-mobile-ios.test.mjs \
  apps/mobile/plugins/with-ios-pod-floor.test.cjs
```

These checks exercise source isolation, credential exclusions, dirty snapshot
rules, dependency escape rejection, argument handling, and the installed Expo
SDK's actual Podfile mod pipeline and Ruby deployment-floor behavior. A successful
native simulator build remains a separate, explicit check.

## Device archive and TestFlight export

Use `--mode archive` to build the `iphoneos` Release archive and export an App
Store distribution IPA. Compilation produces an unsigned archive. The helper
then ad-hoc signs its frameworks, extensions and app, preserving each target's
generated entitlements before Xcode applies automatic distribution signing.
Directly exporting the unsigned archive can silently strip capabilities.
The helper verifies the exported app and both extensions against the expected
certificate, team, bundle IDs, build number and all generated entitlements,
including app groups, production push, Sign in with Apple and hosted links.
No development certificate needs to be replaced to compile a distribution build.
This uses the same isolated source, dependency checks,
native patches and resource generation as the simulator helper. Choose a new
build number from App Store Connect; it is applied to the staged Expo config
before native generation so the app and extensions share that number.

```sh
node scripts/prepare-mobile-ios.mjs --mode archive \
  --build-number 4 --team-id YF28W3NGG6 \
  --signing-certificate YOUR_DISTRIBUTION_CERTIFICATE_SHA1 \
  --apple-api-key-path /private/tmp/blackcrab-signing/AuthKey.p8 \
  --apple-api-key-id YOUR_KEY_ID --apple-api-issuer-id YOUR_ISSUER_UUID
```

Replace the example number and signing paths/identifiers with the current
release inputs. `--signing-certificate` is the expected SHA-1 checked after
export, not a selection control: Xcode ignores certificate selection with
automatic signing and may use an existing cloud-managed distribution identity.
Verify that certificate's ownership and validity before accepting its digest.
The API key must belong to the intended Apple team and permit provisioning;
its file must be owner-only, physical, outside the repo and in a path without
spaces. The helper does not import credentials into a keychain.

Register `group.dev.blackcrab.remote` and associate it with the main, sharing
and widgets identifiers in the Apple Developer account. Their provisioning
profiles must include that group; the main profile also needs Push Notifications,
Associated Domains and Sign in with Apple. Enabling the App Groups capability
alone does not associate the group. The currently available App Store Connect
API key could enable capabilities but could not create/link App Groups; Xcode's
App Groups lookup returned 401. This account setup is still a release blocker.
After linking, recheck provisioning: automatic export may still require an
Apple ID session or explicit profiles if the lookup remains unauthorized.

Only after successful export verification does the report record `archived`,
the explicit build number/team, the embedded
Hermes bundle digest and exported IPA digest. It verifies the exported IPA's signatures
and Blackcrab bundle identifiers. Export keeps the chosen build number and does
not upload: `signing.uploaded` remains false. Submit the reviewed IPA separately,
then verify Apple processing and tester access before reporting TestFlight ready.

The existing owned Expo project is `@bonjenn/blackcrab-remote`
(`33fb14fd-4b87-4e85-920c-b6d4204e4567`); App Store Connect app ID is
`6780360079`. The production EAS profile names that project/channel, and its
submission profile names the verified app and Apple team. Public cloud inputs
still come from the validated `BLACKCRAB_*` group. No private key belongs in
`eas.json`, app config, source snapshots or the compiled JavaScript bundle.
