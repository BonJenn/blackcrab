# Blackcrab mobile updates

The full native app retains the pinned T3 update implementation. Blackcrab's Expo
configuration selects its own update project and channel; the copied upstream
configuration is never executed. An unconfigured build has native updates disabled.
This does not require the cloud relay or Clerk to be enabled.

## Public build configuration

Set these values in the environment used to build **and** publish the app:

| Variable | Value |
| --- | --- |
| `BLACKCRAB_EAS_PROJECT_ID` | UUID of the Expo project owned by Blackcrab. |
| `BLACKCRAB_UPDATE_CHANNEL` | `development`, `preview`, or `production` for the corresponding checked-in build profile. |
| `BLACKCRAB_MOBILE_UPDATES_ENABLED` | Optional `1` (default when configured) or `0` to disable updates in that native build. |

The first two values must be supplied together. The resolver rejects the pinned
upstream project UUID, malformed values, and channel/profile mismatches. UUID
validation does not prove account ownership: verify the project in the Blackcrab
Expo account before the first build. Inherited `T3CODE_*`, generic `EAS_PROJECT_ID`,
update URLs, signing certificates and headers cannot enable or redirect updates.
The isolated iOS builder forwards only the validated public values, not Expo
account tokens or provider credentials.

Configured builds use `https://u.expo.dev/<project-id>` and an explicit
`expo-channel-name` request header. Preview, production and custom release channels
use Expo's `fingerprint` runtime policy; development uses `appVersion`, matching
the pinned target. Platform-specific inherited runtime overrides are removed.
The native runtime must match the published update: changing native dependencies
requires a compatible new binary. See [Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/).

`BLACKCRAB_MOBILE_UPDATES_ENABLED=0` preserves the configured project identity but
disables the native update module and automatic checks. It is a build setting,
not a remote switch for already installed binaries. Development clients also skip
the app's automatic and manual update API calls.

## Build and publication

1. Create a Blackcrab-owned Expo project and confirm the bundle identifier
   `dev.blackcrab.remote`. Add the public variables above to the appropriate Expo
   environment, together with any [cloud build values](mobile-cloud-configuration.md).
2. From `apps/mobile`, build the `preview` profile using the Blackcrab account and
   install it on an owned test device. The checked-in profiles explicitly select
   the same-named Expo environment and channel; `development-simulator` inherits
   `development`. Inspect the resolved native update URL/channel and runtime.
3. Publish a reviewed iOS preview update with the same public configuration, for
   example `eas update --channel preview --environment preview --platform ios`.
   Supply a release message when prompted. SDK 58 publication requires an explicit
   environment; values in a build profile's `env` alone are not enough. See
   [Expo Update setup](https://docs.expo.dev/eas-update/getting-started/) and
   [Expo environment usage](https://docs.expo.dev/eas/environment-variables/usage/).
4. Validate download, safe installation, persisted drafts/outbox, reconnect and
   rollback on the installed binary before publishing to production. Use the
   production project configuration, channel and environment consistently.

Do not run the inert copied upstream EAS configuration or publish to its project.
Account credentials belong in the approved credential store, never in source or
public Expo extras. This change does not create an Expo account/project, publish
an update, configure distribution signing, or enable update code signing.

## Lifecycle and verification

The unchanged updater checks at launch, then on return after at least 15 minutes
in the background. It coalesces concurrent checks and suppresses rechecks while
an install is pending. Downloaded updates normally wait for a safe background
transition and flush drafts/outbox before restarting. The original manual install,
long-foreground prompt and rollback-to-embedded paths remain intact.

Run `npm run test:mobile:updates` for the original tests from the generated app and
the Blackcrab disabled/development/background-boundary tests. Configuration tests
under `mobile-experience/activation/owned-updates.test.mjs` also exercise Expo's
installed native plist plugin. `npm run test:mobile:ios-preparation` verifies
configuration survives the isolated native build environment.

These are source/configuration checks with mocked native update APIs, not proof of
delivery from Expo. An owned project, an update-enabled release binary, an actual
published update and rollback, persisted-data acceptance, and physical-device
testing remain release gates. Earlier simulator acceptance used update-disabled
binaries and does not validate this new configuration.
