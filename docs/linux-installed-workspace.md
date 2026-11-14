# Installed Linux workspace acceptance

PR306 merged at `4ac132512eb65f39d46cfd88b6dfdba96db52c74` after all eleven
checks passed on `0e53afc5145d699df6525352215265f7f96f2d28`. The actual host/helper
test in job132390531684, run43576064552, passed once with zero failures or ignored
tests. It exercised real systemd, native attachment and retained identity without
provider prompts. That evidence covers the service, not a desktop window.

## Normal packages and launcher

The extended `managed-linux-host.yml` job builds the real host, standalone helper
and Electron workspace on Ubuntu22.04, then uses the normal `tauri-build.mjs`
entry with both opaque payloads to produce Debian and AppImage candidates.
`build-linux-installers-ci.mjs` verifies Debian package/version/architecture,
installer SHA-256 values, the packaged launcher, both embedded manifests and
complete payload inventories. The payload archives must be identical across
both installers. Tauri stamps each bundle's type into the launcher it packages
and leaves the compiled binary unstamped (`UNK`). The marker text occurs twice
and only one occurrence is stamped. The Debian launcher must equal the compiled
binary byte for byte except a three-byte `DEB` stamp; AppImage must match
Tauri's post-linuxdeploy AppDir, since linuxdeploy adjusts ELF paths and strips
symbols. The underlying compiled binary digest is also retained. Run43579045171
failed on the earlier whole-file Debian comparison, and run43611999319 on a
check that required every marker occurrence stamped; neither reached a UI step.

Ubuntu22.04 is the build baseline for WebKitGTK4.1 and older glibc compatibility.
See [Tauri's AppImage requirements](https://v2.tauri.app/distribute/appimage/)
and [its packager](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs).
This is a local-mode candidate: no updater signing key, public release or version
bump is performed. Production portable-producer enablement remains separate.

## Actual installed UI test

`test-linux-installed-workspace.py` refuses non-CI use, existing QA users/home,
an installed Blackcrab package, occupied WebDriver ports and changed installers.
It installs the actual Debian package into the disposable runner, creates a fresh
OS account and starts that account's systemd manager and Xvfb/Openbox session.
The official Tauri WebDriver launches the normal packaged executable. The test
observes rendered startup status through read-only DOM queries; it does not
invoke native product commands, inject success responses or enable a QA feature.

Root must complete its normal service setup and private Electron handoff before
its status reports the workspace open. The native lifecycle acknowledgement
requires a loaded visible window. An OS foreground-title check and screenshot
provide independent window evidence. The test sends the normal Linux Quit
shortcut, checks Root closes while the service remains active, then reopens via
the actual AppImage and compares the same persistent configuration/environment.

Only the newly created account, its processes and the newly installed package
are retired. Run43613716955 passed installer verification for both packages
and then failed at driver startup: the WebDriver proxy drops connections until
its native driver listens, and cleanup called `loginctl terminate-user` on an
account with no logind session. Startup now retries transport failures and
cleanup stops the account's systemd manager and any remaining processes. Cleanup attempts continue after an individual cleanup
failure; cleanup errors fail acceptance. Reports and empty-workspace screenshots
are retained. Driver logs, service configuration and authentication state are not
uploaded. No provider prompt, production credentials or existing user data is used.

## Product finding: shared-write application data

Run43618913721 was the first to reach the installed launcher. It refused to
start: "The application-data directory allows other users to write." Ubuntu and
Fedora accounts default to umask002, so the launcher's own data directory was
created group-writable and the payload cache then rejected it. This would affect
ordinary users, not only the test account. On Linux `managed_native_entry.rs`
now creates that directory with mode0700, as XDG specifies, and removes
group/other write from an existing one it owns. A symlink or foreign-owned
directory is left untouched and still rejected. Mac behaviour is unchanged.

## Product finding: first lifecycle reply deadline

Run43621804111 passed application-data setup, service setup and pairing, then
reported "The workspace window did not respond." Root writes its first
activation request while the workspace is still starting and allowed three
seconds for any reply; a timeout retires the channel permanently. A cold start
on a slow machine can exceed that. `managed_desktop_lifecycle.rs` now allows
sixty seconds for the first reply only. An exited workspace closes the socket
and still fails at once; later requests keep the three-second deadline.

That deadline was not the cause. Run43624488704 failed identically and as
quickly, with no workspace process left in the QA account while Root and the
service were running: the Linux workspace exits during startup. Root discards
its output, so the reason is unknown. On a failed handoff the test now keeps a
first/last-seen timeline of command names, the sandbox helper's owner and mode,
the user-namespace setting, unresolved shared libraries, and the bounded
startup output of the extracted workspace binary run without Root's private
descriptors. This is failure evidence only and is not part of acceptance.

## Product finding: workspace temp path exceeds the socket limit

Run43627224742's evidence: the workspace binary ran for two seconds under Root
and then produced a core dump, while the same binary started alone (default
`/tmp`) reached its JavaScript entry and kept running. No library was missing
and user namespaces were available. Root sets the workspace's `TMPDIR` to the
private profile's `tmp`, about 107 bytes for the QA account and 90 for a short
user name. Chromium binds its single-instance socket in a directory beneath
`TMPDIR` and aborts when the path exceeds `sockaddr_un`'s 108 bytes; the
workspace requests that lock. This is the probable cause and would affect every
Linux user; the crash signal was not captured in that run.

On Linux `managed_desktop.rs` now uses a private `blackcrab-workspace-tmp`
directory (mode0700) in `XDG_RUNTIME_DIR` when that directory is short, owned by
the user and private. An existing entry that is not privately owned is refused.
Without a usable runtime directory the profile path is kept. Mac is unchanged.
On failure the test also saves `coredumpctl info` for the QA account.

Run43629474947 confirmed the effect: with the short temp directory the workspace
no longer dumps core and stays running. It is the next blocker that is open:
the running workspace never answered Root's first lifecycle request within
sixty seconds, so Root still reports an unresponsive window. Whether it is
showing an error dialog, has no window, or is waiting on something is not yet
known. On failure the test now also saves a screenshot, visible window titles
and the workspace's process roles.

Run43632335759's screenshot shows only Root's launcher with that message. The
workspace had its main, zygote, GPU and utility processes but no renderer and
no window, and showed no error dialog: its startup stalls before any window is
created. The test now also returns the tails of the workspace's own startup
logs from the fresh profile, with long token-like strings removed.

Run43634568831 found no log files in the profile, so the stall is early or the
logs are elsewhere. The test now records the stalled main process's low
descriptor kinds, each thread's current system call number and the names of
what the workspace created in its profile. The runner's ptrace scope is relaxed
for that; the QA account only inspects its own processes.

Run43637512960: the stalled main process was idle in its event loop, and its
profile held only Root's marker, `home` and `tmp`. The workspace's first startup
step creates `electron`, `app-data` and `logs` there, so its entry script fails
before that, reading or validating Root's descriptor. Before Electron is ready
on Linux an uncaught main-process error is written to standard error with no
dialog, and Root discards that stream, so the process idles silently. The probe
now starts the workspace as Root does (environment, working directory and
descriptors3,4 and6) with a correctly shaped descriptor carrying a made-up
credential and an unused port, and keeps what it prints.

## Correction: the runtime temp directory broke the workspace's own contract

Run43639683994's probe printed the startup error: `Managed environment
authority differs`, from `captureManagedShellAuthority` in
`native-os-home-environment.mjs`. The workspace requires `TMPDIR` to equal
`<profile>/tmp` and sets Electron's own temp path there. The runtime temp
directory introduced above violated that, so runs from43629474947 on stalled
at this check; they did not show that the short path fixes the core dump, as
the workspace never reached the single-instance lock. That change is reverted
and `managed_desktop.rs` is identical to `stage` again.

The open product defect is therefore the core dump from run43627224742, with
the contract-correct `TMPDIR`. The socket-length explanation is still the
leading hypothesis but is unconfirmed. If confirmed, the fix belongs in the
workspace environment contract (a registered, pinned payload module shared with
Mac), not in Root alone. The probe now launches with the contract-correct
`TMPDIR`, so the next run records Chromium's own fatal message and
`coredumpctl info`.

## Acceptance and remaining release work

Local checks pass: three controller/input regressions, eighteen startup/renderer
tests and root TypeScript. The Linux graphical job is pending; do not record UI
acceptance until both actual installed package sessions and cleanup pass, and
inspect the resulting screenshots. Local tests cannot replace native evidence.

The unchanged source version is still0.4.3; these are unpublished integration
candidates for the coordinated0.4.4 delivery. Windows IPC/ACL/service integration,
Linux compatibility beyond this baseline (including newer sandbox policies),
signed updater packaging, a coherent0.4.4 bump, tested stage-to-main promotion
and the three verified public downloads remain. Preserve the production Mac
`c04c4d44…` host/helper/configuration and inactive0.4.5 recipes.
