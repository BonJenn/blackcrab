# Blackcrab hosted web artifact

The hosted producer builds the pinned original web application with the managed
client patches and a recorded hosted profile. Account discovery, pairing, thread
and prompt links, and the latest/nightly channel selector keep their original
implementations. Computer setup instructions refer to Blackcrab; the build does
not ask users to install an unrelated npm application.

Set the five public client settings from `CLIENTS.md`, plus:

- `BLACKCRAB_APPLE_TEAM_ID`: the Apple developer team that signs
  `dev.blackcrab.remote` (ten uppercase letters/digits).
- `BLACKCRAB_DESKTOP_DOWNLOAD_URL`: the HTTPS download page for Blackcrab.
- `BLACKCRAB_PRIVACY_POLICY_URL`: Blackcrab's HTTPS privacy policy page.
- `BLACKCRAB_ANDROID_CERT_SHA256` (optional): comma-separated signing certificate
  SHA-256 fingerprints for `dev.blackcrab.remote`. With none, the Android
  association file contains no app entries.

For release channels, also set `BLACKCRAB_HOSTED_LATEST_URL`,
`BLACKCRAB_HOSTED_NIGHTLY_URL` and `BLACKCRAB_HOSTED_APP_CHANNEL` (`latest` or
`nightly`). The canonical hosted URL and the two channel origins must have three
distinct HTTPS hosts. Build each channel with its matching channel value. The
canonical host routes visitors according to the original persistent cookie
behavior, using `blackcrab_web_channel` and `/__blackcrab/channel`. Leaving all
three channel settings absent produces a single-origin hosted app without the
channel selector.

```sh
node scripts/build-managed-hosted-web.mjs \
  --archive /path/to/pinned-t3-source.tar.gz \
  --cache /path/to/private/build-cache \
  --output /path/to/absent/hosted-artifact \
  --node /path/to/node-26.12.1 \
  --pnpm /path/to/pnpm-12.14.0
```

The command verifies the toolchain and archive, installs frozen dependencies
with lifecycle scripts disabled, and runs the original Vite build. It accepts
only explicit public configuration for the hosted app; inherited T3/Vite/Vercel
service settings do not select an account or server. The result contains
`.vercel/output/config.json`, `.vercel/output/static`, upstream licensing, and
`BUILD-PROVENANCE.json`. The app association files are served as JSON before
channel routing and the SPA fallback. Build output retains the owned icon and
web app manifest.

This command does not deploy, create a Vercel project, assign domains, configure
Clerk applications, or register a signing identity. Before deployment, verify the
intended Blackcrab Vercel project, domain, channel targets and signing IDs. Deploy
the reviewed artifact with the prebuilt workflow. Configure the same hosted
origin in the desktop and iOS builds. Apple domain association, real sign-in,
remote connections, notification delivery and physical-device link opening still
require acceptance against the deployed Blackcrab service.
