# Root desktop renderer

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

Preserve existing Claude/Codex views, pane identity, drafts, retained history
and provider-specific setup while exposing managed workspaces/full desktop.
The root renderer uses React 19.1; mobile uses a distinct React 19.3 graph.
Use existing typed native clients and host services rather than copying domain
mutation logic into React state or bridging arbitrary renderer paths/credentials.

Scope asynchronous state and actions to the current window/pane/environment/run.
Late responses cannot overwrite a replacement pane or clear its newer draft.
Do not automatically replay uncertain sends or approvals after reconnect.
Provider/project setup errors must not be mislabeled as a lost connection.

Run relevant Vitest behavior tests and root typechecking/build after changes.
Native entry wiring requires actual original Root-window acceptance in addition
to renderer tests. Historical API fixtures and successful package extraction
are narrower evidence. Keep the UI's loading/error/retry states actionable.
Preserve user-facing functionality; keep QA machinery and artifact internals
out of normal product flows unless users need them to make a decision.
