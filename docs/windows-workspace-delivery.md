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

Step1 merged as PR308 (eebb5bb17930775730a10021dbe70a9a58c7ec0d); all eight
tests passed on the Windows runner at the first attempt.

## Step 2a — spawning with inherited descriptors

Root gives the workspace its private channels as descriptors3 to6. Windows has
no kernel descriptor table: the child's C runtime rebuilds one from
`STARTUPINFO.lpReserved2`, which is how Node and Electron children receive
extra `stdio` entries. `managed_spawn_windows.rs` does that from Rust:

- `channel()` makes one duplex named pipe per channel: random 128-bit name,
  first-and-only instance, remote clients rejected, DACL for the current user
  alone. Root's end is overlapped, so a pending read never blocks a write and
  each transfer takes a timeout; a closed peer reads as end of stream. The
  child's end is synchronous for the bootstrap descriptor, which is read to
  the end with blocking reads, and overlapped for every two-way channel. The
  first CI run showed why: with a synchronous child end Node opened both
  sockets but its first write never completed while a read was pending.
- `spawn()` starts the executable with exactly the given environment, standard
  streams on `NUL`, and only the listed handles inherited (explicit handle
  list), each at its descriptor number.
- There is no half-close on a pipe. Root signals the end of the bootstrap
  descriptor by closing its end of descriptor3.

Its CI test starts the runner's `node.exe` and checks from inside the child:
descriptor3 delivers the bootstrap bytes and end of stream, 4 and6 are live
duplex pipes, 5 and7 are closed, the environment holds only what was passed,
and arguments with quotes survive. Not yet shown: the same against the built
Electron workspace, and nothing here is wired into the launcher.

One fact for step 2b: in the child these descriptors are pipes, and Node's
`fstatSync` reports them as neither socket nor FIFO on Windows. The workspace's
`credential-broker.mjs`, `update-client.mjs` and `lifecycle.mjs` require
`fstatSync(fd).isSocket()`, so those payload checks need a Windows branch that
identifies the inherited pipe some other way.

Step 2a merged as PR309 (f9b0f8f3f4f06ed512734a379eaa5724358aa059).

## Step 2b — workspace channel modules accept Windows pipes

The owner chose on2026-11-14 to edit the shared workspace modules with a
Windows-only branch, accepting that the Mac workspace payload's bytes change
and its acceptance is redone before0.4.4.

`credential-broker.mjs`, `update-client.mjs` and `lifecycle.mjs` required
`fstatSync(fd).isSocket()`. On Windows the inherited channel is a pipe that
`fstat` reports as neither socket nor FIFO, so there the stat check is skipped
and `net.Socket({fd})`, which refuses any descriptor that is not a pipe or
socket, is the check; a refusal surfaces as the same error. Behaviour on Mac
and Linux is unchanged: the socket requirement still applies.

Registry consequences: the three payload records in
`managed-desktop/patches/registry.json` carry the new digests, and
`fork-integration/native-keychain-qa/registry.json` pins the new whole
registry (`c2881ccb…`). No QA patch targets these three files, so no QA
predecessor digest changed. The host build freeze is untouched.

**This changes the Mac desktop payload manifest.** The installed Mac0.4.3 app
is unaffected; the next Mac build from stage has a different workspace payload
and needs its native acceptance again before release.

Evidence on Windows: the Node tests for the three modules now run there with
overlapped inherited pipes, and a Rust test starts `node.exe` through
`managed_spawn_windows` with Root-made pipes at4,5 and6 and drives the real
modules: credential request and accepted reply, an update request sent only
after that, and a lifecycle activation acknowledged as visible.

Still not wired: `launch_verified`, its broker/update/lifecycle servers and
`prepare_profile` remain Unix-only, and `native-os-home-environment.mjs` still
refuses Windows. Those are step3.

Step 2b merged as PR310 (c3c92bf67e227e6b59b9bd2bda38a04c1919c4eb); the Rust
test and the three module test files passed on the Windows runners first time.

## Step 3a — the managed environment contract on Windows

`environment.mjs` (source `fork-integration/native-os-home/payload/`, installed
copy `managed-desktop/patches/native-os-home-environment.mjs`) is what refused
the Linux workspace when its temp directory was moved. On Windows it could not
run at all: it requires `process.getuid`, `O_DIRECTORY` and `O_NOFOLLOW`.

Windows form, decided here:

- The owned location variables are `USERPROFILE`, `TEMP` and `TMP` (not `HOME`
  and `TMPDIR`), plus `T3CODE_HOME`. Both temporary variables must equal
  `<profile>\tmp`. Root must therefore launch the workspace with exactly those.
- Variable names are matched without regard to case, for owned names and for
  the foreign `T3CODE_`/`VITE_`/`OTEL_` prefixes. A plain object carrying one
  owned variable under conflicting spellings is not an authority.
- Storage directories are checked structurally only: a real directory, not a
  symbolic link or junction, at its canonical path. Privacy is not checked in
  JavaScript, which has no access to owners or DACLs; it is the protected DACL
  Root creates and verifies on the profile root (step1) and children inherit.
  **Root's Windows `prepare_profile` must do that before launch**, or this side
  is not private.

Mac and Linux logic is unchanged, but the payload bytes are. Pins updated: both
registries' payload record, the keychain-QA `preserved-source` predecessor, its
sample record and before/after fixtures, and its whole-registry pin
(`68e8fbcd…`). `managed_native_keychain_qa.rs` embeds the old digest as a record
of one historical QA artifact; it is test-only, already pinned to an older
registry, and was left alone.

Tests: `environment.windows.test.mjs` needs only Node. It runs natively in the
Windows workspace job, and on Linux CI with the platform reported as win32 so
the name and directory rules are exercised there too.

## Remaining steps

3. **Workspace launch, profile and environment contract.** Port
   `launch_verified` and its broker, update and lifecycle servers from
   `UnixStream` to the Windows pipes; `prepare_profile`, the account home and
   `native-os-home-environment.mjs` assume UID, mode bits and `O_NOFOLLOW`.
   The environment module is also patched by the keychain QA recipe, so its
   QA predecessor digests and fixtures change with it. Prove the descriptor
   mechanism against the built Electron workspace, not only Node.
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
