# Blackcrab 0.4.6

Status: **in preparation, not published.** This file is updated when the
release is public.

A fix release for two problems the owner found on the first Mac updated to
0.4.5.

- **IDE mode button.** Outside a split pane the button was drawn underneath
  the window's panel buttons. It now keeps clear of them.
- **Mac: agent tools not found after updating.** The background service has a
  fixed list of folders it looks in for tools such as `claude`. The 0.4.5
  update rebuilt that list and could drop folders, and `~/.local/bin`, where
  Claude's own installer puts `claude`, was never on it. The service now
  always looks in `~/.local/bin` and keeps its folders when it is
  re-registered (docs/service-upgrade.md).

## Known limits

- Updating re-registers the background service, so agents working at that
  moment are stopped once, as with 0.4.5. This happens on every release for
  now, because each build of the service differs.
- Folders the 0.4.5 update already dropped are not restored; `~/.local/bin`
  and the standard folders are.
- The service reads its folder list when it starts. A tool installed later in
  a folder not on the list is not found by Refresh.
- Messages from the background service still say "T3 Code" in places.
- Everything listed as untested in docs/release-0.4.5.md is still untested.
  This release is the first real version-to-version self-update for Windows
  and Linux users on 0.4.5.
- The IDE mode fix was type-checked and covered by recipe tests; it was not
  looked at in a running app before release.
