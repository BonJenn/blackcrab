# Native Android builds

Blackcrab Remote on Android is the same Expo SDK 58 / React Native 0.88 app as iOS
(`dev.blackcrab.remote`). `scripts/prepare-mobile-android.mjs` mirrors
`prepare-mobile-ios.mjs`: it snapshots tracked inputs into a physical, whitespace-free
staging directory, runs `npm ci` with an isolated HOME/npm configuration, applies the
recorded owned build patches, runs Expo prebuild for Android and builds a Release APK
with Gradle. It reports tool logs and SHA-256 hashes in `artifacts/build-report.json`.

## What the product is

Two artifacts, never interchangeable:

- **Sideloadable Release APK** (default, arm64-v8a only), signed with the debug keystore
  Expo generates. It installs on a device or emulator and is **not** a Play Store artifact.
- **Play bundle (AAB)** (`--artifact aab`, default ABIs `armeabi-v7a,arm64-v8a,x86_64`),
  signed with the Blackcrab **upload key**. The script refuses to build an AAB without it.

A Play Console app, enrolling in Play App Signing, a tester track and a store listing are
separate steps that need the Blackcrab Play account. Do not describe either artifact as
distribution-ready until that has been done and verified.

## Toolchain

- Node 26.12.1 and npm 12.2.2 (use `--npm-cli` for an isolated CLI), as for iOS.
- JDK 17 and an Android SDK with `platforms;android-36` and `build-tools;36.0.0`
  (Gradle installs the matching NDK/CMake on first use once licenses are accepted).
  Both directories must be physical paths **without whitespace**; the SDK tools break
  otherwise. Pass `--java-home` / `--android-home` or set `JAVA_HOME` / `ANDROID_HOME`.
- Use a persistent `--gradle-user-home` to keep the Gradle cache between builds.

## Run

```sh
node scripts/prepare-mobile-android.mjs --mode build \
  --npm-cli /path/to/npm-12.2.2/bin/npm-cli.js \
  --java-home "$HOME/.blackcrab-android/jdk/Contents/Home" \
  --android-home "$HOME/.blackcrab-android/sdk" \
  --gradle-user-home "$HOME/.blackcrab-android/gradle" \
  --eas-project-id <owned-uuid> --update-channel preview --updates-enabled 0
```

`--mode prepare` stops after Expo prebuild. `--abis arm64-v8a,x86_64` builds more ABIs
(an emulator on Intel needs x86_64). Public Blackcrab configuration is forwarded only
through `--eas-project-id`, `--update-channel` and `--updates-enabled`; account tokens and
other credentials are never passed to the build.

### EAS project ID is required on Android

`expo-observe` creates its native manager at import time and, on Android, throws
`Project ID is required to send observability metrics` when the manifest has no
`extra.eas.projectId`. That aborts module loading, so `main` is never registered and the
app shows a blank screen. The pinned upstream configuration hardcodes T3's project ID;
Blackcrab's config adapter correctly removes it. A real build must supply the UUID of a
Blackcrab-owned Expo project (`BLACKCRAB_EAS_PROJECT_ID`, see
[mobile updates](mobile-updates.md)). The local verification builds used the placeholder
`00000000-0000-4000-8000-000000000000` with updates disabled; that value proves nothing
about ownership and must not be used for a release.

## Play signing

Play App Signing: Google keeps the app signing key; Blackcrab keeps only an **upload key**
that proves uploads are its own.

```sh
node scripts/create-android-upload-key.mjs --java-home "$HOME/.blackcrab-android/jdk/Contents/Home"
```

This creates `~/.blackcrab-android/signing/` (mode 700) with `upload-keystore.p12`,
`upload-key.properties` (passwords; mode 600) and `upload-certificate.pem` (public). It
prints only paths and the certificate SHA-256, never overwrites an existing key and keeps
passwords out of arguments, logs and reports. **Back this directory up somewhere private.**
Losing the key forces a Play upload-key reset; it is never committed.

```sh
node scripts/prepare-mobile-android.mjs --mode build --artifact aab \
  --upload-key-properties "$HOME/.blackcrab-android/signing/upload-key.properties" \
  ...the same toolchain and --eas-project-id flags as above
```

Gradle reads the secrets from the properties file at build time through the init script.
The script then runs `jarsigner -verify`, requires the AAB signer certificate to equal
`upload-certificate.pem`, and checks the owned package identity and embedded JS bundle.
The report records the public certificate SHA-256 only.

Before the first Play upload: create the app in Play Console with package
`dev.blackcrab.remote`, enrol in Play App Signing, and set an increasing Android
`versionCode` for every upload because Play rejects reused codes (`apps/mobile/app.json`
does not set one yet, so Expo builds with 1). Store listing, data-safety declarations and,
for some account types, closed-testing requirements are Play Console account actions, not
build steps; check the account's current requirements.

## Android-specific build adaptations

Each is applied to the staged copy only; tracked vendor sources are unmodified.

1. **libghostty-vt headers.** The vendored mobile export keeps the prebuilt
   `libghostty-vt.so` binaries but not the C headers the terminal JNI bridge compiles
   against. They are fetched from the pinned reference commit
   (`BonJenn/t3code@7f02de2e…`, `native/libghostty-vt/include`), every file verified against
   its git blob SHA, written outside the staged repository and passed to CMake through the
   Gradle init script. Requires an authenticated `gh` for that repository.
2. **Vendor output relocation.** `mobile-experience/consumer.mjs` rejects any extra file
   under `vendor/t3-mobile` each time the Expo config is read. Gradle would write `build/`
   and `.cxx/` there, and AGP hard-links the imported `libghostty-vt.so` (link count 2 is
   rejected). An init script (`artifacts/relocate-vendor-build.init.gradle`) moves those
   outputs outside the tree and re-links the imported libraries after CMake runs.
3. **`@expo/ui` from source.** `@expo/ui` 58.0.20 ships a prebuilt AAR that lacks
   `TopAppBarView`, which the app's root navigation uses. Autolinking matches
   `buildFromSource` entries against the Gradle project name (`expo-ui`), so the existing
   `@expo/ui` entry only worked for Apple. `apps/mobile/package.json` now has an
   `expo.autolinking.android.buildFromSource` list that uses `expo-ui`; it overrides the
   top-level list on Android only.
4. **No `ENTRY_FILE`.** That variable is an iOS convention; the Android React Native Gradle
   plugin joins it onto the project directory and fails.
5. **`NODE_ENV=production` only for Gradle.** Setting it earlier makes `npm ci` skip
   devDependencies the postinstall verifier needs.

## Verification performed and not performed

The script verifies the APK signature (`apksigner`), the owned package identity
(`aapt2 dump badging`) and the embedded JS bundle. A passing build is not runtime
acceptance. Install and launch separately and read `adb logcat --pid`; check for
`ReactNativeJS` errors and `Can't find ViewManager`.

Observed on an arm64 API 36 emulator with the local-verification APK: launch, Chats /
Pulls / Usage / Settings navigation, the empty state and the Add environment pairing form
(QR scan, address and code fields). Not performed: pairing with a real host, any
provider session, QR scanning, push/notifications, widgets, share target, voice input,
the terminal surface, physical-device behavior, upgrade/retention testing, or any Play
distribution step. The Android reference behavior in the parity ledger remains
unverified; do not relabel this smoke test as parity acceptance.

## Checks

```sh
JAVA_HOME=/path/to/jdk-17 node --test scripts/prepare-mobile-android.test.mjs
```

Covers header blob verification and path safety, Gradle argument and init-script
generation, build-environment isolation, upload-key creation (needs `JAVA_HOME`; skipped
otherwise) and the refusal to build an unsigned AAB.
