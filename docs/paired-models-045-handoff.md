# Continuation handoff: paired models for Blackcrab 0.4.5

Checkpoint: 2026-11-14 UTC. Implementation and local source validation are complete.
CI/review and actual delivery are separate. This file supersedes earlier versions
of this focused handoff, including the retired canonical-registry approach.

## Copyable continuation prompt

Continue the owner's requested 0.4.5 feature: a plus button beside the model name
in the chat composer selects a second model and the two collaborate on one task.
Read this file, `docs/paired-models-045.md`, root AGENTS.md, and the nearest guides.
Do the work yourself; do not delegate. Confirm T3's worktree binding before edits.
Use only `/Users/jonathanbenn/.t3/worktrees/blackcrab/fix-macos-updater-cross-volume`,
local branch `fix/macos-updater-cross-volume`. Do not edit/reset/clean/switch/stage
main or another thread's worktree. Preserve installed apps, conversations, service
data, accounts, and keys. This feature is for **0.4.5**, not the coordinated 0.4.4
release. Continue CI/review on its draft PR; do not merge, publish, tag, promote
main, or activate production recipes independently.

## Exact source and status

- Implementation commit: `73a187a82d5d244dedc99fb98e1bb14100518c88`.
- Integration base: stage `5ec76354669b335cec3a9be5fdb6ccc01e5d4471`, including
  completed Mac fixes and inactive IDE source. Stage can advance concurrently.
- Repository: `https://github.com/BonJenn/blackcrab.git`.
- Feature remote branch: `feat/paired-models-045`. The local branch retains the
  original T3 binding. Push future changes with `git push origin HEAD:feat/paired-models-045`.
- Draft PR: https://github.com/BonJenn/blackcrab/pull/304 (linked to this thread).
  CI/review is pending. Keep it draft for 0.4.5; do not recreate the PR.
  Implementation commit is above; final PR head includes this documentation update.
- CI follow-up on `0b838c49f20e5b15c86fd622aed931aa62f89369`: the host job passed;
  desktop types and draft tests passed, but browser installation failed because
  `ubuntu-latest` selected Ubuntu 26.04.1 and pinned Playwright 1.60 does not provide
  its headless Chromium/dependency bundle there. The workflow now explicitly uses
  `ubuntu-24.04`, matching the existing cloud-clients browser job. Browser testing
  on the replacement CI run remains pending; no dependency pins were changed.
- Documentation commits can follow the implementation commit. Obtain the exact
  current head from `git rev-parse HEAD` and the PR before reporting it.
- No build, browser, test, provider task, or native packaging job remains active.
  All cited commands completed. Do not restart cancelled or historical handles.
- No AGENTS.md/CLAUDE.md changes. Keep any future changed pair byte-identical.
- Main `/Volumes/G-DRIVE PRO/Programming/blackcrab` contains unrelated dirty work.
- Production service manifest stays
  `c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83`.

## What is implemented

The plus opens the existing provider/model catalog. The selected partner appears
beside the primary with a labeled remove button. Exactly two models are selected.
The choice is per composer/environment and survives sending and draft hydration.
The primary stays pinned when the durable thread temporarily uses the reviewer.

One host command/receipt transaction persists three sequential normal runs:
primary does the task, partner reviews, primary resolves findings and responds.
The host queue owns them even after closing the renderer. Cross-provider handoff
carries the task and prior output; same-provider continuation uses native history.
Duplicate command receipts cannot create extra passes. Queued model choices are
immutable. The reviewer is instructed not to edit; this is **not** a separate
read-only sandbox. Serial execution retains the existing single-writer lifecycle.

Stop holds remaining passes. Failure/interruption cannot automatically start a
dependent pass; explicit queue resume retains its existing behavior. A resumed
pass does not prove its failed predecessor succeeded. Both provider enablement
checks remain enforced. Same exact model pairs, slash commands, explicit
steer/restart, and independent multi-thread fanout conflicts are rejected.
Responses to existing approval/question prompts retain their original behavior.

A new host advertises `pairedModels`. An old host disables the new UI's plus and
cannot silently turn a saved pair into a single-model send. The installed service
is unchanged. Real delivery requires a verified new host and the coordinated,
stopped, data-preserving migration, plus a 0.4.5 client.

## Authoritative files and release isolation

- `managed-desktop/paired-models/desktop/`: ten exact renderer/contracts records,
  including picker, draft persistence, send context and Chromium test/config.
- `managed-desktop/paired-models/host/`: seven exact host/contracts records,
  including atomic scheduling, failure/Stop dependency checks and real host tests.
- `managed-desktop/paired-models/prepare.mjs`: explicit `desktop` or `host` profile.
  It authenticates the pinned archive and production recipe first, then applies
  feature records, returning `releaseEligible: false`.
- `managed-desktop/paired-models.test.mjs`: exact patch and isolation tests.
- `.github/workflows/paired-models.yml`: independent desktop/host CI matrix.
- `managed-desktop/paired-models/validation.json`: exact record hashes and results.
- `docs/paired-models-045.md`: behavior and remaining native limitations.

No release builder imports the feature recipe. Production registries, native QA
identity pin, service profile, and real-build freeze are unchanged. Do not refresh
the freeze from source-only evidence. Do not package the opt-in source using
unchanged production provenance. Promote both profiles together for 0.4.5.

## Validation completed

- **102/102 host tests**, zero skips: complete ProviderSwitch integration (58) and
  original Stop suite (44). Nine paired cases cover completion across providers,
  same-provider context, duplicate receipt, lead/review failures, actual in-flight
  Stop, same-model/unknown-provider refusal, and queueing behind existing work.
  These passed both in editable development source and fresh actual service source.
- **78/78 composer draft tests**, including persisted partner scope and lead
  retention through durable reviewer switches.
- **2/2 Chromium functional tests**: add, keyboard replacement, Escape, removal,
  duplicate lead disabled, and old-host gating. These are real picker interactions,
  not native layout or installed-window acceptance.
- **44/44 final source/recipe/freeze checks**, zero skips, with authenticated
  original-source fixture enabled. This combines 38 existing integrity checks and
  six feature-isolation/unchanged-freeze checks.
- Complete web, desktop and server types passed. Fresh service-profile types passed.
- Full feature web renderer build passed in 4m10s; only large chunk warnings.
  Verified the partner UI strings appear in the built JS. Tailwind accounted for
  most build time. Earlier broad-browser attempts timed out/cancelled; they are
  not acceptance. The focused browser config avoids unrelated warmup/styles.
- Both final opt-in profiles were prepared from the authenticated archive and
  matched validated feature source byte-for-byte (10 desktop, 7 host files).
- Zero real provider runs, paid requests, installed-app changes, service restarts,
  account/key changes, or use of existing user databases for feature tests.

No native installer, real authenticated two-model task, full ChatView/native layout,
service migration, or user upgrade acceptance is claimed. Those remain delivery
work for 0.4.5, alongside the separately owned IDE feature.

## Immediate next actions

1. Inspect CI/reviews on draft PR #304. Keep it draft and out of 0.4.4.
   The thread will watch it after this checkpoint is pushed; on a T3 wake do not
   relink/rewatch/list it. A replacement thread must read its current watch state.
2. Handle CI/reviews. After any PR creation/push, link its full URL as the next
   tool call. If waiting, call `watch_pull_request` and end the turn; no CI polling
   loops. On a wake do not relink/rewatch/list the already watched PR. Before actual
   handback call `unwatch_pull_request`. Fix small findings yourself; no delegation.
3. Preserve the isolated recipes and completed validations when updating from
   stage. Do not activate production merely to make CI pass.
4. Coordinate PR/head with the release/IDE threads. User delivery and activation
   require the later release integration and data-preserving host migration.
5. Update this handoff after changes. Do not wholesale rewrite shared handoff docs.

## Local working source, logs, and commands

All relative paths below are inside the bound worktree. Scratch is ignored and
not required to reproduce the committed feature recipe.

- Editable source: `.local/two-model-045/blackcrab-desktop-source-E7gImG`.
- Validated actual service source: `.local/two-model-045/blackcrab-managed-source-4wXI0E`.
- Final opt-in source: desktop `blackcrab-desktop-source-MbKBIA`, host
  `blackcrab-managed-source-xh0j6a`, both under `.local/two-model-045/`.
  `isolated-final-sources.json` records exact roots and comparison results.
- Original desktop preimages: `.local/two-model-045/before/`.
- Original host baseline: `.local/two-model-045/blackcrab-managed-source-VhX2op`.
- Earlier edit scripts are historical, state-dependent, and not safe to rerun.
  **Never run `registries-canonical-retired.py`**: it rewrites production recipes.
  Update only the feature registries/patches/payloads if source changes.
- Logs under `.local/two-model-045/`: `pair-final-host-tests.log`,
  `pair-store-tests.log`, `pair-browser-focused.log`, `pair-final-recipe-tests.log`,
  `pair-web-types.log`, `pair-final-host-types.log`, `pair-desktop-types.log`,
  `pair-web-build.log`. Search type logs for actual errors; upstream suggestions
  are not failures. No log contains deliberate credential dumps.
- Verified archive:
  `/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/verified-reference-inputs-secp9xmc/t3-reference.tar.gz`.
- Original source for integrity fixtures: same directory's `t3-source`.
- Upstream pin: `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`.

Use Node 26.12.1, not the shell's Node 24. Set PATH only in the task shell:

```sh
export PATH='/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/toolchain/node_modules/node/bin:'"$PATH"
```

pnpm 12.14.0 entry is the adjacent `toolchain/node_modules/pnpm/bin/pnpm.mjs`;
invoke it with pinned Node. Install the frozen graph with `--ignore-scripts
--prod=false`. Existing scratch already has dependencies. `linkDependencyCache`
in `managed-desktop/dependencies.mjs` supports read-only reuse and rebinding
workspace packages to fresh source. No global TMPDIR/environment changes.

Inside prepared `apps/server`:

```sh
node ../../node_modules/@effect/tsgo/dist/effect-tsgo.cjs tsrs --noEmit
node --no-experimental-webstorage ../../node_modules/vite-plus/bin/vp test run \
  src/orchestration-v2/testkit/ProviderSwitch.integration.test.ts \
  src/orchestration-v2/ThreadStop.test.ts --maxWorkers 2
```

Inside prepared `apps/web`:

```sh
node ../../node_modules/@effect/tsgo/dist/effect-tsgo.cjs tsrs --noEmit
node --no-experimental-webstorage ../../node_modules/vite-plus/bin/vp test run \
  src/composerDraftStore.test.ts --project unit
node --no-experimental-webstorage ../../node_modules/vite-plus/bin/vp test run \
  --config test/pairedModels.config.ts --maxWorkers 1
node ../../node_modules/vite-plus/bin/vp build
```

At repository root:

```sh
BLACKCRAB_SERVICE_PROFILE_SOURCE_ROOT='/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/verified-reference-inputs-secp9xmc/t3-source' \
node --test managed-host/service-profile.test.mjs managed-host/source.test.mjs \
  managed-desktop/source.test.mjs managed-desktop/native-keychain-qa.test.mjs \
  fork-integration/native-keychain-qa/recipe.test.mjs \
  managed-desktop/paired-models.test.mjs managed-host/build-source-freeze.test.mjs
```

## Prior work already completed; do not redo

- Cross-volume updater PR #297:
  https://github.com/BonJenn/blackcrab/pull/297
  head `649ac85063e45f5656d98a15e638287a8af06ebb`, merge
  `2dd550585224c9294d0b6898d5d379e02438d331`, all 10 checks passed, unwatched.
  See `docs/updater-cross-volume.md`. Exact published 0.4.1 outer Tauri plugin
  2.10.1 backup rename across devices caused EXDEV; destination-local verified
  staging/backup/rollback is implemented and fixture tested. User app not replaced.
- Reboot recovery PR #301:
  https://github.com/BonJenn/blackcrab/pull/301
  head `097b9582d291d1b5ace3ce36f5979fbfbc1db2c3`, merge
  `52a29b2cdb0ef304631a195c0d1635ca7fdb7687`, all 10 checks passed, unwatched.
  The owner's actual Mac 0.4.3 had lost its private temporary browser channel
  directory during reboot. A narrowly scoped repair recreated the missing owned
  directory/marker; actual Retry then opened the existing workspace and threads.
  Config, service manifest, data, keys, generation, and installed binary stayed
  unchanged. Permanent source fix is merged; coordinated release remains separate.
  See `docs/desktop-browser-reboot-recovery.md`.
- Verified official manual 0.4.3 installer:
  https://github.com/BonJenn/blackcrab/releases/download/v0.4.3/Blackcrab_0.4.3_aarch64.dmg
  SHA256 `bef53de938facfa52f6f1c39f3cc9081eaa23bcaf7fdc56f8975733fc70acaf1`.
  App-only replacement preserves data/service; user-run upgrade acceptance remains
  distinct from isolated installer tests.

## Coordination identifiers

Read a thread with `t3_thread_read` before answering about it. Use its returned
link verbatim when mentioning it to the user. Send coordination messages only;
do not use these threads as delegated workers.

- This thread:
  `mcp:launch:9f0a45035cf57a29e46162025f2b69a3c23eab736c44618d8e89ad227ecc90a0`.
- Original 0.4.4 release coordinator:
  `053479ec-de11-4e1a-8ca0-8b74ac8da042`.
- User-requested separate IDE thread:
  `mcp:launch:3c5e8bd13440ddf9eb62df0e6a67baaaed51f4df71da76dba0aac4532266ebe0`.
  PR #300 is merged at `77e84aa`, with IDE mode inactive for 0.4.4.
  Local stage fast-forward subsequently included #302 at `5ec7635`. Verify
  current release state before future integration; this does not authorize
  activating either 0.4.5 feature.

The React best-practices skill was applied to the picker/component edits:
`/Users/jonathanbenn/.codex/plugins/cache/openai-curated-remote/vercel/0.54.1/skills/react-best-practices/SKILL.md`.
Preserve keyboard/label behavior, pane-scoped state, existing native ownership,
attribution, and exact patch integrity. No AI author/coauthor trailers or footers.
