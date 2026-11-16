# Blackcrab desktop updates

The outer signed application owns the updater feed and signing key. The managed
workspace must not run Electron's separate installer against the extracted inner
application. This caused the 0.4.2/0.4.3 workspace to show that automatic updates
were unavailable even though the outer launcher had a working manual updater.

The 0.4.4 implementation connects the workspace's existing update service to the
launcher over an inherited private socket (FD5). Pairing remains independently on
FD4. The descriptor grants only fixed update actions; neither the workspace nor
its renderer may specify a feed, arbitrary download, signature, path, or process.
The launcher checks after 15 seconds and every four hours. Available releases
appear in the workspace update control and a once-per-version in-app notification.
There is no automatic installation or background-service restart.

Download and install are separate explicit actions. Download progress comes from
actual transferred bytes. Unknown lengths and installation use indeterminate
progress. Download completion is held below 100% until the Tauri updater verifies
the package signature. A verified queued update remains installable after an
unsuccessful later feed check. The native updater serializes actions and requires
the exact queued version when installation is requested.

Installation brings the launcher progress surface forward, pauses its normal
workspace-exit monitor, closes only the captured workspace via its existing
cooperative owner channel, waits for exit, installs the signed outer app, then
restarts. The independent background service and agent sessions are retained.
Failure leaves an actionable recovery screen and retry; it must not exit the
launcher just because the workspace already closed.

## Validation and delivery scope

Node socket/descriptor tests cover bounded framing, serialization, rejected
capabilities, EOF and no replay. Rust tests cover action/version gates and real
inherited FD isolation. Renderer tests cover manual actions, duplicate clicks,
progress, missing lengths and retry. Complete pinned desktop and web typechecks,
actual production builds, CI and signed artifact verification are required too.
Native install/restart and retained running-service acceptance are separate from
these source tests and must be recorded against the final artifact.

The first implementation was connected to the Apple-silicon launcher only.

## Linux and Windows, from 0.4.5

The updater was always compiled into every launcher and 0.4.4 on Linux and
Windows already polls `latest.json`; it found no entry for its platform, because
those installers were built without updater signatures. From 0.4.5:

- **Signing.** A release builds the Linux and Windows installers with
  `scripts/tauri-build.mjs --updates`: updater artifacts signed with the same
  updater key as the Mac, and no platform code signing. Pull-request builds
  stay unsigned and never see the key (`sign_updates` on the reusable
  workflows).
- **One manifest.** The Apple-silicon release writes `latest.json` first. The
  `managed-linux-windows` release kind then checks each installer against its
  signature and the launcher's public key and adds `windows-x86_64`,
  `windows-x86_64-nsis`, `linux-x86_64-appimage` and, when the .deb was signed,
  `linux-x86_64-deb` (`scripts/release-update-manifest.mjs`). There is
  deliberately no plain `linux-x86_64` entry: a .deb installation must not be
  handed the AppImage. Run the Mac release before the Linux and Windows one; a
  Mac release run afterwards would write a Mac-only manifest again.
- **The workspace control on Windows.** The workspace inherits a fourth private
  pipe as descriptor 5 and its launcher answers the same four requests on it
  (`serve_pipe` in `managed_updates.rs`). Installing closes the workspace
  first, as on the other platforms.
- **Linux .deb.** The updater installs a .deb with `pkexec dpkg -i`, which asks
  for the administrator password. This path is not exercised by any test.

Not yet proven anywhere: a real update from one released version to the next
on Linux or Windows. The 0.4.4 Windows launcher has no reachable update
control, so its users install 0.4.5 by hand; 0.4.4 AppImage users should be
offered 0.4.5 in the workspace once the manifest carries it.

0.4.2 and 0.4.3 cannot gain this fix through their broken workspace control. Users
can use the outer launcher's updater or install the verified 0.4.4 download once
it is public. Preserve their existing data and published older release assets.

## Getting older installations onto the fixed updater

Do not rely on an in-app notification to reach people running 0.4.2 or 0.4.3.
The download page and 0.4.4 release notes must give them a manual upgrade path
after the new installer is published:

1. Download the current Blackcrab installer for the computer's platform from the
   official download page. Before publication, do not label an older link 0.4.4.
2. Quit the Blackcrab desktop app. Keep its application data, conversations and
   settings; do not use an app cleaner or uninstall the background service.
3. On Mac, open the downloaded disk image and replace Blackcrab in Applications.
   For Windows/Linux, use the tested upgrade instructions for the final installer
   format; those packages are still being implemented.
4. Reopen Blackcrab and verify 0.4.4 in About. This installation supplies the fixed
   update checks, availability notification and download/install progress for
   subsequent releases.

Manual replacement is the fallback when the old update control is unavailable.
It is not necessary to delete or recreate an environment to update the app.
