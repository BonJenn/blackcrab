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

Step 4c-3 merged as PR318 (de7a815048d5b1c466525513a0e85a51417d3284), with the
two corrections to `interrupt` above and a more robust Quit check in the Linux
installed-workspace test.

## Step 4d — the scheduled task

`managed_service_task_windows.rs` is the counterpart of the launchd agent and
the systemd user unit.

- **Definition**: one sign-in trigger for the current user's SID; one program
  action (command, arguments, working directory); run as that user with
  `InteractiveToken` and `LeastPrivilege`; no execution time limit; ignore a
  second instance; restart on failure every minute, up to 999 times; nothing
  conditional on idle, battery or network.
- **Name**: `Blackcrab Service <key>`. Task names are global to the machine,
  so the key (the supervisor's) makes it unique per user and owner directory.
- **Verification**: the registered definition is exported and must match in
  every checked respect, with exactly one trigger, action and principal and no
  other trigger or action kind. Registration is verified immediately after
  creation. A task with our name that does not match is `Foreign`: it is never
  run, replaced, ended or deleted on our behalf.
  Windows rewrites a definition when it stores it, as the first CI run
  showed: elements at their default value are dropped, sections are
  reordered, and the trigger's user is recorded by account name
  (`HOST\user`) while the principal keeps the SID. The comparison is
  therefore by meaning, section by section: an absent element matches only
  where our value is Windows's default (so a missing `ExecutionTimeLimit`,
  whose default is 72 hours, does not match our "no limit"), and the
  trigger's account name is resolved to a SID and compared with the user's.
- **Tools**: `schtasks.exe` to create, run, end and delete, and Windows
  PowerShell's `Export-ScheduledTask` for the export, because `schtasks`
  prints in the console code page and would corrupt non-ASCII paths. Both are
  run by absolute path from the system directory, with a cleared environment,
  no window, and bounded time and output.

CI tests: rendering and matching (escaping, what Windows adds on registration,
thirteen single alterations each rejected), unusable definitions, and the real
Task Scheduler on the runner with `node.exe` as the action: absent, register,
verify, re-register, a same-named altered definition treated as foreign, run,
the action's arguments and working directory as given, end, unregister.

The clean stop does not go through the task: Root signals the supervisor.
`end` is the fallback when it does not respond.

A test hazard found here, which does not affect the product: while
`interrupt` is attached to a service's console, any child another thread
starts inherits that console and receives the same Ctrl+C. The supervisor
starts nothing else, but parallel tests do. The tests that interrupt now run
one at a time in their own invocation, and tests find `node.exe` by searching
PATH instead of running `where`.

Step 4d merged as PR319 (cab68022ebebad725073dd754a689fc359b0d685). The real
Task Scheduler test passed on the runner, including starting the sign-in task
on demand. It took over four minutes: every verification exports the task
through PowerShell. Root's status checks must not verify on every poll; verify
at registration and before start, stop and removal.

## Step 4e-1 — building the Windows service payload

The first change to the frozen host producer, under the owner's decision of
2026-11-14 (Windows-only, Mac and Linux identical). Two lines:

- `managed-host/build.mjs`: the service profile is accepted on `win32` as well
  as `darwin` and `linux`.
- `managed-host/service-profile.mjs`: the fresh-source-root check keeps its
  directory, no-symlink and canonical-path requirements on Windows and skips
  UID and mode, which do not exist there.

`build-controller-source-freeze.json` records new hashes for exactly those two
files. `rawSourceData`, `recordGraphSha256`, `upstream` and the other fifteen
file hashes are unchanged, and `build-source-freeze.test.mjs` passes without
modification: the inputs that determine the Mac and Linux service payloads
are what they were. The freeze's recorded state describes an audited Mac
build made with the previous two files; the Mac build controller has not been
re-run with these.

`scripts/build-windows-host-ci.mjs` and the `managed Windows host` workflow
build the real pinned service payload on `windows-2022` and verify it as a
service-profile artifact. The producer starts pnpm directly, so the workflow
installs the standalone `pnpm.exe`; and Windows' own `tar` is put first on
PATH, since GNU `tar` reads `C:` in a path as a remote host. The native
resources archive and the helper build still refuse Windows and are not run.
The checkout runs with `core.autocrlf false`: the producer hashes every
reviewed source file, and the first run failed at once because the runner's
default checkout had rewritten line endings.

This builds the payload from the unchanged service sources. They still assume
Unix at run time (`getuid`, mode bits, `O_NOFOLLOW`, a `/usr/bin:/bin` PATH for
the helper, a helper name without `.exe`). Making the built service start is
step 4e-2, as Windows-only records.

Step 4e-1 merged as PR320 (4a82d7a57973e248549319ec8e0c493c0a533104). With
the checkout fixed, the real service payload built and verified on
windows-2022: 3821 files, entry `t3.exe`, all 71 source records.

## Step 4e-2 — Windows-only service source records

`fork-integration/boot-service/windows/` holds two records applied after the
71 shared ones, only for a Windows build (see its README for what each
changes). They were written against the real final sources: the pinned
upstream archive with the shared plan applied.

`service-profile.mjs` takes the target platform: `serviceProfilePlan(platform)`
returns the frozen 71 records for anything but `win32`, and those 71 followed
by the two Windows records for `win32`. Verification of an artifact uses the
plan for the artifact's platform. This is a third change to that frozen file,
and the freeze records its new hash. `rawSourceData` and `recordGraphSha256`
are unchanged, and a new test asserts the macOS and Linux plans equal them
whatever platform runs the tools, that the Windows plan is exactly that plan
plus the two records, and that each Windows record starts from the bytes the
shared records leave.

Local evidence: the Windows plan applies cleanly to the real pinned source
(every before and after hash in the chain verified), and the host test suite
passes. The Windows job builds the payload with the records, which
type-checks the patched server sources.

Still unproven until Root can install a service on Windows: that the patched
launcher actually starts, finds its helper and stops cleanly.

Step 4e-2 merged as PR321 (8ba647d7f0d5290374e8535cbdd935d95fdf18a7). The
payload built on windows-2022 with 73 source records, which type-checked the
patched server sources.

## Step 4f-1 — payload archive and native helper for Windows

- `scripts/managed-native-resources.mjs` archives a Windows **service** payload
  (the Windows desktop package is still refused there). It runs Windows' own
  `tar.exe` (bsdtar) by absolute path, with the owner options macOS uses, and
  keeps the round-trip check: extract, re-verify, compare the tree.
- `scripts/prepare-service-issuer.mjs` builds the helper for
  `x86_64-pc-windows-msvc` as `blackcrab-issuer.exe` and requires a PE x86-64
  executable. No signing: Authenticode belongs to release packaging, and Root's
  pinned digest binds the bytes.
- The helper is built for the Windows subsystem. It is also what the scheduled
  task will run, and a console-subsystem program would open a console window
  at every sign-in. Its private pipes work the same.
- The Windows CI job now archives the payload, builds the helper pinned to
  that payload's manifest, and checks it refuses outside its installed
  location: exit 64 for no argument or an unknown one, exit 1 for its real
  argument when not installed. It exports the pins, archive and helper path
  for the native tests that follow.

Step 4f-1 merged as PR322 (452a7a0a2476b0700f2f6b9705fa5512ad62d3d7). The
built helper refused as required on the runner: 64, 64 and 1.

## Step 4f-2 — Root controls the Windows service

- `managed_service_install.rs`, `managed_service_initialization.rs` and the
  service parts of `managed_host.rs` now compile on Windows. Files are
  checked by owner and DACL instead of UID and mode. The private browser
  channel is not configured on Windows (`browser` stays absent) until step 5.
- The helper has a second fixed argument, `__blackcrab-service-run-v1`. This
  is the scheduled task's action. It verifies its own installed location and
  the selected payload exactly as the issuer does, then supervises
  `t3.exe __service-launcher` with an allowlisted environment, logging to
  `<owner>\logs\boot-service.log`.
- The task and its stop event are named by a key: SHA-256 over the lowercase
  owner directory, the generation and the environment identity, first 32 hex
  characters. Two owner directories never share a task.
- `managed_service_windows.rs` is the control, in the same order as launchd
  and systemd: one control lock, configuration and generation rechecked under
  the launcher lock, then the action. "Installed" means our task is registered
  exactly as written; a different task under that name is reported and left
  alone. "Loaded" means the supervisor is running. Stop asks the supervisor
  for a clean stop and ends the task only if that fails. Uninstall removes
  the task and keeps configuration, issuer, journal and all data.
- A status poll may reuse a verification of the same task for 30 seconds,
  because exporting the task through PowerShell takes seconds. Every action
  that changes or starts the task verifies it again.
- `managed-windows-host.yml` now runs the ignored test
  `actual_packaged_windows_service_lifecycle` after the build: set up in a
  fresh private directory, install, attach, pair, reopen, stop, start,
  restart, uninstall, with the real payload, helper and Task Scheduler.

Findings from the real runs on the runner (PR323):

- The helper is windowless and the scheduler keeps only an exit code, so the
  helper writes `<owner>\logs\service-supervisor.log`: each startup step with
  its time, each request's kind and whether it was answered, and how the run
  ended. Never a path, frame or secret.
- Timings: helper ready in about 0.75 s; one full payload verification about
  0.35–0.55 s in the release helper and 4.5–7.6 s in the unoptimized test
  build, which is why the test takes about nine minutes.
- All three stops in each passing run were logged "service stopped cleanly on
  request".
- **Intermittent start failure, cause found.** In three of seven runs the
  first start failed: the launcher logged "Owned service bootstrap is
  unavailable" and exited with 1, leaving the journal prepared (so the
  uninstall was then refused as needing recovery). The helper's record showed
  `begin` answered and `issued` never requested, which places the failure in
  the launcher's `deliver`: it writes the sign-in envelope to the new server
  process's input and allowed one second for the close to complete. On
  Windows that close completes only when the reader has taken the bytes, so
  it waits for the server process to start. The failing runs were the slow
  ones (verification 7.6 s against 4.5 s). The Windows launcher record now
  allows twenty seconds; the helper's own limit for the delivery is thirty.
  The journal-replacement retry added earlier on suspicion was never needed
  in any run; it stays as a bounded guard.
- A start that fails after `begin` leaves the journal prepared for this boot,
  and stop, start and uninstall are then refused as needing recovery, as on
  macOS and Linux. Windows has no recovery path yet other than signing out.

Step 4f-2 merged as PR323 (758debc6c73a69becb80166a8e741b92a9d46de4).

## Step 4f-3a — Root's Windows workspace launch

- `managed_workspace_windows.rs` (standalone, type-checked off-runner): the
  account home from the process token (`GetUserProfileDirectoryW`, at its
  real path, not modifiable by others); `prepare_profile` (private parent,
  profile created with the protected DACL, marker, real path, private `tmp`);
  the exact environment of step 3b with `USERPROFILE` from the token; the
  three channels at descriptors 3, 4 and 6; and window activation over 6.
- `managed_desktop_windows.rs`: `NativeDesktop`, `NativeDesktopOwner` and
  `launch` for Windows, in the same order as the Unix launch: verify the
  package, bind to the running service, start, pair, re-check the binding,
  write the descriptor once, serve renewals for our captured process only.
  A working directory cannot be a `\\?\` path, so the canonical package
  paths are given in plain form.
- Not on Windows yet: the update channel (descriptor 5) and the browser
  channel; a binding that carries a browser capability is refused.
- No entry point reaches this yet: `managed_native_entry` is still Unix-only
  (step 4f-3b).
- CI: the Windows host job now also builds the workspace. After the service
  is attached and paired, the lifecycle test opens the built workspace through
  `NativeDesktopOwner` and requires `visible: true`, the process still running
  20 seconds later, a second open to reuse it, and a second activation.

Result on the runner (PR324): the built workspace, started by
`NativeDesktopOwner` against the real service, paired, answered
`visible: true` on the third request, was still running 20 seconds later, and
a second open reused it. Findings:

- Unoptimized, one payload verification took about 7 s and the launch missed
  its eight-second pairing limit. The job now compiles `sha2` optimized for
  this test (0.67 s). A release build is unaffected.
- The first activation request is answered "not visible" while the window is
  still being created; Root's launcher asks up to sixty times, and the test
  now does the same.
- **Open: the window's content was blank white in the screenshot**, taken
  more than 20 seconds after launch. The frame, title bar and taskbar icon
  are there. Whether the interface failed to load or the runner simply cannot
  render it is not known; nothing yet reads the page on Windows as the Linux
  acceptance does. Do not count the Windows interface as shown working.

Step 4f-3a merged as PR324 (88c2478964e082dcd5de83eccc083788c404b996).

## Step 4f-3b — the native entry and launcher handoff on Windows

- `managed_native_entry.rs` holds a `NativeDesktopOwner` on Windows, counts
  Windows x64 as a supported target, and opens the verified desktop payload
  through it. `managed_launcher_handoff` waits for the window and watches the
  workspace exit on Windows as it does on macOS and Linux.
- **Still off for users.** The entry does nothing unless the build was
  compiled with the payload pins (`BLACKCRAB_EMBEDDED_*`), and release
  packaging does not prepare Windows payloads yet (step 6). A Windows build
  made today reports "notBundled" exactly as before.
- Root's application-data folder is created plainly; a Windows test checks
  that such a folder under `%APPDATA%` already passes the private-directory
  check the owner directory and payload cache require.
- The CI open of the real workspace now prints the workspace's own log
  files, to settle the blank-window finding above.

Result on the runner (PR325): the entry and handoff compile, the `%APPDATA%`
test passes, and the workspace's own records were collected:

- The workspace could not start PowerShell (`pwsh.exe` and `powershell.exe`
  "NotFound"): the search path it was given had only System32 and the Windows
  directory. It uses PowerShell to read the user's shell environment. The
  path now also has `System32\Wbem` and `System32\WindowsPowerShell\v1.0`,
  still built from `SystemRoot` and never inherited.
- **The blank window is still unexplained.** A second screenshot 85 seconds
  after launch is also blank white. The process was still running; the
  renderer history shows the main page created and "dom-ready" 34 ms later
  and nothing after; the main-process trace (273 spans) has no error other
  than the PowerShell ones and no page-load span at all. This cannot tell a
  page that failed to load from a screen capture that cannot see it. Step 6's
  installed acceptance must read the page itself, as the Linux one does.

Step 4f-3b merged as PR325 (03568bfc3e8a18948b04bb410c9c3ab685453c7b). With the
PowerShell directory on its path the workspace starts Windows PowerShell; only
the optional `pwsh.exe` is still not found. The blank window did not change.

## Order change (2026-11-15): packaging before the browser channel

Step 6 now comes before step 5. The browser channel is an add-on for in-app
browser previews and is large: a named-pipe transport on the service side, a
Windows form of the capability in Root, the issuer and the workspace
descriptor, and new records in both registries. Packaging is what makes
anything installable, and its installed acceptance, which must read the page
itself, is the only way to settle the blank window. Until step 5 a Windows
workspace runs without the native browser channel.

## Step 6a — the Windows installer

- `scripts/managed-native-resources.mjs` accepts a Windows desktop package.
- `scripts/tauri-build.mjs` starts the Tauri CLI's own script on Windows (a
  command script needs a shell there, and a shell would mangle the JSON
  configuration argument) and builds the helper through a shell-aware runner.
- `scripts/build-windows-installers-ci.mjs` (CI only): verifies both real
  payloads, builds the normal launcher with them as an NSIS installer for the
  current user, installs it silently into a directory of the run, and checks
  the installed launcher and both payload archives: each archive must unpack
  to a tree that verifies and carries the same manifest as its input.
- No code signing and no updater artifacts. An unsigned installer shows a
  SmartScreen warning on a real PC; signing is a release decision.

Step 6a merged as PR326 (4e87dd67b9680f9c40ec75f7c0353a02ab790da4). On the
runner: `Blackcrab_0.4.3_x64-setup.exe`, 375 MB, unsigned; installed silently
it leaves `blackcrab.exe`, both payload archives and `uninstall.exe`, and both
archives unpack to trees that verify with their input manifests. Tauri drops
the drive from an absolute Windows resource path, so on Windows the archives
are staged inside `src-tauri/target` and named relative to `src-tauri`.

## Step 6b — why the Windows workspace window is blank

Correction to an earlier note: the Linux acceptance does not read the
workspace's page. It reads Root's own status ("Your workspace is open."),
checks the foreground window title and keeps a screenshot. That screenshot
shows the workspace's onboarding screen fully drawn, so the blank Windows
window is a real difference between the platforms.

**Cause found (PR327).** Read through Chromium's debugging port in a test
build, the window's page is `blackcrab://app/` and the answer to it is
**404**: an empty document, three elements, no scripts. The workspace serves
its interface from `clientAssetsDir`, which is `serverRoot/apps/server/dist/
client`. In `DesktopEnvironment.ts`, for a packaged Windows build only,
`serverRoot` is `resources\server.asar`, not the app root. Our package has no
`server.asar`: `managed-desktop/build.mjs` puts the interface under the app
root on every platform, which is where macOS and Linux look. So on Windows
the interface is in the package but the workspace looks somewhere else.

Fix: desktop source record `windows-interface-under-app-root` (after
`blackcrab-environment`, same file) makes `serverRoot` the app root on every
platform. macOS and Linux already took that branch, so their behaviour is
unchanged, but the registry and therefore the payload bytes change on every
platform; the keychain-QA whole-registry pin is updated to `cd44caa8…`.
The owner chose on 2026-11-15 to continue with Windows before releasing.
**macOS acceptance is owed a re-run** (already so since PR310/311).

How it was found, so the tools are not rebuilt: a test build can keep the
workspace's output (`BLACKCRAB_TEST_WORKSPACE_OUTPUT`) and open the debugging
port (`BLACKCRAB_TEST_WORKSPACE_DEBUG_PORT`); `scripts/probe-workspace-page.mjs`
reads the page's state, console, errors and requests. A product build does
neither. Things ruled out on the way: the service does serve its own page and
script (200); the main process reports no error; the trace does not record
page requests at all, so their absence there meant nothing.

Also seen: Windows PowerShell is found but the workspace's five-second limit
on reading the shell environment through it is missed on the runner.

Step 6b merged as PR327 (acdc35d88d326bae4b794a6dad3a3f28d3df14ef). With the
fix the page is `blackcrab://app/#/welcome`, titled "Blackcrab (Beta)", 719
elements, its script and stylesheet loaded and its requests to the service
answered 200; the screenshot shows the onboarding screen, as on Linux. The
Linux installed acceptance passed with the changed payload.

## Step 6c — installed acceptance

`scripts/test-windows-installed-workspace.ps1` (CI only) runs the installed
launcher as a person does and watches from outside; it calls no native
command and sends no agent prompt. Twice over: the launcher must set up and
start the service and open the workspace by itself; a workspace window from
the payload cache must take the interface's title; the service's scheduled
task must be running; closing the workspace window must quit the workspace
and its hidden launcher but not the service; and the second launch must keep
the service's identity. Unlike the Linux acceptance it does not read the
launcher's own status line (that needs a WebView2 driver); the loaded
workspace window is the evidence instead.

First installed run (PR328): the launcher drew its own page and refused with
"The bundled runtime does not support background-service setup". The
application names its owner directory `managed-host/v1` with a forward slash;
Windows opens that, but the owner check compares the path with its canonical
spelling, which has only backslashes. `ManagedHost::new` now rebuilds the path
from its components on Windows, and the lifecycle test spells its owner
directory with a forward slash too. Every earlier Windows test had used a
backslash path, which is why only the installed app showed it.

Installed runs after that (PR328), in order:

- The launcher set up and started the service and opened the workspace, but
  the workspace showed "Something went wrong … fetch-session-state (HTTP
  500)". The first version of this acceptance passed anyway: it checked the
  window title, and the error screen has the same title.
- Not the cause: a stale saved sign-in (Credential Manager held none), and
  the service (it answered every session request 200; the 500 is made inside
  the workspace).
- **Cause: path length.** The installed app runs the workspace from the
  payload cache, whose directory name carried two whole digests: about 216
  characters before any file of the package. With sixteen characters of each
  digest the interface loaded. One library was still at 263 characters for an
  eleven-character account name, so Windows now names the cache `payloads`
  and each directory by the role's initial and twelve characters of each
  digest. Contents are verified against the whole digests on every use.
  macOS and Linux names are unchanged.
- The acceptance now requires the service to have answered the interface's
  own authenticated request for its workspace state
  (`/api/orchestration/shell`, 200), once more per launch. Reading the window
  through UI Automation returned only the title bar.
- One run's service setup then failed at "Service runtime publication
  failed". Publication renames a directory of 3,824 files that were just
  written, and Windows refuses that while any file inside is open, as a
  virus scanner's are. The underlying error is not kept, so this cause is
  inferred, not observed. `rename_no_replace` now retries access-denied and
  sharing-violation refusals for up to twenty seconds, unless the target
  already exists.
- Seen and not pursued: the service listens on all interfaces
  (`0.0.0.0:3773`, "remote-reachable") and prints a pairing token into
  `boot-service.log`, a private file. Whether that matches macOS and Linux
  was not checked.

Step 6c merged as PR328 (7f774da2898b3b06a0e590f64095776751107b70). The installed acceptance passed with
the interface loaded on both launches: service set up and running, closing the
window quits workspace and launcher, the service survives, and the second
launch keeps its identity.

## Where Windows stands (2026-11-16)

Proven in CI on windows-2022: the service payload and helper build; the
service installs, starts, stops cleanly, restarts and uninstalls through Task
Scheduler; Root launches the workspace against it; the NSIS installer builds
and installs; and the installed app sets itself up and opens a working
workspace, twice.

Not done, and needed before Windows is offered to users:

1. **Owner decisions:** code signing (the installer and programs are
   unsigned, so SmartScreen warns), and updater metadata for Windows.
2. **A real PC.** Everything above ran on one runner image under an
   administrator account. Not yet seen on a real desktop: sign-out and
   sign-in (the task's trigger), an ordinary non-administrator account, a
   long account name (path length), and the SmartScreen experience.
3. **Release build wiring.** `release.yml` builds Windows with
   `managed: false`, that is, without the payloads; only this CI job builds
   the real installer. The same line builds Linux with `managed: false`, so
   the Linux installers accepted in CI are not what a release produces
   either. Only the `managed-apple-silicon` kind bundles payloads.
4. Known gaps: no update channel in the workspace, no native browser channel
   (step 5), Windows PowerShell's shell-environment read times out at five
   seconds on the runner, and no recovery path after a start that fails
   mid-way. The uninstaller was never run: it is Tauri's stock one and knows
   nothing of the scheduled task, so expect the task and the application
   data to remain after an uninstall until that is checked and handled.

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
