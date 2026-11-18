# Blackcrab 0.4.8

Status: **prepared, not built or published.**

IDE mode shows what the agent changes as it lands.

- **Changes are shown as they land.** When a file the agent changed is written,
  IDE mode shows what changed for a couple of seconds: added lines green,
  removed lines red, with word-level marks inside changed lines. Then it settles
  into the normal editable file. Several changed files are shown one after the
  other, and with "Following agent" on the panel moves to each file in turn.
  The last eight files the agent changed are watched, so a quick edit to a
  second file is not missed.
- **Off switch.** "Highlight changes" in the IDE panel header.
- **Test runs no longer report usage events.** The Linux and Windows
  installed-app tests set `BLACKCRAB_ANALYTICS=off`, so CI runs stop appearing
  on the admin dashboard as 0.4.6 and 0.4.7 events (PR #351).

## Known limits

- IDE mode shows an edit once it is written to disk, not while the agent is
  producing it. The panel still never renders the agent's tool text.
- The first edit to a file IDE mode has not read yet has no earlier snapshot,
  so it is not flashed. Later edits are.
- The change view shows the changed lines with a few lines of context, then
  returns to the full file at the top, not at the change.
- The change view was tested against a stand-in for the diff component. It was
  not looked at in a running app before release.
- `IdeCodeEditor.browser.test.tsx` (real-editor typing) does not pass in the
  local test setup, with or without this change.
- Everything listed as untested in docs/release-0.4.7.md is still untested.
