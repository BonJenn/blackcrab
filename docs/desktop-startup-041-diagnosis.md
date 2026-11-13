# Full desktop startup failure in 0.4.1

The owner reported that 0.4.1 still looked like the original interface and displayed
“Full desktop is unavailable in this installation.” This was reproduced in the
actual signed 0.4.1 app on the build Mac, independently of the work-Mac report.

## Reproduction and causes

1. Refresh desktop status changed the actual Root window to ready.
2. Open full desktop returned unavailable and disabled the button again.
3. The published desktop archive passed the native extraction/cache/verifier test.
4. There was no managed-host configuration. The native host refused Open with its
   existing instruction to enable the service, but the entry replaced that with
   a generic package-unavailable message.
5. Enabling the background service through the real UI prepared its runtime and
   registered launchd, but the launcher repeatedly logged “Owned service bootstrap
   is unavailable.” The service was then stopped through the UI.
6. Its installed issuer bytes exactly matched the Root app binary. Outside the
   app bundle, `codesign --verify --strict` reported invalid Info.plist. A captured
   issuer preflight process was killed by SIGKILL before emitting a readiness
   frame. No credential request or agent command was sent.

The release's Developer ID signature binds Root's external Info.plist. Copying
only that executable does not create a valid standalone program. Earlier native
fixtures using differently signed test binaries did not establish this behavior
for the real published app.

## Correction

Build `blackcrab-service-issuer` as a dedicated CLI with no GUI fallback. Sign it
as a standalone executable, verify it, and require Accepted notarization during
a signed release. Embed the resulting immutable bytes into Root before Root is
signed. This avoids Tauri signing a resource again after its identity was selected.
The actual installed copy retains the standalone signature and compiled host pin.

Explicit install/start/restart refreshes the helper only after launchd is stopped
and the native ownership leases and stopped-journal policy pass. The selected
runtime, configuration, environment ID, generation and journal remain unchanged;
the previous binary remains available. Direct ownership and active/uncertain
sessions are not migrated. No caller can provide a helper path over IPC.

The native desktop entry preserves fixed setup/start instructions and leaves a
manual retry available after a launch error. A Full desktop button in the Claude
and Codex main toolbars exposes service setup and the desktop action together.

## Evidence and remaining validation

The local Developer ID standalone helper passes strict signature verification,
executes argument validation, and completes the actual private readiness protocol
with clean EOF. A fresh native test additionally exercises initial runtime setup,
old-helper replacement, active-lease refusal, configuration preservation, signature
verification after relocation, and the real helper protocol. It never starts an
OS service or requests provider execution. Its opt-in test is
`managed_host::service_issuer::tests::production_standalone_helper_and_stopped_upgrade`.
The corrected fresh run passed in 308.65 seconds. Its report is
`standalone-acceptance-result.json`; its log records one passing opt-in test.
Production helper notarization and actual Root-window acceptance remain separate.

Local evidence is under
`/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa/desktop-launch-041-diagnosis`.
The first test attempt supplied /dev/null instead of the required private input
pipe: startup reached the helper but EOF validation failed. The separate pipe
preflight passed; the corrected full regression uses a captured pipe and closes
it without sending authorization frames. Preserve this distinction in reporting.

The diagnostic service's stopped and unloaded startup registration was archived
outside LaunchAgents; configuration and workspace data were retained. Native CUA
later returned cgWindowNotFound, which does not prove that the app closed.

The corrective app still needs packaging, notarization, actual UI/service launch,
reuse/quit/reopen and upgrade testing. Do not label full desktop or overall parity
accepted from helper-only tests. Published 0.4.0/0.4.1 tags and assets are immutable;
the correction requires a new release.
