# Blackcrab mobile cloud configuration

The full native interface uses the pinned T3 account and relay services with
explicit Blackcrab build configuration. Without configuration, local and tailnet
connections remain available and cloud account activation stays disabled.

## Public build values

Provide all three values in the native build environment:

| Variable | Meaning |
| --- | --- |
| `BLACKCRAB_CLERK_PUBLISHABLE_KEY` | The Blackcrab Clerk application's `pk_test_…` or `pk_live_…` publishable key. Never a secret key. |
| `BLACKCRAB_CLERK_JWT_TEMPLATE` | The JWT template configured for that application's relay authentication. |
| `BLACKCRAB_RELAY_URL` | The Blackcrab relay HTTPS origin, without credentials, path, query or fragment. |

The dynamic Expo configuration and isolated native preparation validate these
values. An incomplete set stops the build with field names only. Only these public
cloud values cross the isolated build environment; provider keys and Clerk secret
keys are not forwarded. Expo embeds them under `extra.blackcrabCloud`, version 1.
Existing upstream `clerk`, `relay`, tracing and `T3CODE_*` values do not activate it.
The same resolver validates the runtime namespace and rejects partial or malformed
configuration as a whole.

Configured builds include `@clerk/expo`'s native plugin, the pinned native theme,
Apple sign-in support and keychain service `dev.blackcrab.remote.clerk`. They use
Blackcrab's bundle ID and `blackcrab-remote` URL scheme. The full native provider
attaches the original account service once; its sign-in, account-switch cleanup,
relay discovery, onboarding and agent-awareness registration remain in the pinned
implementation. Re-rendering the provider does not create a second account owner.
An unconfigured build does not clear existing catalogs or cloud account storage.

Cloud-configured builds also enable the Expo widgets native push capability for
Live Activity updates. The widget bundle and app-group identifiers remain owned
by Blackcrab. Builds without cloud configuration leave that capability disabled.
Apple signing/provisioning and the relay's Blackcrab APNs credentials are still
required for delivery; this build setting alone does not prove push delivery.

## Deployment and acceptance still required

The relay must implement the pinned managed-relay API. The older legacy WebSocket
relay in `apps/relay` is a different protocol and is not a substitute for that
service. Configure the corresponding identity application, JWT template, TLS,
redirects, and the Blackcrab desktop host before validating mobile cloud access.
Do not reuse the original upstream application's account or relay configuration.

Native sign-in, account switching, revocation, relay reconnection, locked-device
notifications, provider control over an off-LAN connection and physical-device
acceptance remain required. Native Google authentication configuration and Apple
signing/provisioning must be completed for the intended distribution. No live
cloud service, account login, provider run, push delivery or signed distribution
is established by the configuration tests.
