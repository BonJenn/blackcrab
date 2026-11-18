# Blackcrab 0.4.9

Status: **published** on 2026-11-18 as the latest release, built from commit
`58d9b8d150a1ebe22e165a211ab9ebb2179a83e2` (release PR #358).

Workflow runs: Apple silicon `44358774766`, Linux and Windows `44363422147`.
`verify-final-artifacts.py` reported `RELEASE_ARTIFACTS_VERIFIED`, including the
stapled notarization ticket on the app in the updater archive.

| File | sha256 |
| --- | --- |
| Blackcrab_0.4.9_aarch64.dmg | f906d1640f98551b336e1b74befd06c89fa21a98bff196f1cc7e6a6409be4b78 |
| Blackcrab_aarch64.app.tar.gz | 6a2d344f6c2b94296f15433e1f264b77572e2ce77144723273fc02685198126a |
| Blackcrab_0.4.9_x64-setup.exe | cd81efe6fc2c638b38e1a65f1f9401bbe2a9c12f6824f642bb5ea051fe82d3d2 |
| Blackcrab_0.4.9_amd64.deb | fb24bfbb053aaa1753a70a51fa48d04bbd8eb0783f77c365ffdef0d900bd11dc |
| Blackcrab_0.4.9_amd64.AppImage | 8f8f251e3b870180f8568f8b02f0ef9fde4f5af31ee63125a9b52d0f89b2bef5 |
| latest.json | c21f45bbc7091fb3bfaac2906c3b9a43cdb962894e06549f6931ec488a594d53 |
| blackcrab-managed-payloads.zip | 4cbee5436ef5c8eb6c3e6f9237ef0178e75f58f5ec277055e2522325ed355850 |

The service payload is reused from 0.4.6, so the background service is not
restarted by this update. Desktop payload manifest
`44bb9e6f56600064380b11b257ee9164d4ac9b0d3d06ac8d397c3e8832ce06eb`.

Three fixes and additions after 0.4.8.

- **Try again and Refresh service status work after macOS cleans /tmp.** The app
  talks to the background service through a private folder in `/private/tmp`
  with an owner marker file. macOS deletes old files there without a reboot,
  which removed the marker and made the workspace check and service status fail
  with "Private native browser capability was refused". A missing marker is now
  recreated, but only when the folder is still the owner's, private, and holds
  nothing except a valid private socket (PR #355).
- **`/resume` works for every provider.** In the composer, `/resume`, chosen
  from the menu or sent as the whole message, opens the command palette, which
  lists the most recently used threads and searches all of them. Opening one
  continues its own provider session. The provider's own `/resume`, which
  answered "not available in this environment", is hidden. It works at the start
  of a message only (PR #356).
- **IDE mode follows the agent into other folders.** When the agent's latest
  edits are to files outside the thread's folder, the panel moves to the folder
  those files share, with a note and a button to return to the thread's folder.
  Unsaved edits stay where they are (PR #357).

## Known limits

- `/resume` was checked with unit and registry tests and a type check, and not
  in a running app. It reuses the existing command palette.
- Everything listed as untested in docs/release-0.4.8.md is still untested,
  including the IDE change view in a running app.
