# Blackcrab 0.4.7

Status: **published 2026-11-18 (UTC)** at
https://github.com/BonJenn/blackcrab/releases/tag/v0.4.7, tag `v0.4.7` on
commit cbbc17a5032bcaa0e67423d6eb9caa85c55d7368.

| File | sha256 |
|---|---|
| `Blackcrab_0.4.7_aarch64.dmg` | f21d37bb49a82be3ea2c9abaa83b2837f6116b13ab5bc14e9e6c965c5e9c5323 |
| `Blackcrab_0.4.7_x64-setup.exe` | 8896abc7ef4804b386ee31646149b40f83e2cf2ea5fb78495babdbccb40c929a |
| `Blackcrab_0.4.7_amd64.deb` | 2bfc7639a33d0c44ac76ca62a1abc858e5d25d865310deebfef59a4ed214b67c |
| `Blackcrab_0.4.7_amd64.AppImage` | 0c13939c446377545f805c2c5e0e300507ce960ccd6fce8c63b2f46ec7d573f9 |

Acceptance: Mac release run 44165039863 and Linux and Windows run 44203043610
both succeeded. The Mac artifact checks passed (updater signature and merged
`latest.json`, root app identity, signature, ticket and Gatekeeper, every
bundled payload, DMG signature and ticket, DMG and updater app identical).
**Not launched on a Mac before publication**, as with 0.4.6. Evidence:
P/mac-release-040-v2llrqsa/workspace-047-delivery.

How it was built: the signed and notarized workspace and service payloads are
0.4.6's, repacked for 0.4.7 (`release-inputs.mjs` binds the source revision, not
the payload content). Only the outer app was rebuilt. Consequences:

- The workspace inside the app is labelled 0.4.6. The outer app only requires
  it to agree with its own provenance, so nothing compares it with 0.4.7.
  `verify-final-artifacts.py` therefore asserts 0.4.6 for the workspace.
- The service payload is unchanged, so updating should not re-register the
  service or stop running agents. This is untested on a real 0.4.6 install.
- The service-issuer helper inside the outer app is compiled per release, so
  no independent build receipt exists for it. It was found by its code-signing
  identifier (`com.bonjenn.blackcrab.service-issuer`) and its Developer ID
  signature, architecture and argument handling were checked. The 0.4.6
  check, which matched an independent receipt, was not repeated.
- No new service manifests were created, so `PREDECESSORS` is unchanged.

A fix release for usage data that stopped arriving.

- **Launch and update events are sent again.** Since 0.4.2 the part of the app
  that sent them was gone, so installs of 0.4.2 through 0.4.6 did not show on
  the admin dashboard and no update funnel was recorded. The signed outer app
  now reports app launch, update checks, update starts, update failures (check,
  download or install) and, on the next launch, a completed update.
- **Off switch.** "Share anonymous usage data" on the workspace settings screen,
  or `BLACKCRAB_ANALYTICS=off`. PRIVACY.md describes what is sent.

## Known limits

- Installs get a new anonymous id, so they count as new active installs the
  first time they report.
- Not exercised in an installed build before release: real events reaching the
  server, and the update-completed report after a Windows or Linux restart.
- Everything listed as untested in docs/release-0.4.6.md is still untested.
