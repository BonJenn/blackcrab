# Blackcrab on the App Store

The iOS app is called **Blackcrab** (it was "Blackcrab Remote" through TestFlight
build 5). Only the name changed. The bundle identifier `dev.blackcrab.remote`,
the extension identifiers, the app group, the URL schemes (`blackcrab-remote`,
`blackcrab`), the Expo slug `blackcrab-remote` and the App Store Connect app
`6780360079` are the same, so an update keeps a person's pairings, drafts and
sign-in. Changing any of those makes a different app; do not.

The name a connected computer shows for the phone is "Blackcrab Mobile".

## What App Review needs, and where it lives

| Requirement | Where |
| --- | --- |
| Privacy policy | `https://www.blackcrab.app/privacy-policy` (BonJenn/blackcrab-landing). In the app: Settings → About → Legal, which loads `https://www.blackcrab.app/legal` (the apex host redirects, and the legal screen would hand a redirect to the browser). Also set as the privacy policy URL in App Store Connect. |
| Terms, security policy | `/terms-of-service`, `/security-policy` on the same site. |
| Support URL | `https://www.blackcrab.app/support`. The domain receives no email; GitHub Issues is the contact channel. |
| Account deletion | Settings → Delete account (shown while signed in), and Settings → Blackcrab Account → Blackcrab Connect → Delete account. |
| Sign in with Apple | Offered by the Clerk sign-in view next to GitHub and email. |
| Export compliance | `ITSAppUsesNonExemptEncryption` is false in `apps/mobile/app.json`. |
| Permission prompts | Camera, photo library, microphone and local network strings are in `apps/mobile/app.json`. |

The website must keep the paths `/legal`, `/privacy-policy`, `/terms-of-service`
and `/security-policy`: the app's legal screen only opens those.

### Account deletion

`mobile-experience/activation/adapters/AccountDeletion.tsx`. After a confirmation
it unlinks every computer registered to the account, unregisters this phone from
the relay, then deletes the Clerk user (`user.delete()`; the Clerk instance
allows people to delete their own account, so no secret key is involved). The
relay steps are best effort: a relay failure must not stop someone deleting their
account. Data on a person's own computer is not touched. The privacy policy
describes exactly this; change both together.

## Live Activity

Layout: `mobile-experience/activation/adapters/AgentActivity.tsx` (replaces the
pinned upstream widget). The crab mark is a template image added to the widget
extension by `apps/mobile/plugins/with-widget-brand-mark.cjs` from
`apps/mobile/assets/widget/`.

Two sources fill the card:

1. **The relay** pushes a coarse picture through Apple's push service: for up to
   five threads, the project, title, model, phase (working, needs approval, needs
   input, done, failed) and the time of the last change. This is all that arrives
   while the app is not running.
2. **The app itself**, while it is running, writes more into the same card from
   its own connection (`adapters/liveActivityProgress.ts`): the last line the agent
   said, when the run started and how many steps the thread has. It writes once
   more as the app leaves the foreground.

The layout shows what it has: a clock for time in the current state (run time
when the app supplied the start), the step line when present and otherwise a
plain sentence for the phase, finished-of-total progress when several agents are
listed, and a call to action when an agent needs the person.

Known limit: with the app closed, the step line is as old as the last time the
app ran, and a relay push replaces the card with the coarse picture. Showing live
steps on a locked phone needs the computer to publish them and the relay to
forward them (the relay drops `headline` and `detail` when it builds rows; see
`infra/relay/src/agentActivity/agentActivityAggregate.ts` upstream). That is a
host and relay change, not an app change.

Settings → Notifications → "Show a sample Live Activity" starts an example card
without an agent, an account or a computer; tapping again moves it through three
examples (several agents, one agent at work, finished). It ends by itself.

The list title reads "Blackcrab" with no stage badge. Do not bring back the
upstream "Beta" pill: App Review rejects apps that present themselves as beta.

## Building and submitting

Follow [native-ios-build.md](native-ios-build.md) for the archive. Then, with an
App Store Connect API key:

1. Upload the IPA (`xcrun altool --upload-package` or Transporter) and wait for
   processing.
2. Fill the version's listing (description, keywords, support and marketing URLs,
   screenshots for the 6.9-inch iPhone and 13-inch iPad), the review details and
   notes, attach the build, and create and submit a review submission
   (`/v1/reviewSubmissions`).

The API cannot do everything. These are web-only in App Store Connect, and
adding the version to a review submission fails until they are done:

- the App Privacy answers (the nutrition label), which must be published;
- the compliance questionnaires App Store Connect asks of a new app. On
  2026-11-16 the API named two as unfulfilled, with codes beginning
  `SECURITYASF` and `AIGENERATE`;
- agreements, and the EU trader status.

The App Privacy answers that match the privacy policy: Contact Info (email
address, name), Identifiers (user ID, device ID) and User Content (other user
content: the project and thread titles a computer publishes for notifications),
each used for App Functionality, linked to the person, not used for tracking.
Nothing else is collected by Blackcrab: photos, audio and messages go to the
person's own computer.

Screenshots need a computer to show. Never pair a build under test with a
person's real desktop: start an isolated host from the pinned upstream showcase
seed on a spare port and base directory, pair the simulator to that, and stop it
afterwards. The one used for 1.0.0 is in P/ios-demo-host (`start.sh`,
`mint-pairing.sh`, `stop.sh`); it has no live agent runs.

Review notes must say that the app is a companion to the free desktop app and
give the reviewer a way to see it working. For 1.0.0 that is a screen recording
attached to App Review Information plus a demo account.

## Reviewer sign-in

Clerk asks for an emailed code when an account signs in from a new device. A
reviewer cannot receive it. The demo account `app-review@blackcrab.app` was
created through Clerk's Backend API with `bypass_client_trust: true`, which
skips that step for that one user; its password is in App Store Connect's App
Review Information. Recreate it the same way if it is ever deleted (the in-app
Delete account works on it too). The domain receives no email.

## Release 1.0.0 (6)

Built on 2026-11-16 from stage `2045994a114b81a7834ce7674a371839615e2324`,
uploaded to App Store Connect (delivery and build
`7d05b45f-f358-41f2-be5f-2cba3fe9e689`, processed VALID) and attached to App
Store version 1.0.0. IPA SHA-256
`d5cd1c9703b6d33087e506a8c4a85fd0a7a373c6f2ee7b784cbc179ca7662dd5`. The build
report, IPA, screenshots, listing text, review notes and demo video are in
P/ios-app-store-release-6 (may be absent on another machine).

The archive ran with four compiler workers instead of the script's two, through
a wrapper on `PATH` that rewrites `-jobs 2`; this Mac (8 cores, 16 GB) handled
it. Do not run a simulator during the archive: together they drove the load
average past 100 and stalled the machine.

Listing set through the API: name Blackcrab, subtitle "Steer your coding
agents", Developer Tools with Productivity second, free in all territories, age
rating 4+, privacy policy and support URLs, description, keywords, five iPhone
and two iPad screenshots, manual release after approval (the owner's choice).

What was run in the simulator and what was not is in the pull requests (#339,
#341) and the handoff checkpoint.

## Known gaps

- Live step text on a locked phone needs host and relay work (see Live Activity).
- The desktop app still names the phone app "Blackcrab Remote" in one place
  (`managed-desktop/patches/blackcrab-product-ui-011.patch`); that belongs to a
  desktop release.
- Clerk's sign-in sheet reads "Continue to blackcrab" (the application name in
  the Clerk dashboard, lower case).
- There is no support mailbox; the support page points to GitHub Issues.
- Not exercised before submission: a physical device, relay pushes to a Live
  Activity, progress written from a running agent, the expanded Dynamic Island,
  Sign in with Apple and GitHub sign-in to completion, and the PR reviewers list.
