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
