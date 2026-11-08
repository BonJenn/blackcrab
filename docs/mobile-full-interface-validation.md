# Full native mobile interface validation

PR #213 remains a draft. Source `c6035c6d55f86ec8d2c62cd64424067197f95e10` produced a fresh standalone arm64 iOS Simulator Release app; `xcodebuild` and deep/strict ad-hoc signature verification passed. This is build evidence, not installed-app acceptance or distribution signing.

The isolated producer authenticated 3,314 selected source inputs against source-manifest SHA256 `e5991c8efbd9a27310b99c0a463eccb1209b6ee1714109bf973f1b705010f7a0`. The built Hermes bundle is 18,905,732 bytes, SHA256 `849d7c30299cf1483b91c4d928f73d5f6a24135642046a61956bfc9866927874`. The built source map covers 4,479 sources with one React, Effect and atom owner; the full native interface and retained legacy interface are present. Old managed-owner and QA-fixture entries are absent. App, widget and share extension products retain owned identifiers and the iOS 18 deployment floor.

Local raw evidence is preserved under `/private/tmp/blackcrab-ios-x532Wp/artifacts/` (`full-ui-build-report.json`, `built-source-proof.json`, source manifest and build logs). The unchanged standalone app is at `/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/full-ui-ios-derived-456sdz/Build/Products/Release-iphonesimulator/BlackcrabRemote.app`.

## Remaining acceptance

The full interface has not yet passed cold launch, retained existing catalog, pairing, or remote idle-thread controls on an installed simulator app. OS boot alone is not app acceptance. An owned iOS 26.2 simulator completed migration, but the resource watchdog shut down the disposable device before app installation. Device Hub subsequently remained visible to the user while computer automation returned `cgWindowNotFound`.

No provider turn, pairing grant, or production-host mutation was performed during these attempts. The user explicitly approved Apple XCUITest on a fresh owned simulator paired with an isolated test host for catalog retention, rename and archive, without provider runs or existing-device changes. The compiled runner has not executed; prebuilt Products/path validation and the nonsecret logging canary precede real credentials. Installed validation still needs stable resource headroom. Physical-device behavior, remote push, distribution signing, and complete mobile parity remain open. The older platform-baseline launch in #210 cannot substitute for these full-interface checks.

## Owned XCUITest harness

The isolated native acceptance harness merged to `stage` in [#220](https://github.com/BonJenn/blackcrab/pull/220) at `fc671854433909d6a8e0b5085a043f729e3cd5aa`. Its 25 portable guards and all five CI jobs passed; the unchanged runner passed build-for-testing. The first fresh simulator booted and installed the baseline, then stopped before XCTest at the installed-inventory guard. Only ten framework executable modes differed; bytes and strict signatures matched. The corrected guard accepts only those pinned mode changes after framework and Mach-O validation, and passed against the installed bundle read-only. No pairing, credential, host or provider run occurred. The owned simulator was removed with identity checks and evidence retained. The corrected canary is held below the six-GiB stable internal start threshold. Installed full-interface acceptance is still required.
