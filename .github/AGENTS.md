# CI and distribution workflows

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

## CI

Required jobs cover frontend/workspaces, Rust, Windows, host smoke, iOS portable
guards, pinned cloud clients/backend and hosted web builds. The exact job set
depends on the branch and workflow version; inspect the current run.
Preserve full upstream desktop/server/web typechecks and meaningful regressions.
An infrastructure cancellation or package mirror failure is not automatically
a code defect; read the failed job before retrying or changing product code.
Never bypass failed checks or count a cancelled/skipped acceptance as passing.

## Secrets and releases

The existing release workflow has Apple signing/notarization secret names and
the Tauri updater key configured in the repository. Presence does not establish
current validity, API role, personal-team ownership or iOS distribution access.
Do not export GitHub secrets into artifacts/chat or attempt to retrieve their
plaintext through a diagnostic workflow. Use them only in their intended jobs.

The release workflow is explicitly dispatched. Managed Apple-silicon is the
default and consumes a separately pinned, accepted payload archive from a draft
release; the historical root-only matrix requires an explicit selection. Tag
creation alone no longer launches the historical build. Keep the release a draft
until the installer and updater have passed their delivery checks. Never use the
legacy mode as a parity release. See scripts/macos-release/README.md. The remote
iOS app has its own device archive/signing/submission and TestFlight gates.

User intent now includes installing the Mac app and publishing to their
TestFlight. Complete build/review/validation work and use that authorization;
do not add a redundant approval stop for routine release steps. Escalate only
an actual missing account action, legal agreement or new spending decision.
The user explicitly authorized existing cloud credentials on 2026-11-12;
the earlier Clerk rotation hold no longer blocks deployment.

## Explicit v0.4.0 publication instruction — 2026-11-12

The owner said: "publish the mac release and ill test it myself. this will be
version 0.4" and requested the website, blog and release notes workflow too.
This supersedes the earlier requirement to wait for native window capture before
merging/publishing v0.4.0. Record OWNER_TESTING_AUTHORIZED for that exact release
and source, never PASSED. The owner will perform UI/lifecycle and upgrade testing
after publication. Keep signing, notarization, payload integrity and updater
signature checks. Publish the verified Apple-silicon release and then update the
website to its real downloads. No additional publication confirmation is needed.


## Tauri release compatibility

Keep the root @tauri-apps/api and plugin npm versions on the same major/minor
lines as their Rust crates in src-tauri/Cargo.lock. These npm dependencies are
exact-pinned after broad caret ranges drifted and blocked the 0.4.0 native release.
Run npm run check:tauri-versions when either lockfile changes. The guard runs in
CI and before release payload processing; do not disable Tauri's version check.
Change npm/Rust pairs together when upgrading, and validate actual native packaging.


## Notarization authentication selection

The managed tauri-cli wrapper selects one complete notarization method before
spawning the native build. Prefer the explicit App Store Connect key ID, issuer
and key file path, as the workflow preflight and final DMG step do. Remove
APPLE_ID and APPLE_PASSWORD from the child environment when using API auth;
empty strings are not sufficient because Tauri checks presence and prefers
Apple ID first. Preserve signing identity/team and updater credentials. Never
log the environment. The original API preflight passed while the mixed-auth
Tauri build failed with Apple ID HTTP401; no key rotation is needed for that bug.


## Draft installer validation

A source-bound DRAFT_VALIDATION_PENDING record permits an explicit --draft-build
only. The workflow must independently confirm the release is a draft and leave it
a draft. Build the actual signed/notarized installer, then validate native UI and
service lifecycle; pending evidence is never acceptance or public publication
permission. Default validateAcceptance rejects it. Do not extend old owner-testing
exceptions or invent successful lifecycle checks to build a candidate.

## Actual Linux service integration

managed-linux-host.yml builds the real pinned host and helper, then runs native
initialization/systemd/authenticated attachment against that archive in a new
disposable OS account. test-linux-service-manager.py --actual-host must observe
exactly one passing test, never a zero-match/ignored success. Preserve account
refusal and cleanup. No provider prompt, existing service, production credentials
or Mac payload migration belongs in this job. GUI/installer delivery is separate.
