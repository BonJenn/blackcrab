# Apple-silicon release tooling

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and ../../AGENTS.md.

This is an isolated npm package with the pinned Electron signing tool. Install
with `npm ci --ignore-scripts --workspaces=false`; do not change the app's native
dependency graph just to install release tools.

`sign-payloads.mjs` derives signed copies from verified production desktop and
background-service artifacts. It refuses QA artifacts, preserves the original
payloads, signs all Mach-O code, verifies Developer ID/team/timestamp/hardened
runtime, rejects unrelated content changes, and regenerates exact manifests.
Its successful state is SIGNED, NOT NOTARIZED. It does not launch, install,
publish, or prove native behavior. Keep those later gates explicit.

`notarize-payloads.mjs` submits a new immutable copy, requires Apple Accepted,
staples the desktop app, checks Gatekeeper, and regenerates manifests. The signed
native build wrapper also verifies signatures/tickets after archive roundtrip.

`release-inputs.mjs` packs only clean committed stage source with the matching
passed native lifecycle evidence and notarized payloads. Never fabricate that
evidence to get a build through. `.github/workflows/release.yml` is now manual:
managed Apple-silicon is the default, legacy root-only is explicit. The existing
Tauri action performs updater signing with its intended GitHub secret. The
workflow creates a draft; successful packaging is not installation or an update
acceptance result. Read README.md for the remaining release gates.

The CLI entitlements match the pinned upstream Node/V8 recipe. Electron's
helper entitlements use the pinned osx-sign defaults. Restricted associated-domain
and browser-passkey entitlements require an actual owned provisioning profile;
do not invent grants or claim those features are accepted without validation.

Notarization must include the actual inner native payloads before final Root
archive pins are generated. Stapling changes app contents, so re-inventory after
stapling and verify the final packaged copies. Preserve updater signing identity
and existing user data. Never publish a universal Root with arm64-only payloads.

Credentials stay in the existing local keychain/private files or intended GitHub
secret inputs. Never dump them or try to extract GitHub secrets through artifacts.

## Explicit v0.4.0 publication instruction — 2026-11-12

The owner said: "publish the mac release and ill test it myself. this will be
version 0.4" and requested the website, blog and release notes workflow too.
This supersedes the earlier requirement to wait for native window capture before
merging/publishing v0.4.0. Record OWNER_TESTING_AUTHORIZED for that exact release
and source, never PASSED. The owner will perform UI/lifecycle and upgrade testing
after publication. Keep signing, notarization, payload integrity and updater
signature checks. Publish the verified Apple-silicon release and then update the
website to its real downloads. No additional publication confirmation is needed.
