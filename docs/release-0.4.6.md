# Blackcrab 0.4.6

Status: **published 2026-11-17 (UTC)** at
https://github.com/BonJenn/blackcrab/releases/tag/v0.4.6, tag `v0.4.6` on
commit f91fcbfa8474e322a344dbe9b661753506b9cf1f.

| File | sha256 |
|---|---|
| `Blackcrab_0.4.6_aarch64.dmg` | a1cae7ad7cb61217 (first 16; full digest on the release page) |
| `Blackcrab_0.4.6_x64-setup.exe` | 37f0180a0c8120907dfdcf8170e684fa712330e29f37a88f91ed3c8e7c83f9d1 |
| `Blackcrab_0.4.6_amd64.deb` | b493228197a95115f15265cada5345b0f71e0805f3734e337fa3340bb8090c00 |
| `Blackcrab_0.4.6_amd64.AppImage` | d82fe46b6040572bdd3b509b326882b899c0343924f5b091e4b10bd1873f64c1 |

Acceptance: Mac release run 44013449101, twelve artifact checks passed, not
launched on a Mac before publication (owner: "okay merge them and then publish
it"). Linux and Windows run 44016005505 installed, opened and upgraded from
the published 0.4.4. No run upgrades a 0.4.5 service: that path relies on
0.4.5's manifests being in `PREDECESSORS` (PR #343) and is first exercised by
users. Evidence: P/mac-release-040-v2llrqsa/workspace-046-delivery.

The Mac artifact check (`verify-final-artifacts.py` in the delivery
directory) must now accept a three-platform `latest.json`: run it before the
Linux and Windows release, or use `check-merged-manifest.mjs` beside it as
0.4.6 did.

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
