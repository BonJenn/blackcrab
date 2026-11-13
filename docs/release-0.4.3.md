# Blackcrab 0.4.3 — Mac workspace fixes

Status: published on November 13, 2026 from 18055fbc080faa4f6d518c420b19040ce45e3296.
[Download/release notes](https://github.com/BonJenn/blackcrab/releases/tag/v0.4.3).

- Attribute the owned Mac background service to Blackcrab for macOS permission
  prompts. Existing service registrations update their metadata on an explicit
  stopped start/restart, retaining workspace history, settings and identity.
- Present recognized imported monitor events as collapsible Background updates,
  keeping their exact original text available. New pasted XML is unchanged.
- Keep pane move and close controls reachable alongside side-panel controls,
  including the rightmost pane and six-pane layouts.

The source changes passed all nine required checks. Full client TypeScript,
104 desktop/cloud/QA tests and actual Chromium notification/pane cases passed.
Signing, notarization, final package/helper/payload verification and updater
cryptography passed on actual downloaded artifacts. Anonymous public downloads
and website pages/platform links passed. Native lifecycle acceptance remains
OWNER_TESTING_AUTHORIZED; the owner is testing this update and no full native
lifecycle PASS is claimed.
Mac target: Apple silicon. Windows/Linux full-workspace installers are pending;
existing 0.3.0 downloads are unchanged. TestFlight 1.0.0(4) is unchanged.
