Continue Blackcrab parity and the explicitly requested 0.4.4 release for Mac,
Windows and Linux. Read AGENTS.md, the CURRENT checkpoint in docs/agent-handoff.md,
docs/desktop-updates.md and docs/cross-platform-workspace-delivery.md first.

The current user request is working workspace update checks, restored install
notifications, download/installation progress, and publication for all three OSes.
The later Blackcrab Connect question asks about cross-device readiness; it does
not replace this work. Publication is already authorized; no redundant approval.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Active source is REL/workspace-updates-044, fix/0.4.4-workspace-updates, based on
stage ef3f4aea11734d8059698d12b7d2211b4d545cf1. Read REL/workspace-044-plan.json for
current PR/head/process/test state. Main checkout is extensively dirty: never
reset, clean, switch, stage-all or remove unrelated files there. Old handoff handles
are historical. The pinned prepared source in workspace-044-validation is complete;
do not repeat preparation or change frozen prior release producers.

Updater implementation delegates existing Electron UI to the signed outer Tauri
app over private FD5, retaining FD3/FD4 and original pairing. It restores automatic
availability notices, explicit install/restart, real download progress and
indeterminate installation progress. Only captured workspace shutdown is allowed;
the independent host survives. Read docs/desktop-updates.md and exact tests. Finish
final validation, create/link the coherent PR to stage, watch and end the turn when
waiting on CI, then merge after current checks/reviews. Never poll watched PRs.
Local browser notification execution is blocked before collection by the secondary
dependency overlay's CommonJS selector import; the required fresh-install CI job
must pass it. No local process is running. Native signed upgrade/service retention
remains a distinct acceptance obligation.

Mac 0.4.3 is still public at 18055fbc080faa4f6d518c420b19040ce45e3296; Windows/Linux
public downloads remain 0.3.0. 0.4.4 is not published. Implement real Windows/Linux
native packaging, launch, authenticated transport, per-user services and updater
metadata/tests before publishing them. Do not toggle producerImplemented or use
historical root-only packages as a shortcut. Bump version together after source
integration, verify actual artifacts, publish authorized releases, then update
website downloads/blog/release notes. Preserve public tags/assets and user data.

Keep the Mac service manifest c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83
until a stopped, data-preserving upgrade is implemented. No extra host or provider
commands during updater probes. TestFlight 1.0.0 (4) remains unchanged.

Connect sign-in/discovery and owned relay/database are implemented with basic live
health evidence, but two-computer/iOS sign-in, session discovery, off-network agent
control, reconnect/revocation and push need complete end-to-end acceptance. Existing
credentials/spending/account access remain authorized; do not print secrets or
repeat completed owner sign-ins. Paid-hosted access/billing remains separate work.

Keep AGENTS.md/CLAUDE.md pairs byte-identical and handoffs current. Distinguish source
checks, native runtime evidence and public delivery. The goal is not finished.
