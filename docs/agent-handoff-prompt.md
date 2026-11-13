# Continue Blackcrab delivery

## Current checkpoint — new workspace becomes the only desktop UI

The owner confirmed the first 0.4.2 workspace looked good, identified T3 branding
in environment selection, and explicitly requested removing the older interface
entirely. That instruction supersedes all historical legacy-view preservation
guidance. The corrected helper already runs in the real signed candidate, the
service is running, Full desktop opened and repeated Open reused one captured
client. No provider prompt was sent by the assistant. This is narrower than full
lifecycle acceptance. The owner is using that candidate; do not kill its processes.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Current worktree REL/desktop-default-042, branch feat/new-workspace-default-042,
based on stage 184500a423f87b47cd49c6ac31d8022d26f3af59. Read
REL/desktop-default-042-plan.json for current handles/validation/PR. The older
REL/desktop-patch-042-plan.json points here. The main dirty checkout/index is untouched.
PR273/274 are merged and unwatched. Private v0.4.2 workflow 43369124588 succeeded;
its artifacts passed signature/notarization/updater/payload checks but are now
superseded by the owner's new UX instruction. Do not publish that earlier draft.

The new source removes legacy renderer components and their obsolete UI tests,
replaces App with automatic managed service/workspace startup, narrows Root native
commands, and stops initializing the old remote-session server. Root retains only
startup/recovery, service controls and signed updates. AppKit activates only the
captured child before Root hides. Workspace Quit exits Root while leaving the
service running; crash recovery stays visible. User data is never deleted.

123 exact pinned producer deltas replace human-facing T3 wording across desktop
and web surfaces, shared logo components, onboarding environment/account selection
and instructions. Internal protocol/package names and upstream legal notices
remain. Upstream T3 Chat subscription/link pages are removed from account navigation;
tunnel usage and management remain, with server limits unchanged. Rebuild the managed
desktop payload; the old branded payload is insufficient.

Validation/evidence lives in REL/desktop-default-042-validation. Root frontend
TypeScript, 151 renderer tests and Vite production build passed, as did native
`cargo check --locked`. Full upstream web and desktop typechecks passed after all
branding/account changes. Managed producer/identity/contract checks passed 85 tests;
cloud configuration checks passed 12 tests. A fresh pinned source extraction applied
all 197 patches exactly. These are source checks, not packaged GUI acceptance.
Final launcher typecheck/build and 26 focused startup/settings/updater tests passed
after the last updater cleanup change. Service/update controls prevent navigation
while their operations are in flight.
Read the live plan for final source, PR and any active handles.
Next: create/link the coherent PR, merge only after current CI/review, rebuild and
notarize the branded desktop payload, then build the new exact-source Root draft.
Verify automatic first launch, reopen, quit, service survival and recovery in the
actual signed app before publication/installation and website updates.

The existing website 0.4.2 branch is validated but local/unpublished; rewrite its
copy to this final single-workspace behavior before creating its PR. Keep current
public 0.4.0/0.4.1 assets immutable. TestFlight 1.0.0 (4) is available. Overall
finish line remains accepted desktop/mobile/hosted parity, a current normal Mac
app installed, and TestFlight available. No full-parity completion is asserted.
