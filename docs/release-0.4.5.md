# Blackcrab 0.4.5

Status: **in preparation, not published.** This file is updated when the
release is public.

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
