Continue Blackcrab parity and release delivery. Read AGENTS.md and the current

## Current checkpoint — 2026-11-13: publish the workspace fixes now

The owner explicitly renewed publication. Release branch release/0.4.2-owner-publication
in REL/workspace-publish-042 starts from merged c0e9fbd (PR280 passed nine checks).
Its only code change records the exact renewed 0.4.2 owner-publication instruction,
bound to the final source and immutable published 0.4.1 baseline; it does not claim
native lifecycle acceptance. Retain the existing production service artifact/pin.
The separate local a62414a host-copy branch changes 159 source files, but cannot
yet ship: existing service attachment binds the old compiled manifest and runtime
version directory. It requires a deliberate stopped-service manifest migration.
Its producer build was cooperatively cancelled through original handle 69082;
await the final audit before calling it stopped. Do not refresh its source freeze.

Desktop build handle 53133 uses immutable REL/workspace-final-042-release at a62414a.
The desktop producer inputs and 337 patch records are unchanged from c0e9fbd; verify
that equality before signing/reusing the artifact for the publication branch.
Output is REL/workspace-final-042-delivery. All actual handles and release state
are in REL/workspace-polish-042-plan.json. The old 1140889 build remains superseded.

Next: complete the current desktop build; verify producer equality; sign/notarize
with the ORIGINAL production host; merge the publication PR after required checks;
pack the exact merged source, replace only the private v0.4.2 draft assets, dispatch
the managed release workflow, verify actual downloaded installer/updater/signatures,
publish GitHub and then the website. Keep service-message cleanup as an explicit
remaining follow-up. Do not claim every host message or full parity is complete.

checkpoint in docs/agent-handoff.md before historical notes. User wants ALL visible
T3 product branding removed, Blackcrab 0.4.2 shown, easy external volumes, and correct
pane image drops. PR277–279 merged with nine checks each. Their 1140889 desktop built,
but a compiled audit found provider-schema branding and an unowned GitHub app link.
Signing 18842 was cancelled (exit 130) before notarization. Do not publish that artifact.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/workspace-polish-042-plan.json. Active owned worktree:
REL/workspace-polish-042, branch fix/provider-product-branding-042.
D=REL/workspace-polish-042-delivery; V=REL/workspace-polish-042-validation.
Four corrective patches and a compiled-renderer guard are implemented. Eighteen focused
and twelve cloud tests, full desktop/web types, 337 fresh patches pass. The corrected compiled renderer passes its guard (958 JavaScript files), and the
guard rejects the old bundle. Handle 49347 is complete; no build is running.
PR280 is open and watched. Its initial frontend failure was the QA recipe's stale
whole-registry pin; after checking the unchanged 333 records and four new records,
the pin was refreshed. The failed group plus keychain producer tests pass: 70 passed,
one pre-existing skip. Await CI on the correction and merge, then address host copy in
D/host-product-copy-audit.txt. Host has a separate source profile; client patches
alone do not change provider messages or runtime instructions. Rebuild affected
artifacts honestly and preserve service identity during a stopped upgrade.

Then build/sign/notarize the final source, replace only the backed-up private 0.4.2
draft, build Root and verify actual installer/helper/payload/updater signatures.
Validate native UI/lifecycle, install and publish Mac, then website. Native capture
worked for Finder this turn. The running app is still the previous working candidate.
Website 7281830 passed all local checks but is unpublished. TestFlight 1.0.0 (4) is
available; full parity remains uncertified. Keep handoffs and paired guides current.
