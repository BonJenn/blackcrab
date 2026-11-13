# Blackcrab 0.4.2 — One workspace

Draft release notes. The updated installer and end-to-end runtime validation are
pending; these notes do not announce a published update.

Blackcrab opens directly into its new workspace, with projects, agents, source
control and terminals together. The older Claude/Codex interface has been removed.
Startup prepares the background service automatically, preserves existing workspace
identity, and shows recovery controls if the workspace cannot open. Reopening the
app returns to the same workspace. Quitting the workspace keeps its host available.

This update also corrects the signed-service-helper defect in 0.4.1 and replaces
remaining T3 branding in onboarding, environment selection and account screens.
A dedicated signed and notarized helper replaces the invalid standalone copy of
the main app executable. Existing conversations and workspace data remain on disk.

This release is for Apple-silicon Macs. It includes no new iOS, Windows or Linux
build. Full desktop/mobile/hosted parity is still being validated.
