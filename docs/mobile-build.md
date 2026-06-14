# Mobile build guide (EAS)

This guide walks the project owner through producing the first installable build of
the Blackcrab Remote mobile app (`apps/mobile`) with Expo Application Services (EAS)
and getting it onto a physical phone.

The app targets **Expo SDK 54 / React Native 0.81 / React 19.1.0** and is configured
for a **dev-client** development build, which is what you want for day-to-day work:
you build the native shell once, then iterate on JS over the network.

> Several of these steps require your Expo (and, for iOS device builds, Apple
> Developer) credentials, so they must be run by you on your own machine. They are
> spelled out exactly below.

## Prerequisites

- An [Expo account](https://expo.dev) (free). You will log in with it via `eas login`.
- For **iOS builds on a physical device**: a paid
  [Apple Developer Program](https://developer.apple.com/programs/) membership
  ($99/yr). EAS can manage signing credentials for you.
  - To avoid this initially, you can either build for the **iOS Simulator**
    (no Apple account needed) or build for **Android** (no developer account needed
    to sideload an APK).
- Node.js and npm installed, and all dependencies installed from the repo root:

  ```bash
  npm install
  ```

## 1. Install the EAS CLI

Either install it globally:

```bash
npm i -g eas-cli
```

…or invoke it ad hoc without a global install by prefixing every command with
`npx`, e.g. `npx eas-cli build ...`.

## 2. Log in

```bash
eas login
```

Use your Expo account credentials. Confirm with `eas whoami`.

## 3. Initialize the project (one-time)

From `apps/mobile`:

```bash
cd apps/mobile
eas init
```

This registers the app under your Expo account and writes the generated
`expo.extra.eas.projectId` (and the `owner` field) into `app.json`.

> **This produces a git diff.** `eas init` edits `apps/mobile/app.json` in place.
> Review the change and commit it so the project ID is shared with the team:
>
> ```bash
> git add apps/mobile/app.json
> git commit -m "Register mobile app with EAS"
> ```

The project ID is intentionally **not** pre-filled in the repo — it is unique to
your Expo account and only `eas init` can generate a valid one.

## 4. Build a development (dev-client) build

The `development` profile in `eas.json` produces an internally-distributed
dev-client build (`developmentClient: true`, `distribution: internal`) so it can be
sideloaded onto your phone.

### iOS (physical device)

```bash
cd apps/mobile
eas build --profile development --platform ios
```

The first iOS device build will prompt you to:

- Sign in to / let EAS manage your Apple Developer credentials.
- **Register your device's UDID** with your Apple Developer account. EAS guides you
  through this (`eas device:create`) and shows a QR/URL to enroll the device. Only
  registered devices can install an internal-distribution build.

When the build finishes, EAS prints a URL. Open it on the phone (or scan the QR in
the terminal) and install the `.ipa` directly. Alternatively, distribute via
**TestFlight** by submitting the build (`eas submit --platform ios`) — useful for
testers who are not on your device list.

### iOS (Simulator — no Apple Developer account)

```bash
cd apps/mobile
eas build --profile development-simulator --platform ios
```

This produces a simulator-compatible build you can drag onto a running iOS
Simulator. Good for trying things out before paying for the Apple program.

### Android (physical device — no developer account needed)

```bash
cd apps/mobile
eas build --profile development --platform android
```

The `development` profile builds an **APK** (not an AAB), so you can download it
from the EAS build URL and install it directly on the device. Enable "Install
unknown apps" for your browser/file manager on the phone when prompted.

## 5. Run the dev server and connect the dev client

A dev-client build ships the native code but loads JS from your machine. Start the
bundler from the repo root:

```bash
npm run start --workspace @blackcrab/mobile
```

(That runs `expo start` inside `apps/mobile`.) Then on the phone:

- Open the installed **Blackcrab Remote** dev-client app.
- It will either auto-detect the running dev server on the same network, or you can
  scan the QR code shown in the terminal, or enter the `exp://<your-ip>:8081` URL.
- Make sure the phone and your computer are on the **same Wi-Fi network**. (The app
  itself also uses local-network access to reach your desktop — see the
  `NSLocalNetworkUsageDescription` in `app.json`.)

After this, JS changes hot-reload over the network; you only need to rebuild the
native dev client when you change native dependencies, app config, or permissions.

## 6. Other profiles

- `preview` — internal-distribution release-style build (APK on Android). Use to
  hand a near-production build to testers without a dev server.
- `production` — store-bound build with `autoIncrement` for the build number.
  Submit with `eas submit --profile production`.

## Notes

- The app `version` in `app.json` is currently `"0.0.0"` (placeholder). It is fine
  to build with this; bump it when you start cutting real releases.
- Bundle identifiers are already set to `dev.blackcrab.remote` for both
  `ios.bundleIdentifier` and `android.package`.
