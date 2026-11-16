# Blackcrab 0.4.4 — Mac, Windows and Linux

Status: **published 2026-11-16 (UTC)** at
https://github.com/BonJenn/blackcrab/releases/tag/v0.4.4, tag `v0.4.4` on
commit 02afb2ed98d9cffff8fc7c768058cf6803922c8c.

| File | sha256 |
|---|---|
| `Blackcrab_0.4.4_aarch64.dmg` | b6d39b4abd5129c5fe9f076cbec688aef726aefb4c55abc5625f30d0da23e0d2 |
| `Blackcrab_0.4.4_x64-setup.exe` | 9afeb41f161e5281b1f1b0cda2667e93c99496dcfbe63fd90b0d0d5b1b9f91bb |
| `Blackcrab_0.4.4_amd64.deb` | 3109e99cbe53ea5ab2f198d9dbc18b06f411b4b1921eeb0354a08ee326e5e6b5 |
| `Blackcrab_0.4.4_amd64.AppImage` | 46b3efb7fb112ac6356d6bff084f8ae475a69a583866eefa2986c429c978b3b3 |

Acceptance: the Mac files passed all twelve artifact checks (release run
43800332495); the owner installed the draft DMG on their Mac and said
"publish". The eight Mac lifecycle checks were not run one by one. The Linux
and Windows files are the ones the acceptance jobs installed and opened in
run 43802591991; that run built from branch `fix/release-draft-read`, which
differs from the tagged commit by one permissions line in `release.yml`
(PR #332). All eight release files were then fetched anonymously and matched.

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
