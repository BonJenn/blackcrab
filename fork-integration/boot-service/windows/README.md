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
  and no window, in place of a `/usr/bin:/bin` PATH. It also allows twenty
  seconds, not one, to hand the server its sign-in envelope: on Windows
  closing the pipe completes only when the server process has started and
  read it, and one second failed in two of six real runs on the CI runner.
- **`owned-windows-serviceLauncher`**: drops the `getuid` and mode
  requirements on runtime metadata; and stops the server child by closing the
  launcher's IPC channel, which the server treats as a stop, because `kill()`
  ends a Windows process at once whatever signal is named.

- **`owned-windows-OwnedServiceBrowser`** and
  **`owned-windows-leasedDesktopBrowser`** (0.4.5): the in-app browser's
  private channel. On Unix it is a socket in a private directory under `/tmp`;
  on Windows it is a named pipe, `\\.\pipe\blackcrab-browser-<32 hex>`. The
  first record accepts only that name in the sign-in envelope; the second
  checks the name where the Unix code checks the directory's owner and mode,
  and skips `chmod`. The protocol is unchanged: both sides prove the shared
  key before any frame is accepted and every frame is authenticated. The
  workspace's copy of this module (`managed-desktop/patches/gate-c-5.ts`)
  carries the same two changes on every platform.

  What a pipe cannot give: Node cannot set a pipe's access list, and pipe
  names can be listed by any account on the PC. Another account could
  therefore connect to the pipe, or create one of that name before the service
  starts, and so stop the browser pane from working. It cannot read or send a
  frame, since it does not have the key.

Windows has no UID or mode bits, and JavaScript cannot read owners or DACLs.
Privacy of the owner directory on Windows is the protected DACL the native
launcher creates and verifies; these sources check structure only.

The `.patch` files are the reviewed evidence; the records' `replacements` are
what is applied, each to text that must occur exactly once.
