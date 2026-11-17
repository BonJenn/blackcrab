# Blackcrab 0.4.5

Status: **published 2026-11-17 (UTC)** at
https://github.com/BonJenn/blackcrab/releases/tag/v0.4.5, tag `v0.4.5` on
commit b3b7cbd63fcb1aaa41c49e22bd271a90e2faafe6.

| File | sha256 |
|---|---|
| `Blackcrab_0.4.5_aarch64.dmg` | 8bf375f6cab15311f7541878c33551456569bea92bac9a7df14a5f7af66fc22c |
| `Blackcrab_0.4.5_x64-setup.exe` | c5fd6164e840d3046737d21f5dc96c2a0909af280a9390bd47b4c15f1944db7f |
| `Blackcrab_0.4.5_amd64.deb` | 271f548567fc85b3b0ae761a93374768156cb99f542c6b46a91cec7357e0496f |
| `Blackcrab_0.4.5_amd64.AppImage` | 47d9a2fc3ddbd5e2325c11fc278691761b90ffe3aa2988d9f2ebb7dd60ffffec |

Acceptance: the Mac files passed all twelve artifact checks (release run
43983596832) and **were not launched on any Mac before publication**; the
owner, away from their Mac, said "im not at home now. just publish it". The
Linux and Windows files are the ones run 43986764352 installed, opened and
upgraded from the published 0.4.4. `latest.json` covers all three platforms
and every entry was checked against its signature. All eight files were then
fetched anonymously and matched. Both runs used branch `release-build/0.4.5`,
which is the tagged commit; stage had moved on by one mobile-only merge.

Service manifests of this release, needed by the next one, are listed in
docs/service-upgrade.md and already in `PREDECESSORS`.

## What changes

- **Model collaboration.** A plus beside the model picker chooses a partner
  model: the lead works, the partner reviews, the lead resolves.
- **IDE mode.** A toggle in the chat header opens a code panel beside the
  conversation: file tree, editor, follows the agent's file changes, and saves
  with a recovery copy.
- **Account sign-in in the sidebar.** "Sign in to Blackcrab Connect" and the
  account avatar are in the main sidebar, not only at the bottom of Settings.
- **Windows and Linux update themselves.** Their installers carry updater
  signatures and are in the update manifest; the Windows workspace has the
  update control.
- **The in-app browser on Windows.**
- **A new background service on every platform**, for the first time since
  0.4.0. An installed service is upgraded in place the first time 0.4.5 opens
  (docs/service-upgrade.md). Agents working at that moment are stopped;
  conversations, settings and sign-ins are kept.

## Known limits

- The Windows installer is still not Authenticode-signed; SmartScreen warns.
- 0.4.4 on Windows has no reachable update control, so its users install 0.4.5
  by hand. 0.4.4 AppImage users should be offered it in the workspace.
- A Linux .deb updates through `pkexec dpkg -i`; that path has no test.
- Not exercised by any test or person: a real provider turn through a paired
  run, saving from IDE mode in an installed app, loading a page in the browser
  pane on Windows, and a version-to-version self-update on Linux or Windows.
- The service upgrade is tested from the published 0.4.4 on Linux and Windows
  in CI. On a Mac it is tested only by the owner's own upgrade.
- Going back to 0.4.4 after the upgrade is a manual procedure.

## Release order

1. Apple silicon: build workspace and service payloads from the release
   commit, sign, notarize, pack, create the draft, run `release.yml` kind
   `managed-apple-silicon`. This writes `latest.json`.
2. Linux and Windows: `release.yml` kind `managed-linux-windows` on the same
   draft. It signs their updater artifacts and adds them to `latest.json`.
3. Owner tests the Mac draft, including the service upgrade, before
   publication.
