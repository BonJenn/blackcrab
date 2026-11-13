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

The next code task is safe background-service upgrading and remaining host message
branding. Local-only REL/workspace-polish-042, branch fix/host-product-copy-042 at
a62414a, has 159 reviewed copy patches and 33 passing source/artifact tests. Its
real build was cancelled without adoption, and its producer freeze remains old.
The public release intentionally uses the original c04c4d44… host manifest.
Existing attachment pins the host manifest and a fixed runtime version directory;
implement a stopped-service migration preserving identity, credentials, environment,
catalog and generation before changing that artifact. Read the exact files and
constraints in the current handoff. Do not substitute a re-signed host copy, weaken
manifest checks or test migration against user data.

Use one coherent PR per change, validate it and merge to stage. Keep AGENTS.md and
CLAUDE.md identical within each changed directory. Preserve the dirty main checkout,
provider ownership and public releases. Continue through validated desktop/mobile
parity, a current normal Mac app installed for the user and an available TestFlight
build; publication alone does not finish the original goal.
