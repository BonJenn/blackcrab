# User-approved Apple native acceptance controller

The full compiler-enabled Release at source `47b65a55da249591e387cf0beca31a7b55ce44c5`
passed baseline pairing/catalog seeding and upgraded catalog retention, rename
and archive on a fresh owned iOS 26.2 simulator. Each phase passed exactly one
UI test with zero failures or skips. The independent original SDK confirmed the
exact renamed title and archived state. Legacy keychain and queue digests were
unchanged, no runs or provider sessions were created, and the captured host
closed. The initial legacy queue was empty, so populated migration remains open.

The source-bound nonsecret canary passed and its official result, device/nonce
completion and redacted activity exports were privately reviewed. The native
runner uses Command-A and checks the rename field value before saving. Thirty
portable guard tests pass. Physical iOS, broader controls, push, distribution
and full parity remain open.

## Concrete mechanism

`controller.py` requires the explicit approval flag, a private `Root-QA` directory
on the task-owned APFS volume with ownership enabled and the existing ownership
marker, and six GiB stable internal free. It creates a unique private run child.
`artifact-pins.json` freezes both existing signed app inventories and the runner,
controller and fixture sources. The controller compares every file/link/mode,
checks the fixed app ID and strict codesign, and pins proof9's manifest. The
fixture independently verifies its full packaged inventory and nonce-HMAC host
proof before owner OAuth exchange. No bootstrap secret leaves the owner.

Before creating any device, the controller reuses the exact prebuilt runner
e1a9b5399f85f1d723901334e25aa209334b94311954168579a1755fd0197d2c after
full Products inventory, source, descriptor, signature, arm64 and deployment/runtime
checks. It never silently rebuilds after boot. Each private phase descriptor rebases
__TESTROOT__ to its verified Products copy, preserving __TESTHOST__/__PLATFORMS__.
The controller creates a uniquely nonce-named iOS26.2 iPhone17Pro, captures its
UUID/data path, checks it before use, and starts a two-GiB low-water shutdown
guard. The Swift runner additionally requires its actual simulator UDID/name to
match the receipt. No existing device is selected or controlled.

1. A **nonsecret logging canary** runs first after approval: install baseline,
   open Workspaces, type only the fixed invalid nonsecret canary into the secure
   fields, never submit Pair. No host or actual grant is created. Its receipt is
   `reviewed:false`; it cannot authorize acceptance until privately reviewed.
2. Acceptance requires the reviewed receipt bound to the exact Swift source.
   The unchanged actual SDK fixture creates one idle nonce-named thread and a
   separate standard pairing grant, all within the disposable proof9 host.
   Baseline native UI writes the existing managed catalog through its original
   secure fields. No app instrumentation or direct catalog insertion is used.
3. The controller compares only the owned app's fixed legacy pairing/read-cursor
   keychain rows and queue-recovery directory digests after Swift terminates it, and
   installs the compiler-enabled build over the same bundle ID **without uninstalling**.
4. Full UI cold launch must show the existing nonce-named thread. Native rename
   and archive are independently checked through the actual SDK. Final runs and
   providerSessions must both be empty; legacy digests must be unchanged.
5. Captured host cleanup is confirmed before any summary: the live fixture closes
   its actual host Child. On failure the controller first requests cooperative
   abort through the live owner socket and waits before interrupting the captured
   fixture process. Abort records a failed acceptance, never a passing workflow.
   A saved PID/start/PGID/data-root receipt never authorizes a
   signal. Missing or uncertain host closure stops acceptance and retains private
   evidence; the controller does not reconstruct a lost host handle. Only fixed booleans
   and counts go into the sanitized summary; raw logs/results are never exported.

## Secrecy and limits

XCTest **may record typed credentials in raw activity logs and xcresults**. This
suite does not claim Apple's logger redacts them. All raw stdout, environment
payloads, inputs and results stay under a private ownership-aware APFS 0700 run
root, with 0600 inputs/logs and final recursive owner/mode normalization. No token
is passed in argv, printed, committed, or put in the sanitized summary. The
paired host is disposable and stopped before report publication. Node/Xcode use
isolated HOME/TMPDIR/module caches and do not inherit provider credentials.

Exact native context-menu Rename, prompt and archive swipe accessibility have
not yet been observed. The logging canary validated runner identity and native
secure-field input on the baseline app only. The scoped keychain and populated
legacy-state checks remain separate acceptance gates. Fresh-device legacy digests may be empty;
that result does not certify populated legacy queue recovery. iOS26.2 acceptance
would not certify the failed iOS27.1 migration or physical-device distribution.

## Proposed budget and invocation boundary

Existing app artifacts are reused; only the standalone UI runner is compiled.
Reserve 1 GiB external APFS DerivedData and 512 MiB internal runner/cache headroom
(conservative; the completed runner-only DerivedData measured 58,964 KiB), plus the observed ~1.24 GiB simulator data and variable swap.
Require >=6 GiB stable internal free, a two-GiB watchdog, one owned simulator,
20-minute bounded build/test phases, no concurrent heavy build. This is a
conservative reservation, not measured runner certification.

After explicit approval only, Root can review the controller's CLI help/source
and invoke it with the private Root-QA workspace and approval flag. Canary and
acceptance are separate invocations; no ready-to-run command containing private
paths or credentials is embedded here. Pure controller guard tests are safe and
perform no simulator, UI, build or keychain operation.

## Result and host-copy enforcement (review fixes)

A zero `xcodebuild` exit is not success. The controller invokes the installed
Apple `xcresulttool` 0.4.0 summary/tests/activities APIs and attachment exporter.
It requires exactly one passed test, zero skips/failures/expected failures, the
expected test case on the owned UUID, and a unique exported JSON completion
attachment bound to phase, nonce and device. A skipped setup/phase cannot produce
a canary approval receipt. The canary receipt binds hashes of the official JSON
exports and all exported attachment bytes/modes/link metadata; those exports,
not a raw-binary grep, are the mandatory private review materials.

Before a real fixture starts, the fixed pinned HFS host is copied (data only)
into a fresh `verified-proof9-host` under the private APFS run root. File bytes,
lengths, modes and link text are compared before/after copy; its pinned producer
verifier validates the copied manifest/inventory. Only that fixed private copy
is injected into the fixture template. No arbitrary host path is accepted.

A separate `--runner-build-only` mode calls only `build-for-testing` with generic
Simulator destination. It does not create/boot a device, run XCTest, install an
app, launch a host or create credentials. Root must give the serialized resource
go before invoking it. It requires >=3 GiB internal free and stops its own
captured subprocess group below 2 GiB. It uses private APFS DerivedData/TMP/module
caches and records the resulting XCTest executable. This build mode does not
substitute for explicit user approval of any later UI test.

Python optimized mode (`-O` / `PYTHONOPTIMIZE`) is unconditionally rejected at
module entry, so authority and result guards cannot be compiled out.

The first owned iOS26.2 canary stopped before XCTest at the post-install guard.
The installed baseline differed only in ten framework executable modes0755→0644;
all bytes matched and installed strict deep code-signature verification passed.
`INSTALL_FRAMEWORK_MODE_PATHS` records those exact ten observed paths. This policy
requires the pinned source inventory, regular identical bytes, FMWK metadata with
matching CFBundleExecutable, and the pinned arm64 MH_DYLIB format. Installed strict
deep signature verification remains mandatory. Every other mode, path, entry type,
missing/extra file and byte remains strict. This documents one observed install
transform, not a universal Apple behavior. The first attempt executed no XCTest;
the correction requires a separately authorized resource-scheduled retry.


## Observed result-export spelling

Xcode27 xcresulttool0.4.0 exported the completion name as
`blackcrab-phase-completion_<index>_<UUID>.json`. The parser accepts only that
anchored spelling or the original exact name. Exported basenames/canonical paths,
expected test and device, nonfailure association, exact phase/nonce/device JSON,
and a unique completion remain mandatory. Malformed names, wrong identity or
payload, and duplicate completions are rejected. Raw tool errors remain private.
The fixture records its controlled phase and bounded private error detail, so a
future prerequisite failure is diagnosed before another device run.

## Latest paired attempt

The baseline pairing UI passed one official test without skips or failures. The
controller then stopped before upgrade because it redundantly asked simctl to
terminate an app that Swift had already terminated. That redundant command is
removed. Upgrade, retained full-interface catalog, rename and archive remain
unverified. Framework interruption also bypassed the fixture's cleanup; the
controller now requests cooperative abort from the still-live owner first. A
real subprocess/socket regression verifies owner cleanup before interruption,
including when the resource low-water flag is set. Missing actual host closure
still fails acceptance and retains evidence.
