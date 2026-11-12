# Build and release scripts

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

Use argument arrays with captured subprocesses, bounded timeouts and logs.
Do not interpolate credentials or user paths into shell command strings.
Preserve the main dirty checkout and shared installed dependency trees.
Native builds should use exact committed source snapshots and owned work areas.

`prepare-mobile-ios.mjs` currently prepares/builds a standalone arm64 simulator
Release using physical whitespace-free staging, the locked npm graph, recorded
native patches/resources and an iOS 18 pod floor. Its isolated environment
intentionally excludes account credentials. A generic device destination alone
does not change its explicit iphonesimulator SDK or ad-hoc signing policy.
Implement a deliberate device archive/export path for TestFlight; do not label
a simulator product as an IPA or quietly inject signing secrets into snapshots.

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
