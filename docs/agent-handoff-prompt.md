Continue Blackcrab parity and release delivery. Read AGENTS.md and the current
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
Create/link/check/merge that PR, then address host-supplied visible copy recorded in
D/host-product-copy-audit.txt. Host has a separate source profile; client patches
alone do not change provider messages or runtime instructions. Rebuild affected
artifacts honestly and preserve service identity during a stopped upgrade.

Then build/sign/notarize the final source, replace only the backed-up private 0.4.2
draft, build Root and verify actual installer/helper/payload/updater signatures.
Validate native UI/lifecycle, install and publish Mac, then website. Native capture
worked for Finder this turn. The running app is still the previous working candidate.
Website 7281830 passed all local checks but is unpublished. TestFlight 1.0.0 (4) is
available; full parity remains uncertified. Keep handoffs and paired guides current.
