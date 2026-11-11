# Blackcrab cloud client builds

Managed host and desktop builds accept these public settings:

- `BLACKCRAB_CLERK_PUBLISHABLE_KEY`: publishable key for Blackcrab's Clerk instance.
- `BLACKCRAB_CLERK_JWT_TEMPLATE`: template used by that instance for relay tokens.
- `BLACKCRAB_RELAY_URL`: HTTPS origin of Blackcrab's deployed relay.
- `BLACKCRAB_HOSTED_APP_URL`: HTTPS origin of Blackcrab's hosted web application.
- `BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID`: OAuth application used by the original CLI sign-in flow.

Supply all five to `scripts/build-managed-host.mjs` and
`scripts/build-managed-desktop.mjs`, alongside their existing artifact/toolchain
arguments. The same Clerk key, JWT template and relay origin configure the iOS
build. A secret Clerk key is never a client build setting.

With no settings, the builds retain local mode. Partial configuration is rejected
before building. Inherited T3, Vite, Expo and Vercel cloud settings do not select a
service for the managed host producer; the desktop producer starts from its
explicit build environment. The build records public cloud configuration in
`BUILD-PROVENANCE.json`. Desktop web cache entries are separated by configuration.

Configured clients preserve the original account and relay implementation. The
Electron account bridge uses its original private token store under Blackcrab's
profile, and callbacks and app links use `blackcrab` / `blackcrab-dev` schemes.
Shared hosted links use the configured web origin. Without that origin, thread
links remain local and hosted prompt links are unavailable.

Client builds do not deploy the backend, configure Clerk applications, establish
DNS, provision tunnels, or register Apple push credentials. The hosted web app,
relay, Clerk configuration and native app credentials must belong to the same
Blackcrab deployment before live sign-in, outside-network connections and push
delivery can be accepted.
