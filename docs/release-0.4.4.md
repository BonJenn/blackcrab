# Blackcrab 0.4.4 — Mac, Windows and Linux

Status: **in preparation, not published.** This file is updated when the
release is public.

- The full workspace and background service on Windows x64 (NSIS installer)
  and Linux x64 (deb and AppImage), as on Apple silicon.
- Updates from inside the workspace on Mac: the workspace's update control now
  drives the launcher's signed updater (see docs/desktop-updates.md).
- Everything merged to stage since 0.4.3.

Known limits at release:

- The Windows installer and programs are not Authenticode-signed. Windows
  shows a SmartScreen warning on first run ("More info", then "Run anyway").
- Linux and Windows are not in the updater feed. Later versions are installed
  by download.
- Windows has no native browser channel and no in-workspace update control.
- Windows and Linux were accepted on CI runners only, not on a person's PC.
- The Mac background service payload is unchanged from 0.4.3
  (manifest c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83).

Linux and Windows builds take the public Blackcrab Connect settings from the
repository variables `BLACKCRAB_CLERK_PUBLISHABLE_KEY`,
`BLACKCRAB_CLERK_JWT_TEMPLATE`, `BLACKCRAB_RELAY_URL`,
`BLACKCRAB_HOSTED_APP_URL` and `BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID`, the same
values the Mac workspace is built with. Until this release their CI builds had
none, so those builds had no Connect sign-in.
