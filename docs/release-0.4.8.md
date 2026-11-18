# Blackcrab 0.4.8

Status: **published 2026-11-18 (UTC)** at
https://github.com/BonJenn/blackcrab/releases/tag/v0.4.8, tag `v0.4.8` on
commit 1f84b436f0fab24c9ea658eeb1adf21d974e4f5c.

| File | sha256 |
|---|---|
| `Blackcrab_0.4.8_aarch64.dmg` | 2e77041093734eece9b042debb3500ea6c9d6dd4190ca52fb85333e18860dd76 |
| `Blackcrab_0.4.8_x64-setup.exe` | 074efb51d3856231c7d988d0223e7a872798c7fa8718c5da5da289aceccc043f |
| `Blackcrab_0.4.8_amd64.deb` | 1442b4360d735c97977d8029d03cf2ffa5bfd66045aa0f19214e0d9d0e14b9ae |
| `Blackcrab_0.4.8_amd64.AppImage` | 40f8ab395b882e2f7c32c82d86fe4aa5b234fb1738e5c6d662b378adba3d0f46 |

Acceptance: Mac release run 44260985316 and Linux and Windows run 44263610023
both succeeded, and the Mac artifact checks passed (updater signature and merged
`latest.json`, root app identity, signature, ticket and Gatekeeper, every
bundled payload, DMG signature and ticket, DMG and updater app identical).
**Not launched on a Mac before publication.** Evidence:
P/mac-release-040-v2llrqsa/workspace-048-delivery.

A first Mac run (44239238450) produced an app with no stapled notarization
ticket, which the final check rejected. Cause not found: Tauri reported
"Stapling app..." without an error. The built assets were removed from the
draft and both stages were run again; the second Mac run stapled correctly.

How it was built: the workspace was rebuilt from the release commit, signed,
notarized and stapled, so it is labelled 0.4.8 and carries the new IDE code.
The service payload is 0.4.6's notarized one, byte for byte, so updating should
not re-register the service or stop running agents. This is untested on a real
0.4.7 install. The service-issuer helper in the outer app is compiled per
release and was found by its code-signing identifier, as in 0.4.7.

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
