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
