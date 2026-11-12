# CI and distribution workflows

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

## CI

Required jobs cover frontend/workspaces, Rust, Windows, host smoke, iOS portable
guards, pinned cloud clients/backend and hosted web builds. The exact job set
depends on the branch and workflow version; inspect the current run.
Preserve full upstream desktop/server/web typechecks and meaningful regressions.
An infrastructure cancellation or package mirror failure is not automatically
a code defect; read the failed job before retrying or changing product code.
Never bypass failed checks or count a cancelled/skipped acceptance as passing.

## Secrets and releases

The existing release workflow has Apple signing/notarization secret names and
the Tauri updater key configured in the repository. Presence does not establish
current validity, API role, personal-team ownership or iOS distribution access.
Do not export GitHub secrets into artifacts/chat or attempt to retrieve their
plaintext through a diagnostic workflow. Use them only in their intended jobs.

The current workflow builds Tauri release installers and creates a draft GitHub
release. Audit whether it includes the reviewed managed host/full desktop
payloads before calling it a parity build. The remote iOS app still needs its
own device archive/signing/submission and processed TestFlight availability.

User intent now includes installing the Mac app and publishing to their
TestFlight. Complete build/review/validation work and use that authorization;
do not add a redundant approval stop for routine release steps. Escalate only
an actual missing account action, legal agreement or new spending decision.
Keep cloud deployment separate while the recorded Clerk rotation is unresolved.
