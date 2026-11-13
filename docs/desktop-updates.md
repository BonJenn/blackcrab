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

The first implementation is connected to the existing Apple-silicon launcher.
Windows/Linux need their real launch/transport/service and packaging paths before
this can be claimed or published as working on those targets. Do not publish a
root-only installer or change `producerImplemented` to bypass those missing parts.

0.4.2 and 0.4.3 cannot gain this fix through their broken workspace control. Users
can use the outer launcher's updater or install the verified 0.4.4 download once
it is public. Preserve their existing data and published older release assets.
