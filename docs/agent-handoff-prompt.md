# Continue Blackcrab delivery

## Current checkpoint — 2026-11-12: installer verified; Mac locked

The owner wants the older interface removed and the new workspace to open directly.
PR275 passed all nine checks and merged to stage
`d9b5601d424e9808ee2c8dcac5bf42f8cf97d137`; it is unwatched. Do not rewatch it.
This source removes legacy views, launches the workspace automatically, retains
service recovery/updates, and replaces onboarding/environment/account branding.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/desktop-default-042-plan.json for authoritative current paths/status.
Frozen release source: REL/desktop-default-042-release at that merge SHA.
Docs worktree: REL/desktop-default-042, branch docs/sole-workspace-delivery-042.
Delivery directory D=REL/sole-workspace-042-delivery. Main dirty checkout/index
and frozen release source remain unchanged. No build is still running; handle
5635 completed successfully. Do not restart or dispatch the completed build.

Release workflow 43380980343 passed. Downloaded Root, helper, DMG and updater
passed Developer ID signatures, Apple notarization, Gatekeeper, updater crypto,
payload inventories and archive pins. The mounted DMG app matched the updater
app and the mount was removed. Evidence:
D/final-artifact-verification-rhld0rqc/result.json.
Verified Root: D/final-artifact-verification-rhld0rqc/updater/Blackcrab.app.
New desktop manifest:
1c8425779907103e2d370e1c90c4ef99d1de0ec51d11cb0eef543f92dc69c56d.
Retained service manifest:
c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83.
Use the plan's serviceArtifact: native attachment requires the existing service
pin. Host code is unchanged. Do not select the newly re-signed unused host from
D/notarized-payloads. Helper SHA:
84247061376750240246a5bd0450f5d9eabb3c724d51b1cb3ecdf5863726db62.
Draft input ZIP SHA:
01cf7268deb6868f00d275e8da1db30864957f807230162ce650166f2c07ff7b.

The current blocker is a locked build Mac. Read-only IOConsoleUsers reports the
current user on-console with CGSSessionScreenIsLocked=true. CUA reports
cgWindowNotFound for the old Root/client and Finder, even after reconnect/reset.
No normal quit succeeded, and the new app has NOT been launched or installed.
The old Root/client/service remain running. No provider commands were sent.
The owner has been asked to unlock the Mac and bring Blackcrab to the front.
After unlock, quit the old app normally through CUA, launch the exact verified
new app, then validate automatic launch/reuse/reopen/quit and service recovery.
Do not adopt or kill discovered PIDs. After Quit, inspect Finder/process counts;
getApp/getAXState can relaunch a quit Mac app. D/snapshot-catalog.py records only
hashes/counts. Baseline before-upgrade-catalog.json: one project, four v2 threads,
no runs. Check catalog/configuration/identity retention across the native tests.

A byte-verified review DMG is available at
/Users/jonathanbenn/Downloads/Blackcrab_0.4.2_new-workspace_aarch64.dmg
(SHA-256 eeaa46ca88d1235d309e98b82ff728a24622d4323a7916e8e5fb4eb25832e993).
0.4.2 remains a private draft. DRAFT_VALIDATION_PENDING is not passing native
acceptance. Public 0.4.0/0.4.1 assets are unchanged. After native validation,
publish/install this exact candidate, then publish the website changes.

Website REL/website-patch-042, branch release/0.4.2-website, head 45a3ae7,
is committed locally but unpushed/unpublished. Home/setup/metadata/blog/changelog
now describe the sole workspace; retired grid/shortcut claims are removed.
Download tests, scoped lint, Next build and types passed; paired guides match.
Create/link its PR after the Mac release is public, review the preview, and check
production routes and real Mac/previous-platform download redirects.

Finish line: validated desktop/mobile/hosted parity, a current normal Mac app
installed for the owner, and the processed iOS build available in their TestFlight.
TestFlight 1.0.0 (4) remains available; this change has no new mobile build.
Full parity is not certified. Temporary paths may disappear; inspect evidence
before resuming. Keep credentials private; never print saved auth/env files.
