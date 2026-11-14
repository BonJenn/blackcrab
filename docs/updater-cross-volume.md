# macOS updater cross-filesystem failure

## Published failure and cause

Owner report: Blackcrab 0.4.1 → 0.4.3 reports
`update install failed: Cross-device link (os error 18)`.
The supplied screenshot shows that error, not the installation or temp paths.
An external app volume, different temp filesystem, a mounted DMG and App
Translocation are possible circumstances, not established facts about that Mac.

The exact published 0.4.1 source is
`62ef3868d65252ba062bbee0200d6cb74a27ea6f`. Its `src/App.tsx`
`installAvailableUpdate` calls `availableUpdate.downloadAndInstall()` and prefixes
errors with `update install failed`. Both the npm plugin and Rust lock pin Tauri
updater **2.10.1** (Rust crate SHA-256
`806d9dac662c2e4594ff03c647a552f2c9bd544e7d0f683ec58f872f952ce4af`).
This predates the separate 0.4.2/0.4.3 Electron update-control problem.

In that crate's `src/updater.rs`:

1. `Update::download` authenticates downloaded bytes using the configured
   Minisign key, then `download_and_install` calls `install`.
2. `extract_path_from_executable` derives the outer `.app` from the running
   executable's `Contents/MacOS` path.
3. macOS `install_inner` creates `tauri_current_app*` and `tauri_updated_app*`
   using `tempfile::Builder::tempdir()` (system temp), extracts the archive there,
   then calls `rename(installed_app, backup_temp/current_app)`.
4. A different filesystem makes that directory rename fail with **EXDEV**.
   Only `PermissionDenied` enters its authorization branch; EXDEV returns directly.
   The final `rename(extracted_temp, installed_app)` is also cross-filesystem in
   that configuration, but the backup rename fails first. Successful extraction
   does not make either rename cross-filesystem capable.
5. A separate hazard in the pinned implementation: after a successful backup,
   failure placing the new app returns without restoration; TempDir cleanup can
   delete the backup. The replacement installer addresses that failure too.

A disposable fixture on the external build volume (`st_dev=16777242`) and system
temp (`st_dev=16777232`) reproduced errno 18 at precisely the first rename. The
old fixture remained intact. This establishes the faulty filesystem assumption,
not the owner's exact mount/path configuration. No user app/data were probed.

## Replacement transaction

`src-tauri/src/macos_updater.rs` is a Blackcrab-owned macOS installer adapter;
the pinned plugin source and signing key are unchanged. `managed_updates` still
checks the official feed/version, serializes actions and retains bytes only after
`Update::download` has verified the signature. On macOS it now installs those
bytes through this adapter. Windows/Linux retain the plugin's platform installer.
The unused renderer updater permissions are removed from both Root capabilities
so renderer IPC cannot invoke the old macOS installer directly.

The adapter derives its destination from the native executable, rejects non-app
and symlink destinations, takes a nonblocking installation lock, and creates a
private transaction directory **in the destination parent**. It checks device
identity before modifying the old bundle. No global or process TMPDIR changes,
shell commands, copied app executable, service restart or credential changes.

Extraction accepts one app root, ordinary files/directories and safe internal
relative links. Unsafe paths, escaping links, special files and incomplete
structures fail before the old app moves. The staged bundle must have the queued
version, Blackcrab identifier and executable, and pass `codesign --verify --deep
--strict` with Blackcrab's Apple Developer ID team requirement. App executable
modes and relative framework links are preserved.

Backup and replacement are same-filesystem renames. The original bundle stays
in the transaction directory through post-install verification. Failure placing
or verifying the replacement restores the old app. Failure restoring it returns
an error naming the **retained backup**, never success or automatic deletion.
Cleanup occurs only after successful verification or successful rollback; cleanup
failure after successful installation retains files and logs their location.
Application data, conversations, settings and the independent production service
manifest `c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83`
are outside this transaction and remain untouched.

## Immediate workaround for the already-installed 0.4.1

A new release cannot repair the updater already executing inside 0.4.1. Manually
replace the app using the verified official Apple-silicon 0.4.3 installer:

[Download Blackcrab 0.4.3 for Apple silicon](https://github.com/BonJenn/blackcrab/releases/download/v0.4.3/Blackcrab_0.4.3_aarch64.dmg)
([official release](https://github.com/BonJenn/blackcrab/releases/tag/v0.4.3)).

1. Download the DMG. Quit the Blackcrab desktop normally. Do not uninstall or
   stop its independent background service or use an app cleaner.
2. Open the DMG in Finder. Copy Blackcrab into your writable Applications folder
   and choose **Replace** for the old application bundle. If the old app was run
   directly from a disk image, install a copy in Applications instead. Do not run
   the app inside the DMG as the installation.
3. Eject the DMG and open the installed copy from Applications. Check that its
   version is 0.4.3 and confirm existing conversations/environment are present.
   Keep all Application Support/configuration/service directories unchanged.
4. If replacement is denied or fails, retain the old app and use Finder's normal
   permission handling. Do not delete app data, change TMPDIR, disable Gatekeeper,
   remove quarantine as a workaround, or reset the environment.

The downloaded DMG SHA-256 matches the public asset:
`bef53de938facfa52f6f1c39f3cc9081eaa23bcaf7fdc56f8975733fc70acaf1`.
The updater archive matches
`3b53a5e5631a2742e678fb805a967c2968741f15f57d039150c340d1b214079c`.
Fresh `hdiutil verify` and `xcrun stapler validate` passed for the DMG on
2026-11-13 Pacific. Existing release signing/notarization evidence remains in the
release handoff. No public release/tag is changed by this fix.

## Validation and limitations

Focused tests cover successful whole-bundle replacement, preserved executable
mode/relative symlink/unrelated data, malformed archive, failed preverification,
failed backup/replacement renames, post-install verification rollback, retained
backup on failed rollback, concurrent installation lock, symlink destination,
non-bundle executable, and native rejection of unsigned/wrong-version bundles.
The opt-in cross-device test uses actual distinct devices; the opt-in official
0.4.3 archive test checks its public digest and real native signature before and
after disposable installation. Neither launches the app or touches the user's
installed copy. The dedicated macOS CI job exercises the adapter and update gates;
Linux tests exercise the portable transaction with a fixture verifier.

Commands (from this worktree; use a caller-owned scratch target directory):

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib macos_updater
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib managed_updates
# Explicit fixture parent on a different device than system temp:
BLACKCRAB_UPDATER_TEST_VOLUME=/path/to/owned/scratch cargo test --manifest-path src-tauri/Cargo.toml --locked --lib real_cross_device -- --ignored
# Download the exact official archive above into owned scratch first:
BLACKCRAB_UPDATER_TEST_VOLUME=/path/to/owned/scratch BLACKCRAB_UPDATER_TEST_ARCHIVE=/path/to/Blackcrab_aarch64.app.tar.gz cargo test --manifest-path src-tauri/Cargo.toml --locked --lib official_043_archive -- --ignored
node scripts/check-tauri-versions.mjs
```

Read-only DMGs/translocated or protected installation parents cannot be updated
in place: preparation fails without moving the old app and directs the user to
manual replacement. There is deliberately no destructive administrator fallback.
A process kill/power loss between the two renames can require manual restoration
from the retained `.blackcrab-update-*/previous.app`; the adapter does not claim
crash-atomic exchange or automatically trust/replay old transaction directories.
Same-user external mutation and sudden device loss are not made transactional.

Actual user-run upgrade, relaunch, UI and service-retention acceptance remain
unverified. This is implementation/fixture evidence, not a published fixed app
or full native lifecycle acceptance. The original thread coordinates 0.4.4 across
platforms; this thread does not tag, publish or promote main.

### Local evidence — 2026-11-13 Pacific

Bound worktree:
`/Users/jonathanbenn/.t3/worktrees/blackcrab/fix-macos-updater-cross-volume`,
branch `fix/macos-updater-cross-volume`, initial base `fc7f09773dec5a724232fd9f89d889918b69ab07`.
The full installer run with both opt-in cases enabled passed **11/11, zero skips**.
The update-action/version gates passed **2/2**. Tauri compatibility tests passed
**4/4** and all six npm/Rust version pairs match. The official signed bundle was
installed only into a disposable fixture, verified before/after, never launched,
and removed by fixture cleanup. All real-device fixtures cleaned up automatically.

Local logs (temporary, may later be absent):
`/tmp/blackcrab-cross-volume-all-tests.log`,
`/tmp/blackcrab-cross-volume-gates-tests.log`,
`/tmp/blackcrab-cross-volume-dmg-verify.log`.
Build/download evidence is in the caller-owned scratch directory
`/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/updater-cross-volume-build`.
No release build, app launch or service process was started. CI/review and merge
status must be checked on this branch's linked PR; these local results are not a
claim of merge, publication or user-run acceptance.
