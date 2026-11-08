# Full native mobile interface validation

PR #213 remains a draft. Source `c6035c6d55f86ec8d2c62cd64424067197f95e10` produced a fresh standalone arm64 iOS Simulator Release app; `xcodebuild` and deep/strict ad-hoc signature verification passed. This is build evidence, not installed-app acceptance or distribution signing.

The isolated producer authenticated 3,314 selected source inputs against source-manifest SHA256 `e5991c8efbd9a27310b99c0a463eccb1209b6ee1714109bf973f1b705010f7a0`. The built Hermes bundle is 18,905,732 bytes, SHA256 `849d7c30299cf1483b91c4d928f73d5f6a24135642046a61956bfc9866927874`. The built source map covers 4,479 sources with one React, Effect and atom owner; the full native interface and retained legacy interface are present. Old managed-owner and QA-fixture entries are absent. App, widget and share extension products retain owned identifiers and the iOS 18 deployment floor.

Local raw evidence is preserved under `/private/tmp/blackcrab-ios-x532Wp/artifacts/` (`full-ui-build-report.json`, `built-source-proof.json`, source manifest and build logs). The unchanged standalone app is at `/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/full-ui-ios-derived-456sdz/Build/Products/Release-iphonesimulator/BlackcrabRemote.app`.

## Remaining acceptance

The full interface has not yet passed cold launch, retained existing catalog, pairing, or remote idle-thread controls on an installed simulator app. OS boot alone is not app acceptance. An owned iOS 26.2 simulator completed migration, but the resource watchdog shut down the disposable device before app installation. Device Hub subsequently remained visible to the user while computer automation returned `cgWindowNotFound`.

Those early attempts performed no provider turn, pairing grant, or production-host mutation. The user explicitly approved Apple XCUITest on a fresh owned simulator paired with an isolated test host for catalog retention, rename and archive, without provider runs or existing-device changes. The later runner and baseline pairing results are recorded below; they do not certify the full interface. Installed validation still needs stable resource headroom. Physical-device behavior, remote push, distribution signing, and complete mobile parity remain open. The older platform-baseline launch in #210 cannot substitute for these full-interface checks.

## Owned XCUITest acceptance progress

The validation harness merged to `stage` in [#220](https://github.com/BonJenn/blackcrab/pull/220). The baseline logging canary passed one actual native UI test with no failures or skips. Xcode appended an index/UUID to the exported completion name; the corrected parser revalidated the retained official result with exact phase, nonce, device and test identity. The coordinator reviewed the private evidence and approved the canary receipt. No UI rerun was needed. The Swift runner and app binaries were unchanged. This validates the baseline input/result pipeline, not the full interface.

A paired attempt subsequently connected its SDK observer but stopped before native pairing because its fresh host had no project. The fixture now creates the project through the real public `projects.mutate` API and observes its shell projection before creating the idle thread. A host-only preflight passed with zero runs/provider sessions and captured-host closure. All 27 portable guards passed. The full-interface retained catalog, native rename/archive, broader controls and distribution gates remain open.

The next paired attempt passed the baseline pairing UI (1/1, no skips) but stopped before upgrade at a redundant app-termination command. That command is removed. Cooperative owner abort now precedes fixture interruption; 27 portable guards pass. The failed attempt's lost host handle remains recorded as unclosed; a separate scoped OS recovery observation records its verified shutdown, without replacing the original receipt.

A real SDK host-only abort preflight passed: zero runs/provider sessions, aborted acceptance remained failed, the live owner closed its actual host Child, and no framework interruption signals were needed. Original SDK source/package hashes remained unchanged. No device or UI was used.
