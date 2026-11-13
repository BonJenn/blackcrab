# Managed full desktop producer

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

## Implementation

This producer packages the pinned full Electron client for a separately owned
Blackcrab host. It must not start another host or claim legacy provider sessions.
`source.mjs`, `patches/registry.json`, runtime payloads, dependency staging,
`build.mjs` and artifact verification form one traceable production recipe.
Patch order matters when multiple records change the same upstream file.
Update before/after/patch/payload digests only from the reviewed exact changes.
Never dump complete registry replacement strings into chat; some embed huge files.
When the production registry changes, review the exact delta and verify the QA
identity predecessors before updating fork-integration/native-keychain-qa's
whole-registry pin. Do not weaken that check or refresh the host build freeze.

The browser bridge preserves the original browser Manager/CDP/services. Retire
old connection epochs and cancel their work without closing successor sessions.
Effect event/command callbacks must retain their surrounding services; validate
JSON through typed schema codecs. Do not introduce unhandled callback defects.
Keep browser detach cleanup when integrating owned cloud/link behavior.

## Build and validation

Use Node 26.12.1 and pnpm 12.14.0. Prepare fresh pinned source, install the frozen
graph and check complete upstream desktop types, not only the root TypeScript.
Run relevant managed-desktop Node tests and actual upstream regression suites.
Preserve singleton Effect/React resolution and complete secondary runtime closure.

Use the producer's exact Electron archive and complete notices. Output must be
absent; preserve archive symlinks and code signatures. Stage publication on the
output filesystem to avoid EXDEV; use the pending packaging fix where applicable.
Do not copy a partially published artifact and declare the build successful.

PR #215's current browser bridge passes full types and CI, but current normal
Root launch/reuse/quit/reattach acceptance is still required. Historical direct
FD/native-browser and sealed Root QA runs are bounded to their older artifacts.
The #223–251 desktop chain contains additional HOME/storage/runtime/type/QA
fixes; read the real stack before integration. Do not lose either branch's fixes.

Keep QA-derived identities and permission policies separate from production.
A QA or unselected artifact is not the normal installed Blackcrab.app.

## Sole workspace and owned branding

The owner removed the legacy root UI; this client is the primary desktop. Keep
onboarding, environment/account selection, shared marks and recovery copy branded
Blackcrab. blackcrab-ui-copy-* registry records are exact deltas applied after the
existing adapters. Internal protocols, package names and upstream license notices
retain their original identity. Do not rename compatibility keys as cosmetic work.
Onboarding must direct users to Blackcrab Settings → Sharing & access rather than
download/run the upstream T3 service. Assets use the already-owned packaged icon.

## Owner workspace polish — 2026-11-13

Audit visible strings in shared packages as well as desktop/web components. The
Appearance theme label and About version escaped the first pass. Preserve saved
IDs and legal attribution; remove upstream product/store links and subscription
upsells. Derive renderer/package/native workspace version from the Blackcrab
release and include it in web cache provenance. Each pane owns its composer ref;
only the focused pane registers global commands. Folder locations must use the
selected environment's filesystem, never assume the browser's host is the target.

Audit the compiled renderer as well as component source: provider settings derive
labels from shared schemas. renderer-branding.mjs runs on fresh and cached builds
and on hosted web output. Keep GitHub CLI/token authentication; do not offer T3's
GitHub app as if Blackcrab owned it. Historical profile names and CLI ownership
markers are compatibility data. Host-generated status and agent instructions need
their own service source audit; changing the client alone does not change them.

## Polished 0.4.2 source integrated

PR277–279 are merged at 1140889d5a6730d336b6f1a16347d2d1d33ca82c. Source types and
browser picker/pane tests pass. Do not restore shared pane composer ownership or
upstream displayed version/copy. Read the live delivery plan and current handoff
for the rebuilt artifact and native acceptance; source integration is not delivery.

## Imported monitor notifications

Historical server imports can label Claude monitor envelopes as user messages.
Keep importedTaskNotification presentation restricted to the known complete
format and imported provenance. Never filter arbitrary pasted XML, mutate history
or interpret notification text as a command. Preserve expandable raw text and
ordinary guest/scheduled attribution. Run the original timeline browser regression
as well as focused parser/source tests; test fixtures contain synthetic content.

## Split-pane header controls

Window-fixed panel controls must not be reused inside each pane. Closed-panel
controls occupy the same header flow as move/close; open-panel controls are local
to the owning pane. Preserve top-trailing native-caption insets and explicit
no-drag hit regions. Check actual browser hit testing across top/bottom rows and
open/closed panels; raising z-index alone merely reverses which button is blocked.
