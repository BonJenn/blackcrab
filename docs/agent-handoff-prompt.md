# Continue Blackcrab delivery

## Current checkpoint — 2026-11-12: PR275 merged; replacement Mac candidate building

PR275 passed all nine checks on efdb0ea2e1e7cbda5ea8bb65c96384dc0e995799,
including full hosted web build/typechecks/tests in both modes. It merged to
stage d9b5601d424e9808ee2c8dcac5bf42f8cf97d137 and was unwatched. Do not relink,
rewatch or merge it again. The old interface is removed from this source.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
The immutable release worktree is REL/desktop-default-042-release at that merge.
Delivery artifacts and scripts live in REL/sole-workspace-042-delivery (D).
Read REL/desktop-default-042-plan.json first for current handles and phase; it
supersedes transient process descriptions here. Keep the main dirty checkout/index
and the frozen release worktree untouched. Documentation updates belong in
REL/desktop-default-042 until the release source has been delivered.

D/desktop-build-result.json records BUILT_VERIFIED_UNLAUNCHED: the new branded
production desktop built and passed full desktop/web typechecks, web/native build
and exact inventory verification. Its unsigned manifest is
9875c74ac15a3375b8d53364c63f9eb8ab6ebf13b3b2f78c22881073a012704d.
D/sign-notarize.mjs completed successfully: Apple accepted the new desktop,
its ticket is stapled and Gatekeeper/signature verification passed. D/prepare-inputs.py
is preparing draft-only inputs; read the live plan for its current handle.
IMPORTANT: deliver the previously notarized unchanged service-host bytes with
manifest c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83.
Native attachment requires the existing service manifest, so do not select the
newly re-signed host from the notarization derivation. The host code did not change.
The live plan records serviceArtifact and notarizedDesktop separately. Original
artifacts are unchanged; no new app is launched, installed or published. Saved Apple credentials are private;
never print the signing-preparation file or env files.

The private draft has been replaced and release workflow 43380980343 is running
at d9b5601d424e9808ee2c8dcac5bf42f8cf97d137. The draft input ZIP SHA-256 is
01cf7268deb6868f00d275e8da1db30864957f807230162ce650166f2c07ff7b. The new
notarized desktop manifest is
1c8425779907103e2d370e1c90c4ef99d1de0ec51d11cb0eef543f92dc69c56d.
D/watch-and-verify-release.py runs in captured shell handle 5635: it watches this
release workflow (not a PR), validates the helper receipt for the exact source,
then downloads and verifies actual Root/DMG/updater/payloads. Resume that handle;
do not dispatch a duplicate build. It never launches or publishes. Read the live
plan and final-artifact-verification-latest.json for completion/failure.
Public 0.4.0/0.4.1 assets are unchanged. Actual automatic launch/reopen/quit/service
recovery and catalog-retention checks remain after packaging. The read-only
before-upgrade-catalog.json records one project, four v2 threads and no agent runs,
with hashed catalog/identity/configuration values, not conversation contents.
DRAFT_VALIDATION_PENDING is not passing native evidence.

The earlier Root/client/service remain running for the owner. CUA observed four
settled threads and an empty draft in the existing client; no prompts were sent.
Do not adopt or kill processes by discovered PID. Use actual CUA app controls;
getApp/getAXState can relaunch a quit Mac app, so inspect Finder/process counts
after quitting rather than querying that app again. Its current desktop path and
previous evidence are in REL/patch-042-delivery/native-runtime-progress.json.

Website REL/website-patch-042 is locally committed at
c5f96a8 (branch release/0.4.2-website), unpushed/unpublished. Home, setup docs,
metadata, blog and changelog now describe the sole workspace and remove retired
grid/shortcut claims. Download tests, scoped lint, Next production build and types
passed; paired guides match. Publish the verified Mac installer first, then create
and link the website PR, verify its preview and deploy. Do not claim full parity.
TestFlight 1.0.0 (4) remains available; no new mobile build is part of this change.

Finish line: validated desktop/mobile/hosted parity, a current normal Mac app
installed for the owner, and the processed iOS build available in their TestFlight.
This release work is not full parity certification. Temporary evidence paths may
be absent after cleanup; inspect before resuming, and never recreate an ownership
claim from a stale process ID.
