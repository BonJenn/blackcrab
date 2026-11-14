# Desktop startup after reboot: missing private browser channel

## Confirmed owner incident

On 2026-11-13 Pacific, the owner reported that this Mac's installed **0.4.3**
would not reopen after the computer turned off. Root showed “Blackcrab could not
open. Try again.” and “Private native browser capability was refused.” Retrying
reached the same refusal.

Read-only diagnostics and native UI inspection confirmed the exact case:

- `/Applications/Blackcrab.app` was 0.4.3.
- Persistent owner/configuration/marker permissions and identity were valid.
- The service still selected the production manifest
  `c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83`.
- The saved browser capability had a valid path/key/generation shape, but its
  entire `/private/tmp/blackcrab-browser-…` directory was absent.
- No credential value was printed, no database was opened, and no existing PID
  was adopted or killed during diagnosis/recovery.

## Cause and persistent fix

Published 0.4.3 (`18055fbc080faa4f6d518c420b19040ce45e3296`)
stores the browser path/key/generation in persistent `configuration.json`.
`managed_browser::Capability::allocate` creates the corresponding private runtime
directory and ownership marker under `/private/tmp` to keep the socket path short.
macOS clears temporary storage on reboot; configuration outlives that directory.
`ManagedHost::read_config` previously required the missing marker to already
exist. Both Root service status and the service issuer validate the configuration
before proceeding, so neither could recreate the channel. Retry repeated the
same validation. Root also hid native IPC string errors behind a generic message.

The isolated Rust regression saved a service/direct configuration, bound its
private socket, removed only its temporary directory to model reboot, and retried
the native configuration read. Before the fix it failed with the exact reported
refusal. It never used the owner's app data.

The fix adds `ensure_runtime_directory` after persisted configuration/schema and
native support validation. It checks the owner, capability shape and canonical
short path before attempting recovery. **Only a wholly missing directory** is
recoverable. The complete 0700 directory and 0600 owner marker are prepared in
private staging and published with the existing native no-replace rename helper.
A concurrent valid restorer may win; the final directory must still pass all
original validation. Existing malformed markers, wrong permissions, regular files,
symlinks and sockets with invalid ownership/modes are refused and never replaced.

No configuration rewrite, credential rotation, new generation/environment,
provider command, host payload migration, service-unit rewrite or service restart
is part of recovery. A valid existing socket retains its inode. Root now displays
native string errors and keeps Retry available after the attempt settles.

The installed 0.4.3 helper remains unchanged. A future fixed Root can recreate the
channel before the old helper's normal launchd retry. Until the updated Root is
actually installed, a later reboot can require the guarded recovery utility again.
Updating the independent installed helper remains its separate reviewed migration;
merging this source does not silently replace it.

## Actual recovery performed

`scripts/recover-macos-browser-channel.py` is a narrow compatibility utility for
this known Mac production service. By default it checks only; `--repair` restores
only a missing temporary directory. It requires the private owner marker/config,
expected production manifest, exact socket shape, and the existing configuration
lease. It uses Darwin's atomic no-replace rename; it cannot overwrite an existing
empty directory or repair untrusted metadata. It does not expose the key.

Three isolated Python fixtures passed before using the repair on the owner Mac.
The actual repair reported **persistent configuration unchanged**. Then the normal
Root **Try again** button was clicked. The private socket became ready, launchd
reported the service running, and the actual Electron `Blackcrab (Beta)` window
showed the owner's existing threads and conversation. No test prompt was sent and
no app bundle was replaced. This is bounded actual recovery evidence, not a claim
that all desktop lifecycle or provider scenarios passed.

To check an older affected installation without modifying it:

```sh
python3 -B scripts/recover-macos-browser-channel.py
```

For this exact validated missing-directory case, run with `--repair`, then use
Root's **Try again** button. If the utility refuses, preserve everything; do not
manually delete the directory, reset app data, relax permissions or recreate the
environment to silence the validation. The helper deliberately refuses unrelated
manifest/configuration states.

## Verification and delivery boundary

Tests cover lost temporary storage with persistent identity/data unchanged for
both Service and Direct ownership, recreation followed by real socket binding,
concurrent recovery, unchanged live socket/marker, malformed existing entries,
invalid capability/owner, and Root's native string-error retry. The macOS CI job
also runs the guarded utility fixtures. Linux runs the native Unix tests in the
existing Rust job; Windows compilation remains separate.

Evidence logs are retained in the owned scratch directory
`/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/updater-cross-volume-build/`:
`browser-reboot-before.log` records the expected failing regression;
`browser-reboot-after.log` records the post-fix run.

The recovery on installed 0.4.3 is complete. Permanent source integration, signed
release packaging, installation of that new app and its behavior across a future
real reboot are distinct checks. The original release thread coordinates 0.4.4;
this fix does not independently publish a release or replace service data.

The staging tests also caught `tempfile`'s default directory permissions, which
follow umask rather than guarantee 0700. Browser recovery now explicitly requests
0700 and validates staging before publication. The updater's same-filesystem
transaction now explicitly requests 0700 too, with a regression assertion. This
hardens the earlier updater source before release; published apps are unchanged.

Local tooling used Node 26.12.1/npm 12.2.2. The isolated root-only dependency
installation omitted npm workspace links; restoring the normal local
`@blackcrab/remote-protocol` workspace link resolved the initial typecheck setup
failure. The focused renderer suite passed 20 tests, and the production
`typecheck`/Vite build passed. No lockfile or dependency version changed.

Final local validation: 12 native browser-channel tests, 23 native service-issuer
tests, 11 updater tests (both opt-in cross-device/official signed archive cases
enabled), 20 renderer tests and 3 Python recovery tests passed, with zero skips.
Renderer typecheck and production build passed. Related logs:
`browser-reboot-issuer-tests.log`, `browser-reboot-updater-tests.log`,
`browser-reboot-renderer-tests.log`, `browser-reboot-renderer-build.log`.
No local build/test remains running. Final CI/review/merge state belongs to the
linked startup-recovery PR; publication and future real-reboot acceptance remain
separate from these results and the confirmed recovery of the installed 0.4.3.
