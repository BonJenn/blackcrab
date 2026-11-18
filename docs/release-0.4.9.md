# Blackcrab 0.4.9

Status: **prepared, not built or published.**

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
