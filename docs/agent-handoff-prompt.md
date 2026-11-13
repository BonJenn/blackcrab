Current 0.4.3 checkpoint: desktop producer 7a3a642 completed; signing handle 76314
is owned by this delivery. Website checks pass, unpublished. Policy branch
release/0.4.3-owner-update records the current update request plus the existing
manual-testing preference, tied to public 0.4.2 cb586b1f…. It never marks native
lifecycle tests PASSED. Read REL/workspace-043-plan.json and the current handoff
before resuming or starting a process. Do not mutate the frozen desktop producer.

Current owner instruction: continue and deliver the update. Mac 0.4.3 is being
prepared in REL/workspace-release-043 (release/0.4.3-workspace-fixes), based on
stage 9a265383072f9b69a9e7f95cb8c94a8447f35f63. PR283/284/285 are all merged and
unwatched. Read REL/workspace-043-plan.json and the current handoff before any
old release commands. Never modify public 0.4.2. Windows/Linux full-workspace
packages still need platform producer, service/transport and native validation.

Continue Blackcrab desktop/mobile/hosted parity. Read AGENTS.md, the CURRENT
checkpoint in docs/agent-handoff.md, docs/t3-parity-plan.md and the scenario ledger.

Mac 0.4.2 is published from cb586b1f4832714e624c4a328b777ef321670fd3. Its actual
signed/notarized installer, payloads, embedded helper, version and updater signature
passed verification; anonymous downloads passed. Do not rebuild, republish, move
the tag or replace public assets. Full parity/native lifecycle acceptance is not
claimed: OWNER_TESTING_AUTHORIZED records the user's exact publication request.
The owner’s working private candidate was not replaced in this turn. TestFlight
1.0.0 (4) remains unchanged.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/workspace-polish-042-plan.json and
REL/workspace-final-042-delivery/delivery-handoff.md for the latest deployment and
documentation state. All release build/signing/verification handles completed;
never restart old handles. Website PR14 merged at 7b4cf8594001ff0b236508bcbf911446f0523051;
its production deployment and anonymous pages/downloads are verified. Do not
repeat publication; read the production verification record for evidence.

The owner confirmed the workspace opened after Try again and permission prompts.
Current follow-ups: macOS dialogs still name t3; imported monitor notifications
appear as user XML bubbles; rightmost pane move/close controls overlap panel
buttons; then prepare full-workspace Windows x64/Linux x64.
Read the newest handoff checkpoint before historical host-migration instructions.
REL/macos-native-identity (fix/macos-service-identity) adds LaunchAgent responsible
bundle association and a stopped-only metadata upgrade preserving the existing
host. Eight native tests, 25 renderer tests and TypeScript passed; actual prompt
attribution still needs native validation. Test processes completed. Do not reset
TCC, interrupt existing agents or replace the retained host merely for branding.
The separate host product-copy branch still needs a data-preserving manifest
migration; it is not a prerequisite for adding LaunchAgent bundle association.

Current integration: PR283 merged at ec746f13; PR284 merged at cc54beb2335cf3b414e62504110299399a36a238,
both after nine passing checks and both unwatched. PR285 is now based on stage and
includes cc54beb in REL/pane-toolbar-placement, branch fix/pane-toolbar-placement.
Wait for its current combined-head CI, then merge to stage. Do not act on delayed
checks for its old feature-parent base. Local 104-test desktop/cloud/QA suite and
four actual browser cases passed; required CI validates the combined integration.
All local processes have completed. Exact current head is in the live plan above.
After merge, deliver a newly built/validated Mac update, then Windows/Linux full
workspace packages; public 0.4.2 must remain immutable. The main-promotion release
flow was discussed but not implemented; the existing release workflow is manual.

Use one coherent PR per change, validate it and merge to stage. Keep AGENTS.md and
CLAUDE.md identical within each changed directory. Preserve the dirty main checkout,
provider ownership and public releases. Continue through validated desktop/mobile
parity, a current normal Mac app installed for the user and an available TestFlight
build; publication alone does not finish the original goal.
