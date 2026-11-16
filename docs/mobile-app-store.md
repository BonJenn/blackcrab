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
| Privacy policy | `https://www.blackcrab.app/privacy-policy` (BonJenn/blackcrab-landing). In the app: Settings → About → Legal, which loads `https://blackcrab.app/legal`. Also set as the privacy policy URL in App Store Connect. |
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
without an agent, an account or a computer. It ends by itself.

## Building and submitting

Follow [native-ios-build.md](native-ios-build.md) for the archive. Then, with an
App Store Connect API key:

1. Upload the IPA (`xcrun altool --upload-package` or Transporter) and wait for
   processing.
2. Fill the version's listing (description, keywords, support and marketing URLs,
   screenshots for the 6.9-inch iPhone and 13-inch iPad), the review details and
   notes, attach the build, and create and submit a review submission
   (`/v1/reviewSubmissions`).

The API cannot do everything. These are web-only in App Store Connect: the App
Privacy answers (the nutrition label), agreements, and the EU trader status.

Screenshots need a computer to show. Never pair a build under test with a
person's real desktop: start an isolated host from the pinned upstream showcase
seed on a spare port and base directory, pair the simulator to that, and stop it
afterwards.

Review notes must say that the app is a companion to the free desktop app and
give the reviewer a way to see it working.
