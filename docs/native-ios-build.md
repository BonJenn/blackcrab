# Native iOS builds

Blackcrab Remote uses Expo SDK 54 / React Native 0.81.5. Its checked-in source
can live on `G-DRIVE PRO`; native builds run in a separate physical workspace
whose path contains no whitespace. Expo Constants and Updates currently have
upstream build scripts that split paths containing spaces. Staging avoids
modifying those scripts, their relative package paths, or shared dependencies.

## Prepare

Install Xcode and its simulator platform, CocoaPods, Node and npm. Select the
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
sources plus root manifests/build inputs; it excludes `.env` files, registry
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
configuration is used; signing credentials and private environment-specific
configuration are deliberately unsupported here.

The Expo config plugin `apps/mobile/plugins/with-ios-pod-floor.cjs` sets an
application minimum of iOS 15.1 and adds an idempotent generated Podfile hook.
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
