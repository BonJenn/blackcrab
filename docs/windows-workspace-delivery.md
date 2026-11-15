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

Step 3a merged as PR311 (f1ac457a7dfbf87a554399effc059479d5add1aa); the three
Windows-form tests passed natively on the Windows runner.

## Step 3b — booting the built Electron workspace

Everything so far was proven with `node.exe`. The Windows workspace job now
also starts the real built `Blackcrab.exe` main process the way Root will:
a fresh profile created with the protected DACL at its canonical path, the
package directory as working directory, pipes at descriptors3,4 and6, and
exactly this environment: `SystemRoot`, `SystemDrive`, `windir`, `USERPROFILE`,
`PATH` (System32 and the Windows directory), `TEMP` and `TMP` at
`<profile>\tmp`, and `OTEL_SDK_DISABLED`. The descriptor has the right shape
with a made-up credential and an unused port, so the workspace can start but
cannot attach to anything.

It passes when the environment contract has created
`app-data\blackcrab-managed-v1`, `tmp` and `logs` in the profile and each is
still private. That only happens after the workspace read the descriptor from
descriptor3 and accepted the profile and variables: the exact point where the
Linux workspace failed silently. The lifecycle reply is recorded, not required.
On failure it saves a screenshot (an uncaught main-process error is a message
box on Windows) and lists the profile.

Step 3b merged as PR312 (ac797ae537359de23084f64e0a0635acfc06dc65). Run
43665398105 on windows-2022: the built `Blackcrab.exe` read its descriptor,
accepted the profile and environment, created its storage in the private
profile, answered the lifecycle request `{"version":1,"id":1,"visible":false}`
and then showed its own "Blackcrab failed to start — Stage: bootstrap — fetch
failed — bad port" dialog, the expected result of the made-up port. Root's own
Windows launch wiring is deferred until a service exists to attach to.

## Step 4 — background service: decisions (owner, 2026-11-14)

1. **Mechanism: a per-user scheduled task.** A Task Scheduler task that runs at
   sign-in, needs no administrator rights, restarts on failure, and whose
   registered definition can be read back and compared, as the systemd unit's
   loaded properties are. Its action is Blackcrab's own signed helper, which
   starts `t3.exe __service-launcher` with the exact environment (a task
   definition cannot carry one) and stops it cleanly. A Run key (no restart or
   status) and a true Windows service (administrator install, outside the user
   session) were considered and not chosen.
2. **Frozen host producer: Windows-only, Mac and Linux identical.** Windows
   changes to the service launcher sources go in as Windows-only records, and
   the freeze file's hashes are updated only for the producer scripts edited.
   The Mac and Linux service payloads must stay byte-identical, so the
   installed Mac `c04c4d44…` service and its data are untouched.
   This is achievable: the host artifact (`BUILD-PROVENANCE.json` and the
   manifest) records the upstream pin, tool versions, the plan's
   `sourcePatches` and the target, not the producer scripts' hashes. The
   existing `build-source-freeze.test.mjs` assertions on `rawSourceData` and
   `recordGraphSha256` for the default plan are the proof and must keep
   passing unmodified; only `files` entries may change.

Known constraints for the design, from the Linux implementation:

- The Node launcher stops on SIGTERM/SIGINT and only then retires its issuer
  epoch. Ending a task terminates the process outright, which would leave a
  non-retired journal and make later service control fail closed for the rest
  of the boot. The helper must deliver a stop the launcher handles.
- The issuer speaks newline JSON on stdin/stdout pipes and is entirely
  `cfg(unix)` (poll, fcntl, fstat kind checks, uid/mode).
- `OwnedLauncherBootstrap.ts`, `serviceLauncher` and `service-profile.mjs`
  require `process.getuid`, mode bits and `O_NOFOLLOW`, spawn the issuer with a
  `/usr/bin:/bin` PATH and name it without `.exe`.
- `managed-native-resources.mjs`, `prepare-service-issuer.mjs`, the service
  profile build and `build-linux-host-ci.mjs` refuse Windows.
- The frontend accepts exactly the existing `ServiceStatus` shape and states.

## Step 4a — boot identity

The issuer's journal records the boot it was written in; a non-retired journal
is only retired when the current boot differs, and anything else fails closed.
The module allows a kernel identity only: no timestamp, persisted file or
random fallback. On Windows that identity is `BootId` in `KUSER_SHARED_DATA`,
the kernel's read-only page mapped at `0x7FFE0000` in every process: the
kernel's count of boots of the installation. It is read directly, guarded by
the major version field in the same structure (10 on Windows 10 and 11), and
rendered as the UUID `626f6f74-6964-4000-8000-<counter>`. A zero counter or an
unknown layout is "unavailable". The CI test checks it is stable and prints the
registry's own boot count beside it for comparison. It cannot show the value
changes across a reboot.

Step 4a merged as PR313 (3a3df8a3cc3a3ce7c47bba12917392a6bff2d64e). On the
runner the kernel `BootId` was13 and the registry's `PrefetchParameters\BootId`
was `0xd`: the two agree.

## Step 4b-1 — issuer pipe I/O

The Unix issuer sets its inherited stdin/stdout non-blocking and polls them
with deadlines. The handles a Windows issuer inherits from the Node launcher
are synchronous anonymous pipes: no polling, no timeouts.
`managed_service_issuer_io.rs` gives each direction one thread that makes the
blocking call while the issuer waits on a channel with its deadline:

- Input is handed over one byte at a time through a rendezvous, so at most one
  byte beyond the current frame leaves the pipe and it is kept for the next
  read. A missed deadline loses nothing. A closed writer is end of stream.
- Output writes a whole frame or fails. After any failure, including a missed
  deadline with the write still pending, the output is retired so a late
  completion cannot be taken for a later frame's.
- `standard_pipes()` opens the process's own standard handles unbuffered and
  requires both to be pipes.

The logic is platform-neutral and its three tests run on Mac, Linux and
Windows. `standard_pipes()` itself is not exercised until the issuer runs on
Windows, and the issuer still does not compile there: its file and owner
checks (`uid`, mode `0700`/`0600`, `O_NOFOLLOW`) and `managed_host.rs`'s
private file helpers are the next piece.

Step 4b-1 merged as PR314 (6386298d39078acf86d7c8dbbd3881b13ade968a); its three
tests passed on the Windows runner.

## Step 4b-2 — the issuer on Windows

`managed_service_issuer.rs` now compiles for Windows. The state machine,
journal, binding, locks and verification logic are shared unchanged; what
differs sits in a `platform` module with one implementation per family:

| | Unix | Windows |
|---|---|---|
| Helper file name | `blackcrab-issuer` | `blackcrab-issuer.exe` |
| Private executable | regular, one link, our UID, mode `0700` | regular, one link, not a reparse point, owner and DACL private |
| Private file | our UID, mode `0600` | owner and DACL private |
| Private directory | `mkdir` with `0700` | created with the protected DACL |
| Canonical path | `canonicalize() == path` | same, ignoring the verbatim prefix and case |
| Directory flush | `fsync` on the directory | none; files are flushed and publication renames with write-through |
| Transport | non-blocking descriptors and `poll` | `issuer_io` threads over the inherited standard pipes |

The framing, 64 KiB frame bound, 30-second frame and delivery deadlines,
5-second write deadline and end-of-stream rule are the same in both loops. A
browser capability in the configuration is refused on Windows, where no
private browser channel exists yet. The Unix path was refactored onto the same
helper names; its 23 issuer tests pass unchanged.

Windows tests (`managed_service_issuer_windows_tests.rs`): the loop issuing,
retiring and ending cleanly over real pipes; end of stream while prepared
leaving the journal prepared; a malformed frame poisoning the session; the
helper copy installed under its digest and refused once readable by others;
private files refused when shared, hard-linked or oversized; junction and
relative paths not canonical.

Only the standalone helper entry reaches the issuer on Windows. Root's
service control, initialization and attachment are still Unix-only, and
`managed_host.rs`'s `private_directory`/`private_options` still do nothing
protective on Windows: that must be fixed before Root creates an owner
directory there.

Step 4b-2 merged as PR315 (c96cce94f79d6de00fea285a602288ee751c181b); all six
Windows issuer tests passed on the runner at the first attempt.

## Step 4c-1 — a stop the service can handle

The Node service launcher stops on SIGTERM or SIGINT and only then retires its
issuer epoch. Windows cannot deliver SIGTERM, and ending a process or a
scheduled task terminates it with no handler run. The one stop a Node program
can handle is Ctrl+C on its console, which arrives as SIGINT.

Console events go to a console, not a process, so:

- `spawn_with(…, Console::Hidden)` starts the child with `CREATE_NO_WINDOW`: a
  console of its own with no window, shared by its descendants and by nothing
  else.
- `interrupt(process)` leaves this process's console, attaches to the child's,
  ignores Ctrl+C itself and raises it there.

The CI test starts `node.exe` on a hidden console as a stand-in for the
launcher, with a child of its own as the launcher has its server, interrupts
it, and requires the program's SIGINT handler to have run, its follow-up work
to have completed and its own exit code 0. It prints what reached the
grandchild, which shares the console and is therefore expected to receive the
event too; the service design has to allow for the server seeing SIGINT at the
same moment as the launcher.

Still open for the helper's run mode: who asks for the stop (a private event
Root signals, since ending the task would bypass it), and sign-out. At
sign-out Windows gives console programs only a few seconds; the helper must
interrupt the launcher then, or the journal stays unretired and the service
fails closed until the next boot.

Step 4c-1 merged as PR316 (f40300819b733996df191aa292c5101522841ff7). On the
runner the stand-in received SIGINT, finished its follow-up work and exited0
by itself. Its own child, on the same hidden console, received SIGINT at the
same moment and also exited0: the real server will see the stop together with
the launcher, not after it.

## Step 4c-2 — the service supervisor

`managed_service_run_windows.rs` is what the scheduled task will run in place
of the launcher itself:

- `supervise(plan)` creates the stop event, starts the launcher on a hidden
  console with exactly the plan's environment and its output appended to a log
  file, inside a job, and waits for the launcher's exit or a stop request.
  A stop is delivered as Ctrl+C. If the launcher exits within the grace period
  its own exit code is reported; otherwise the job is ended.
- The job is kill-on-close and the launcher joins it before running any code
  (it is created suspended, assigned, then resumed), so nothing it ever starts
  can outlive the supervisor, even if the supervisor is itself terminated.
- The stop event is `Local\blackcrab-service-stop-<key>`: per sign-in session,
  openable by the current user only. Creating it doubles as the
  single-supervisor check; a second supervisor for the same key starts
  nothing. `request_stop(key)` is what Root will call.

`managed_spawn_windows` gained what this needs: an `Options` value with the
console choice, an inheritable output handle for standard output and error,
and the job; and a lock around `interrupt`, since a process has one console.

CI tests, with `node.exe` standing in for the launcher and a child of its own:
a stop request arrives as SIGINT and the service's own exit is reported with
its child gone, exact environment and both streams in the log; a service that
ignores the stop is ended together with its child after the grace period; a
service that ends by itself reports its exit code and appends to an existing
log.

Not yet here: deriving the plan from the verified owner directory (needs a
Windows service payload), the helper's command-line entry for it, and
sign-out. Without sign-out handling the supervisor is simply terminated at
sign-out, the journal stays unretired, and the service fails closed until the
next boot. That must be handled before release.

Step 4c-2 merged as PR317 (1c2488e7a5fbfa1eb954f9612e29215dae2c5295); its three
supervisor tests passed on the Windows runner.

## Step 4c-3 — sign-out and shutdown

When a session ends Windows sends `WM_QUERYENDSESSION` and then
`WM_ENDSESSION` to top-level windows and terminates what remains. A terminated
supervisor would leave the journal unretired, and after a sign-out without a
reboot the boot identity is unchanged, so the service would fail closed until
the next boot.

The supervisor now keeps a hidden top-level window on its own thread
(message-only windows do not receive these broadcasts) and calls
`SetProcessShutdownParameters(0x3FF)` so it is told before ordinary programs,
including the service's own console processes. On the query it agrees and
starts stopping; on the final notice it does not return until the service has
stopped or `session_grace`, shorter than the normal grace, has passed, since
Windows may terminate the process as soon as that notice returns. A sign-out
the user then cancels has still stopped the service; that is the safe
direction, and the task's restart setting brings it back.

The CI test sends the two messages to the window, as Windows would, and
requires the final notice to return only after the service's SIGINT handler
has finished and it has exited0. This simulates the notice; a real sign-out
cannot be exercised on a runner, and the few seconds Windows actually allows
are not measured there.

**Correction to step 4c-1, found by this step's CI run.** `interrupt` first
protected itself with the console ignore flag, `SetConsoleCtrlHandler(NULL,
TRUE)`. That flag is inherited by every child started afterwards, so a service
started after any earlier interrupt in the same process never received its
Ctrl+C; the earlier runs passed only because their children happened to start
first. The sender now survives the event through a handler routine, which is
not inherited, and `spawn_with` clears the ignore flag before starting a
hidden-console child, since an outer launcher or scheduler may have set it (a
new process group does). A test sets the flag deliberately and then starts
and stops two children in turn.

A second run then showed that attaching to a console resets the process's
handler list: a handler registered beforehand was gone when the event was
raised, and the sender died with `STATUS_CONTROL_C_EXIT`. The ignore flag had
hidden this because it survives an attach. The handler is now registered
after every `AttachConsole`, and the sender stays attached briefly so its own
copy of the event is handled before it detaches.

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
