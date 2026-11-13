# Project documentation and handoff maintenance

Keep this file and CLAUDE.md identical. Read ../AGENTS.md.

`agent-handoff.md` is the dated continuation checkpoint; update it when work
moves, not just at final completion. `agent-handoff-prompt.md` is the copyable
replacement-agent prompt. It must agree with that checkpoint.
`t3-parity-plan.md`, `mobile-ios-parity-plan.md` and `t3-parity-ledger.md` contain
implementation order, scenario obligations and historical evidence.

Record a capability's implementation, integration, accepted runtime scope and
delivery independently. Preserve source SHAs and artifact/platform boundaries.
Historical open-item paragraphs can be superseded by later evidence; do not
delete their provenance or count old failed attempts as later successes.
Do not estimate completion from the number of PRs, imported files or ledger rows.

Keep the remaining-work list actionable: next file/worktree, test, expected
outcome and concrete blocker. Include authoritative local evidence pointers
without secrets; mark temporary paths as potentially absent.
Report stale plan entries rather than repeatedly asking the user for already
completed authorizations. Distinguish user-deferred actions from tool failures.

Every handoff must state the finish line: validated parity, a current normal
Mac app installed on the user's computer, and an iOS build available in their
TestFlight. Before claiming delivery, identify the installed app path/version
and the processed TestFlight app/build/tester state.

Guidance files are paired per directory, not identical across different areas.
Do not add instructions inside immutable vendor trees, generated resources,
node_modules, build artifacts or private credential directories.

Read the Current checkpoint before historical sections. Older active-handle,
open-PR and next-step statements are evidence of their time, not instructions
to restart work. Keep the copyable prompt focused on the current checkpoint;
retain historical provenance behind an explicit divider in the main handoff.

## 0.4.1 signed-helper startup defect

The owner failure is now reproduced. Read the current handoff before historical
startup notes. A signed app executable cannot simply be copied as a standalone
service issuer: its external signed Info.plist is lost and macOS kills it. Use
the separately built/signed/notarized CLI helper embedded in Root. Preserve
existing service configuration/generation during an explicitly stopped upgrade.
Signature verification, real helper readiness and actual app UI acceptance are
different checks; do not label the whole delivery complete from the first two.

## Published 0.4.2 workspace — 2026-11-13

Mac v0.4.2 is public from cb586b1f4832714e624c4a328b777ef321670fd3. Actual installer,
helper, payload, version, notarization and updater verification passed; anonymous
public downloads passed. Preserve the public tag/assets. Read the current handoff
before historical build/publishing instructions; all release build handles have
completed. The release uses OWNER_TESTING_AUTHORIZED, not PASSED native lifecycle
acceptance. The owner's private candidate was not replaced by this publication.
Some host diagnostic copy remains: preserve the production c04c4d44… manifest until
an explicitly stopped, data-preserving host migration is implemented and tested.
Full parity and final user installation/runtime acceptance remain separate work.

## Published 0.4.3 and next platforms — 2026-11-13

Mac 0.4.3 is public from 18055fbc080faa4f6d518c420b19040ce45e3296. The actual signed/
notarized installer, helper, complete payloads, updater cryptography, anonymous
public downloads and production website passed verification. Preserve the public
release; no packaging job remains active. Native lifecycle status remains
OWNER_TESTING_AUTHORIZED, not PASSED. The owner's existing app was not replaced.
TestFlight 1.0.0 (4) is unchanged. Read the current handoff before historical sections.
Windows/Linux runtime inputs merged inPR288, but new producers, service/transport,
installers and native lifecycle tests remain unfinished. Their public downloads
remain 0.3.0. Retain the c04c4d44… production host pending a data-preserving migration.
