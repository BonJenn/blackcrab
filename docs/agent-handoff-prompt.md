Continue Blackcrab desktop/mobile parity and Windows/Linux delivery.

First read AGENTS.md, docs/agent-handoff.md (the newest checkpoint),
docs/cross-platform-workspace-delivery.md and the appropriate paired directory
guides. Preserve the extensively dirty main checkout; use owned worktrees.

Mac 0.4.3 is PUBLIC from 18055fbc080faa4f6d518c420b19040ce45e3296. Its signed/notarized
installer, independent helper, complete payloads, updater crypto and anonymous
public downloads passed. Website production at 7aebba7bbd55b2deefd3f2012d2ba058cc996115
is live and verified; do not restart old packaging/notarization/publishing work.
No process is running. App PRs 286–288 and website PR16 are merged/unwatched.
Native lifecycle checks remain OWNER_TESTING_AUTHORIZED, not PASSED. The owner
has not yet accepted 0.4.3 UI/service behavior. Preserve public releases and user
data. TestFlight 1.0.0 (4) unchanged; full parity still unfinished.

Windows/Linux remain 0.3.0 downloads. PR288 added only explicit pinned runtime
inputs/layouts and architecture verification; it did NOT build their installers.
Continue native packaging/dependency closure/manifests, Root launch, authenticated
transport, per-user background services and installation/update/lifecycle tests.
Start with managed-desktop/targets.mjs/build.mjs/artifact-structure.mjs,
src-tauri/src/managed_desktop.rs and managed_service_control.rs. Keep Mac manifest
compatibility. Do not bypass producerImplemented or substitute root-only releases.

The current production host manifest is c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83;
a host change needs an explicitly stopped, data-preserving manifest migration.
Existing cloud credentials/spending/account authorizations remain authorized;
never print secrets or repeat completed owner sign-ins blindly. Maintain one
host/writer per thread and control only originally captured child processes.

Live local evidence: /Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/
mac-release-040-v2llrqsa/workspace-043-plan.json and workspace-043-delivery/.
Read the plan for current docs PR state before repeating changes. Release producer
workspace-release-043 and final workspace-final-release-043 are frozen. The owned
cross-platform-targets checkout currently holds docs/0.4.3-published-handoff.
Make coherent PRs to stage and merge after current checks/reviews; public Mac 0.4.3
was manually dispatched from the exact verified stage commit. No transition to
main-based releases was approved or made. Keep paired AGENTS/CLAUDE files identical,
keep this prompt current, and distinguish source tests, native evidence and delivery.
