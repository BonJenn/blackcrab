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
both installers. The Debian launcher must match the compiled binary; AppImage
must match Tauri's post-linuxdeploy AppDir, since linuxdeploy adjusts ELF paths
and strips symbols. The underlying compiled binary digest is also retained.

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

Only the newly created account, captured graphical processes and newly installed
package are retired. Cleanup attempts continue after an individual cleanup
failure; cleanup errors fail acceptance. Reports and empty-workspace screenshots
are retained. Driver logs, service configuration and authentication state are not
uploaded. No provider prompt, production credentials or existing user data is used.

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
