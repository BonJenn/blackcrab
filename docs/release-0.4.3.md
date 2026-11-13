# Blackcrab 0.4.3 — candidate release

Status: preparing; no 0.4.3 installer or update is public yet.

- Attribute the owned Mac background service to Blackcrab for macOS permission
  prompts. Existing service registrations update their metadata on an explicit
  stopped start/restart, retaining workspace history, settings and identity.
- Present recognized imported monitor events as collapsible Background updates,
  keeping their exact original text available. New pasted XML is unchanged.
- Keep pane move and close controls reachable alongside side-panel controls,
  including the rightmost pane and six-pane layouts.

The source changes passed all nine required checks. Full client TypeScript,
104 desktop/cloud/QA tests and actual Chromium notification/pane cases passed.
Signing, notarization, final package/updater verification and native candidate
acceptance must be recorded separately before calling this release delivered.
Mac target: Apple silicon. Windows/Linux full-workspace installers are pending;
existing 0.3.0 downloads are unchanged. TestFlight 1.0.0(4) is unchanged.
