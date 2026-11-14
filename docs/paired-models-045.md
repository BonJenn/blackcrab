# Paired models for 0.4.5

## Scope and delivery boundary

The owner requested a plus button beside the chat model name to choose a second
model and have both work on the same task. This work is reserved for **0.4.5**;
keep its PR draft and separate from the coordinated 0.4.4 release. It does not
publish a release or change the installed application, accounts, keys, or service.
The separate IDE-mode work can be integrated with this composer change for 0.4.5.

## User flow

- The `+` beside the primary model opens the existing provider/model picker.
  Choose a different model from an available provider. The second model appears
  beside the primary, with a labeled remove button. Only two models are selected.
- Submit a normal task. The primary works, the second model reviews the work,
  and the primary addresses findings and gives the final result. The tooltip
  describes these three passes and their use of both models.
- Each pass is a normal, visible run in the same conversation and workspace.
  The review is instructed to inspect and report findings without editing; this
  is a model instruction, not a separate read-only sandbox. Runs execute serially
  through the existing queue, preserving the single-writer lifecycle.
- Stop holds the remaining queue. A failed or interrupted predecessor cannot
  automatically start a dependent pass. Existing explicit queue resume remains
  available; a resumed pass is not evidence that its failed predecessor succeeded.
- The pair is saved per composer/environment, survives draft hydration and sending,
  and can be removed. The primary stays pinned while the host temporarily switches
  to the reviewer. Selecting different models later does not rewrite queued runs.
- Paired tasks are separate from the existing multiple-model option that creates
  independent threads. Normal paired tasks queue behind active work; explicit
  steer/restart and slash-command requests are rejected for paired execution.
  Responses to existing approval/question prompts keep their existing behavior.

## Implementation and integrity

All changes are exact patches/payloads on the authenticated upstream commit
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`. The opt-in recipe lives in
`managed-desktop/paired-models/` with distinct desktop and host registries.
`preparePairedModelsSource({profile, archive, cacheDir})` first authenticates the
archive and production profile, then applies the feature records. It returns
`releaseEligible: false`. No release builder imports this recipe. The production
registries, native-keychain QA pin, service profile, and real-build freeze stay
unchanged. Promote both profiles together only for the coordinated 0.4.5 delivery.

The optional `pairedModel` message context selects the partner. A single host
command/receipt transaction creates the lead, review, and resolution runs, with
stable message IDs and persisted predecessor metadata. Receipt replay cannot
create extra passes. The ordinary provider-switch context builder supplies the
original task and previous output across providers; same-provider continuation
uses its existing native session. Provider enablement is checked for both models
on normal dispatch and new-thread launch. Existing runtime modes, policy ceilings,
permissions, provider validation, and worktree preparation remain authoritative.

The host advertises `pairedModels`. An older host leaves the plus button disabled;
a saved pair cannot silently submit as a single-model task against that host.
This matters for the existing production service manifest:
`c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83`.
It remains untouched. Delivering this feature to that Mac requires the coordinated,
data-preserving host migration and a 0.4.5 desktop containing the new renderer.
Client-only installation cannot enable it against the old service.

## Verification

Validation uses isolated source/SQLite/workspace fixtures and synthetic provider
adapters. No real provider task, paid model request, installed-app replacement,
service restart, or existing user database is involved.

- Full provider-switch/context and Stop suites: **102 tests passed**, including
  nine paired scenarios for cross-provider completion, same-provider continuation,
  duplicate receipt, lead failure, review failure, Stop, identical models, and an
  unknown partner provider, and queueing behind an existing task. Assertions inspect real persisted orchestration runs
  and adapter requests; invalid pairs commit zero runs.
- Full composer draft suite: **78 tests passed**, including saved partner scope,
  hydration/clear behavior, and primary selection through durable review switches.
- Exact source/profile and native-keychain recipe checks: **38 tests passed**,
  with the authenticated original-source fixture enabled. After isolating the
  recipe, **6 further checks passed** for feature patch application, release
  isolation, invalid profiles, and the unchanged real-build freeze. Both opt-in
  profiles were also prepared from the real archive and compared byte-for-byte
  with the source used for the successful types and behavior tests.
- Complete producer desktop, renderer, and server typechecks passed. The actual
  service profile was separately prepared and typechecked successfully.
- Chromium functional picker tests: **2 passed**, exercising add, keyboard
  replacement, Escape, removal, duplicate-model refusal, and old-host gating.
  The focused config avoids unrelated application warmup; these tests do not
  certify native layout or window behavior.

The full feature-enabled web renderer build also passed. The build reported large
chunk warnings; no build error or static chunk cycle was reported.
`managed-desktop/paired-models/validation.json` records exact recipe hashes and results.

These are source and fixture results. Actual authenticated two-model execution,
packaged native UI, service migration, user upgrade acceptance, and release
publication remain separate 0.4.5 delivery work.
