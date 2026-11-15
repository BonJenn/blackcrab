# Windows-only service source records

These records are applied after every shared service-profile record, and only
when the service payload is built for Windows. The macOS and Linux payloads do
not include them: `serviceProfilePlan('darwin')` and `('linux')` are the frozen
plan, pinned by `managed-host/build-controller-source-freeze.json` and checked
by `managed-host/service-profile-windows.test.mjs`.

Each record continues from a file exactly as the shared records leave it and
changes only what cannot hold on Windows:

- **`owned-windows-OwnedLauncherBootstrap`**: drops the UID and mode
  requirements on the owner directories, the private files and the helper
  (keeping regular-file, single-link, size, digest and no-symlink checks, and
  adding a canonical-path check on the directories); names the helper
  `blackcrab-issuer.exe`; and starts it with a Windows environment
  (`SystemRoot`, with `USERPROFILE`, `TEMP` and `TMP` at the owner directory)
  and no window, in place of a `/usr/bin:/bin` PATH.
- **`owned-windows-serviceLauncher`**: drops the `getuid` and mode
  requirements on runtime metadata; and stops the server child by closing the
  launcher's IPC channel, which the server treats as a stop, because `kill()`
  ends a Windows process at once whatever signal is named.

Windows has no UID or mode bits, and JavaScript cannot read owners or DACLs.
Privacy of the owner directory on Windows is the protected DACL the native
launcher creates and verifies; these sources check structure only.

The `.patch` files are the reviewed evidence; the records' `replacements` are
what is applied, each to text that must occur exactly once.
