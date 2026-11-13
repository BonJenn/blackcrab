# Build and release scripts

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

Use argument arrays with captured subprocesses, bounded timeouts and logs.
Do not interpolate credentials or user paths into shell command strings.
Preserve the main dirty checkout and shared installed dependency trees.
Native builds should use exact committed source snapshots and owned work areas.

`prepare-mobile-ios.mjs` prepares/builds a standalone arm64 simulator Release
or an explicit iphoneos archive/App Store IPA. Both use physical whitespace-free
staging, locked npm inputs, recorded native patches/resources and an iOS 18 pod
floor. The build environment excludes account credentials; device export accepts
explicit owner-only signing files outside the source snapshot. Compile the
archive unsigned, preserve generated capabilities with ad-hoc archive signatures,
then use Xcode distribution export. Verify the expected certificate, team,
app/extension bundle IDs, build numbers and every generated entitlement.
Automatic export selects its certificate; the supplied SHA-1 verifies the result.
Do not accept an IPA that lost push, app groups, sign-in or hosted-link entitlements.
App Group capability enablement and actual group association are separate steps.
Do not substitute a simulator artifact for a device release. No export implies
upload, Apple processing or TestFlight availability. Preserve failed logs and
reuse a verified prepared workspace for signing-only corrections.

`tauri-build.mjs` and managed-native resource helpers package the normal Mac
root. Preserve complete opaque payload archives, framework links and exact pins.
Review the desktop dependency/packaging fixes on pending branches before using
an older producer. A successful build does not mean it has been installed.

Use a valid owned staging/output filesystem and check disk headroom first.
Keep original source and previously accepted artifacts immutable. Retire only
clearly owned disposable build output after evidence is retained; never delete
user data or shared caches to satisfy a disk-space check.

Run focused tests for real argument/provenance/lifecycle changes. Keep reports
explicit about prepared/built/launched/signed/uploaded/processed/installed.
Do not emit secret values even on errors. Validate release inputs before
performing external publication or replacing the user's installed application.


## Tauri release compatibility

Keep the root @tauri-apps/api and plugin npm versions on the same major/minor
lines as their Rust crates in src-tauri/Cargo.lock. These npm dependencies are
exact-pinned after broad caret ranges drifted and blocked the 0.4.0 native release.
Run npm run check:tauri-versions when either lockfile changes. The guard runs in
CI and before release payload processing; do not disable Tauri's version check.
Change npm/Rust pairs together when upgrading, and validate actual native packaging.

## 0.4.1 signed-helper startup defect

The owner failure is now reproduced. Read the current handoff before historical
startup notes. A signed app executable cannot simply be copied as a standalone
service issuer: its external signed Info.plist is lost and macOS kills it. Use
the separately built/signed/notarized CLI helper embedded in Root. Preserve
existing service configuration/generation during an explicitly stopped upgrade.
Signature verification, real helper readiness and actual app UI acceptance are
different checks; do not label the whole delivery complete from the first two.
