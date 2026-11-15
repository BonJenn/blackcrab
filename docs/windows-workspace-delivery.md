# Windows x64 workspace delivery

Windows compiles and its built packages verify, but every runtime step of the
bundled workspace is Unix-only: payload extraction, the background service,
the private launcher-to-workspace channels, the browser channel and installers.
This records the port in the order it has to land. Each step must be proven on
a real Windows runner; `cargo check` and Mac tests are not evidence.

## Rules carried over from Mac and Linux

- Native storage is trusted from an opened handle, never a path: not a reparse
  point (symlink or junction), single link for files, owned by the current
  user, and granting nothing to other accounts.
- Existing unmarked directories are never adopted, replaced or removed.
- Publication is an atomic rename that never replaces a destination.
- Nothing is enabled for users until the whole launch path is accepted on
  Windows. `managed_native_entry.rs` still constructs no payloads there.

## Step 1 — private storage and the payload cache (this branch)

`managed_private_windows.rs` supplies the Windows equivalents of the Unix
UID/mode checks, read from the handle's owner and DACL:

- Trusted owners and grantees are the current user, SYSTEM and Administrators
  (the last two are root-equivalent). `Private` allows no other allow-entry;
  `NoForeignWrite` tolerates read-only entries, the counterpart of rejecting
  Unix group/other write. A null DACL or an unknown ACE type fails closed.
- Private directories are created with a protected DACL for those three
  accounts, inherited by children, and creation fails if anything exists.
- Files are opened without following reparse points and must have one link.
- Rename uses `MoveFileExW` without replace, with write-through.

`managed_payload_windows.rs` implements the cache on those primitives: marked
private root published under an init lock, lease lock, staging, extraction,
verification and no-replace publication. Windows packages contain no links, so
symbolic and hard link entries are refused, as are device names, trailing dots
or spaces, wildcard characters and names differing only by case. Each file is
flushed before the write-through rename.

The Windows CI job runs these tests against real NTFS descriptors (foreign
read and write grants via `icacls`, junctions, hard links, existing roots).
Local evidence is limited to type-checking against `x86_64-pc-windows-msvc`
and the unchanged Mac payload tests.

## Remaining steps

2. **Workspace bootstrap channels.** Root passes the workspace descriptor,
   credential renewal, update and lifecycle channels as inherited descriptors
   3 to 6. Windows needs inherited pipe handles the Electron process can open
   as the same descriptor numbers, or an equivalent private handle transport,
   and the payload's descriptor contract must accept it. That changes payload
   modules shared with Mac, so Mac acceptance is re-run with it.
3. **Workspace profile and environment contract.** `prepare_profile`, the
   account home and `native-os-home-environment.mjs` assume UID, mode bits and
   `O_NOFOLLOW`.
4. **Background service.** Per-user startup with the same single-owner and
   attachment guarantees as launchd/systemd, the native issuer helper and its
   boot-session identity, and service installation into private storage.
5. **Browser channel.** The leased Unix socket needs a private named-pipe
   equivalent on both the host and workspace sides.
6. **Packaging and acceptance.** Resource preparation and the issuer build
   refuse Windows today; then an installer, installed graphical acceptance on
   a Windows runner, signing and updater metadata.

Long paths are a known risk for step 6: the cache directory name carries two
64-character digests, so files inside a package can exceed 260 characters.
Extraction handles that; whether Electron loads from such paths is untested.
