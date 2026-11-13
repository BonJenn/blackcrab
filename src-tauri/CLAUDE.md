# Native root and host integration

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

## Boundaries

The Tauri root owns startup/recovery for the sole managed desktop interface.
It no longer starts or exposes the retired session UI/server. Native commands must validate their own authority.
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
Native CUA captured Finder on 2026-11-12, clearing the earlier universal
`cgWindowNotFound` failure. Verify the current Blackcrab window separately;
do not certify UI behavior via hidden eval shortcuts.
Do not ask the user to test an old QA bundle as if it were the current build.

## Delivery

Review scripts/tauri-build.mjs and the signed release workflow before packaging.
A local ad-hoc signature is not Developer ID signing/notarization. The user's
finish line includes a current normal Finder-launchable Mac installation.
Preserve existing app data when installing and verify the installed version and
ordinary launch path after installation.

## 0.4.1 signed-helper startup defect

The owner failure is now reproduced. Read the current handoff before historical
startup notes. A signed app executable cannot simply be copied as a standalone
service issuer: its external signed Info.plist is lost and macOS kills it. Use
the separately built/signed/notarized CLI helper embedded in Root. Preserve
existing service configuration/generation during an explicitly stopped upgrade.
Signature verification, real helper readiness and actual app UI acceptance are
different checks; do not label the whole delivery complete from the first two.

## Managed launcher lifecycle

managed_launcher hides the startup window only after activating the exact captured
Electron child. AppKit process lookup is made while holding that Child handle's
lock so it cannot be reaped/reused between the ownership check and activation.
Never accept a renderer PID or choose an app by a process-name search. Reopen
reuses the captured workspace. Normal workspace Quit exits its hidden launcher;
a crash presents recovery. Neither transition stops the independent host.
Keep service controls and signed updates available in the native launcher menu.

## macOS permission identity

Owned LaunchAgents associate with com.bonjenn.blackcrab so macOS can attribute
service access to the signed app. Recognize the exact prior unit without this
field for compatibility; reject foreign/multiple associations. Upgrade only under
the control lease after launchd and the native journal both confirm stopped.
Preserve the installed PATH and owner/runtime/lifecycle fields. Status must not
restart agents or rewrite registration. Never reset user privacy grants in tests.
