# Managed host and background-service producer

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

The host reuses BonJenn/t3code at the recorded upstream pin. It owns managed
thread execution, persistence and permissions independently of desktop/mobile UI.
Do not reimplement domain writes in a client or start a second session writer.

## Build contract

Source preparation authenticates the reference archive and exact patch records.
Preserve original licenses and dependency notices. Node 26.12.1 / pnpm 12.14.0
and the frozen source/runtime dependency graphs are part of the build contract.
Use verified fresh outputs and complete manifests, not a source-workspace import
as proof a relocated package will work. Treat old /private/tmp paths as optional:
check they still exist and match their recorded source before any reuse.

The pending service profile/controller stack adds offline frozen dependency
preparation, native issuer identity and owned publication. Read the implementation
present on your branch; portions are still stacked PRs rather than merged stage.
Keep server typechecking and original browser-channel regressions in the build.

## Lifecycle and protocol

Independent ownership, client attachment, OS service activation and migration
are different operations. Existing selections/owners remain authoritative.
Authenticate an existing listener before sending bootstrap credentials.
Private browser paths/keys must not appear in public environment projections.
Do not relax readiness clocks, integrity checks or protocol capabilities to
make a failing fixture pass; investigate the concrete failure.

The service Launcher.stop regression in #260 clears timers again inside the
serialized stop transition: an in-flight ownership transition can install a
timer after the initial clear. Preserve that fix when merging older branches.
Test stopped-service refusal, owner fencing, restart identity and host survival
after client quit. Unknown commands must not be automatically resubmitted.

Only stop captured fixture children. No broad process-name kills or PID adoption.
Publish scoped, redacted evidence with actual cleanup and provider-run counts.
Source/build/native-component success does not prove live remote deployment.
