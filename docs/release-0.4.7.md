# Blackcrab 0.4.7

Status: **prepared, not built or published.**

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
