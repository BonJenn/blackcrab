# Native root and host integration

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

## Boundaries

The Tauri root preserves legacy desktop behavior and is the trusted entry into
managed hosts/full desktop. Native commands must validate their own authority.
Do not accept renderer-supplied package paths, digests, credentials or PIDs as
proof of ownership. Bundled defaults must not override an existing host choice.

The pending desktop/service stack adds packaged resources, independent service
ownership, native attachment and browser transport. Check the actual branch
before assuming those modules are on stage. Keep one owner per environment and
preserve existing environment IDs, service journals and user databases.

Package verification, private owned paths, symlink/mode checks, archive pins and
publication barriers are product invariants. Fix an actual mismatch rather than
disabling verification or changing expected hashes without a reviewed source diff.
Existing service attachment and fresh service initialization are distinct paths.
OS service installation, adoption and migration must be deliberate and scoped.

## Native testing

Use the actual crate and focused tests for modified modules, with the locked
Cargo graph. Check Linux/Windows compile paths when touching shared native code.
Fixture/API acceptance is not equivalent to clicking the original Root window.
Keep launch/reuse/normal quit/reopen/reattach, host survival and browser retention
as explicit native scenarios. Track the precise source and payload versions.

Use isolated QA identities/data and captured child handles; never infer process
ownership from a PID search. Cleanup must settle owned tasks and children.
The latest recorded UI blocker is `cgWindowNotFound`, including Finder. Recheck
the tool when appropriate; do not certify UI behavior via hidden eval shortcuts.
Do not ask the user to test an old QA bundle as if it were the current build.

## Delivery

Review scripts/tauri-build.mjs and the signed release workflow before packaging.
A local ad-hoc signature is not Developer ID signing/notarization. The user's
finish line includes a current normal Finder-launchable Mac installation.
Preserve existing app data when installing and verify the installed version and
ordinary launch path after installation.
