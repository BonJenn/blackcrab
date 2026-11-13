# Blackcrab 0.4.2 — One workspace

Blackcrab opens directly into its new workspace, with projects, agents, source
control and terminals together. The older Claude/Codex interface has been removed.
Startup prepares the background service automatically, preserves existing workspace
identity, and shows recovery controls if the workspace cannot open. Reopening the
app returns to the same workspace. Quitting the workspace keeps its host available.

This update also corrects the signed-service-helper defect in 0.4.1 and replaces
remaining T3 branding in onboarding, environment selection and account screens.
A dedicated signed and notarized helper replaces the invalid standalone copy of
the main app executable. Existing conversations and workspace data remain on disk.

The workspace now displays Blackcrab’s release version and replaces remaining
upstream product labels and links, including the Appearance theme name. The
project picker includes Home, External drives and Computer shortcuts. Images
dropped into a split conversation stay in the intended pane, while global composer
commands follow the focused pane.

This release is for Apple-silicon Macs. It includes no new iOS, Windows or Linux
build. Full desktop/mobile/hosted parity is still being validated.

Some background-service diagnostics still use upstream terminology; that cleanup
will follow with a data-preserving service upgrade. This release retains the
working service package and does not claim complete parity.

Published November 13, 2026 from `cb586b1f4832714e624c4a328b777ef321670fd3`.
[Download the signed and notarized Mac release](https://github.com/BonJenn/blackcrab/releases/tag/v0.4.2).
Owner UI/lifecycle testing follows publication; artifact verification is complete.
