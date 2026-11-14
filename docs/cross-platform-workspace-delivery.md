# Windows and Linux full-workspace delivery

Owner request, 2026-11-13: fix Mac permission branding, then make Windows and Linux
versions ready. Initial architectures are Windows x64 and Linux x64. The website's
existing 0.3.0 downloads are historical and do not satisfy this request.

## Current implementation barriers

- managed-desktop/build.mjs certifies only darwin-arm64 and packages Electron.app
  with PlistBuddy/codesign. Platform-specific official Electron inputs, layouts,
  native dependencies and notices need pinned producer support.
- src-tauri/src/managed_desktop.rs binds the Mac bundle executable and resources.
  Manifest verification, launch and native activation need target-specific paths.
- managed-desktop/descriptor.mjs explicitly rejects Windows native browser Unix
  transport. Implement authenticated equivalent transport, not an unconditional
  platform bypass or silently missing browser features.
- managed_service_control.rs implements launchd. Linux needs scoped user-service
  lifecycle; Windows needs a native per-user service/startup lifecycle with the
  same single-owner/attachment guarantees and controlled upgrades.
- The service producer/controller's platform assumptions and standalone native
  issuer require native runner builds. Cross-platform Rust CI alone is not proof
  that Electron, provider terminals, file pickers or the owned service work.
- .github/workflows/release.yml is the reviewed signed Mac delivery process.
  Add platform-specific packaging, integrity checks and update metadata before
  changing the Windows/Linux website download targets.

## Delivery order

1. Introduce explicit target descriptors and pinned Electron/runtime inventories.
2. Validate source/artifact handling and native launch on Windows/Linux runners.
3. Implement service ownership/transport and provider/native dependency support.
4. Exercise full workspace launch, old-data retention, reopen, independent service
   survival, terminal/browser/file dialogs and updates on each target OS.
5. Produce installers and updater metadata, then update website/release notes to
   verified public assets. Do not call an unsigned local package a signed release.

Keep the Mac follow-up (permissions, imported notifications and pane controls)
separate from platform readiness. Preserve public 0.4.2 and existing user data.

## Runtime input foundation — 2026-11-13

`managed-desktop/targets.mjs` now defines exact darwin-arm64, win32-x64 and
linux-x64 runtime inputs, Rust targets and package layouts. Hashes were read from
Electron's official 44.10.1 SHASUMS256.txt (document digest 908e7b63…). The Windows
and Linux ZIP downloads matched those hashes. Their actual electron.exe PE/x64
and electron ELF/x64 headers passed inspection without execution; the existing
Mac archive and Mach-O/arm64 executable passed the same input checks.

The Mac producer consumes the descriptor and verifies the extracted native header.
Its existing serialized Electron manifest fields are unchanged. Windows/Linux
remain explicitly rejected as unimplemented producers; declaring a pinned input
does not certify a bundle or enable Root launch. Next implement native extraction,
layout, dependency closure and manifests, then the service/transport steps above.
Do not set producerImplemented merely to bypass the native implementation gate.

Local evidence (may be absent elsewhere): REL/cross-platform-target-inputs contains
the official checksum document, download-verification.json, target-validation.json
and focused/full Node regression logs (97 tests passed with zero skips). The first
full run found a missing production-module fixture dependency; adding targets.mjs
to that isolated fixture preserved its no-QA-dependency check. No Windows/Linux
executable was launched,
installer produced, service installed or platform download changed.

## Runtime staging and native runner checks

`managed-desktop/runtime-package.mjs` stages the authenticated runtime into an
empty owned directory, keeps the platform's resources and notices, and renames
the executable to the descriptor's Blackcrab path. It supports the Mac bundle
and the flat Windows/Linux layouts. The Mac producer now uses this same step;
its bundle identity, payload construction, signature and manifest checks remain.
Occupied destinations, directory links and mismatched archive hashes are rejected
before extraction. The official pinned archives for all three targets passed
real extraction, native-header, layout and notice checks on the build Mac.

The `managed runtime` workflow executes the renamed, pinned Electron binary on
Windows x64 and Linux x64 in Node mode with a fresh private profile. It checks the
observed runtime version/architecture and cleanup. This is native runtime input
evidence only: no workspace, provider, browser bridge or service is started. Read
the actual workflow results before claiming either native execution passed.

Windows/Linux producers remain disabled. Next implement their application metadata,
native dependency closure and complete artifact manifests, then Root launch,
authenticated channels, independent service lifecycle and installers. The new
staging helper does not relax those release gates or change public downloads.

## Platform-bound artifact verification — 0.4.4 preparation

PR294 merged after all 11 checks passed, including real Windows x64 and Linux x64
Electron 44.10.1 / Node 24.22.1 execution with notices and cleanup. That is runtime
acceptance only; the workspace/service/installers are still unfinished.

The portable artifact format is version 2 and binds an explicit `target` to the
pinned runtime, executable layout, application entry point and build provenance.
Callers must supply `expectedTarget`; the default verifier remains Mac format 1.
Mac format, Electron fields and inventory serialization are preserved. Mac-only QA
identities and policies are rejected for portable targets. Native launch/adoption
and release support are not enabled by adding structural verification.

Windows inventory omits POSIX execute bits, which cannot round-trip across NTFS
and Unix. It rejects links, case/normalization aliases, reserved device names and
paths that Windows would reinterpret. Linux retains executable bits and requires
its actual entry point to be executable. Both targets verify every file digest,
reviewed source patch, branding asset, boot entry and required license/notice file.
The full Windows dependency closure must therefore be materialized without links;
using absolute junctions to a build machine is not a distributable package.

Native CI constructs and verifies a complete inventory around the real runtime
with an explicitly synthetic application payload, then loads that payload in
Electron Node mode. It never starts a real workspace or service. Do not report
this fixture as full UI/remote/provider acceptance or publish it as an installer.
Next complete dependency closure and platform metadata, then native Root launch,
authenticated transport, independent service lifecycle and verified installers.

## Physical dependencies

Portable staging now copies package contents and dependency subtrees without links.
It preserves nested versions and compatible ancestor cycles using Node's resolution
rules, rejects escaping content links and missing required native companions, and
records optional platform exclusions and attribution roots. Native CI installs the
pinned frozen source graph and loads actual native addon packages under Electron.
This does not yet exercise user credentials, accessibility operations or the full
workspace. Complete app metadata, owner transport, services and installers next.

## Native package identity

PR296 merged to stage 4be37291ec5038831555f04a3104eb88272e5cac after 11 checks passed.
Windows and Linux loaded the physical keyring/accessibility/FFI/passkey/Playwright
closure in actual Electron 44.10.1 / Node 24.22.1, verified complete inventories and
cleaned up. The payload is still synthetic; that does not certify the workspace.

portable-metadata.mjs now provides Windows product/file versions, all localized
product-name tables and icon groups, plus an owned Linux icon and desktop-entry
template for the outer blackcrab launcher. It uses resedit 1.7.2 from the existing
frozen upstream graph. Windows rewriting preserves code/data bytes and addresses,
loader references and unrelated resources. A larger resource section may move the
following relocation table; its directory offset and bytes remain verified. See
[Microsoft's PE specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format#the-reloc-section-image-only).
Edited Windows executables are unsigned; Authenticode and signed updater evidence
are separate release concerns. Linux metadata does not install desktop shortcuts.

Native CI checks Windows VersionInfo through the OS, validates Linux's desktop
entry with desktop-file-validate and launches the edited native runtime. Read final
CI results before claiming acceptance. Producer orchestration, Root transport,
services and installers remain next. Mac production packaging stays unchanged.


## Actual workspace producer candidate

PR298 native runtime/metadata checks passed and merged at426c9af8d1885152ca1fd5afcee6a8b1bb4aa92d.
The next candidate extends the shared build recipe to native Windows/Linux with an
explicit buildOnlyTarget. It builds real source and verifies complete target-aware
artifacts; managed-desktop-build CI must pass before treating compilation as done.
Default production targets remain disabled while Root launch/transport and service
lifecycle are unfinished. Candidate build success is not installer delivery.


## Native verifier integration

PR299's actual Windows/Linux compiled artifacts passed complete JS verification;
merged c1763cda63e8b2dec9c6d433d7849a5d9a632f9d. The next change makes Root's native
package verifier understand format2 and native layouts, with ELF/PE architecture,
complete inventory/provenance and Windows path/handle checks. The native CI builds
real artifacts and runs the actual crate verifier against their exact manifest pins.
This still does not enable launch/service/installer delivery. Preserve Mac format1.

## Unix launcher and activation channel

PR302 merged with12 checks, including the actual native Rust verifier reading full
Windows/Linux built artifacts. The next branch shares the POSIX launcher and private
FD3 bootstrap, FD4 renewal and FD5 update channels. Linux adds FD6 lifecycle requests;
its owned Electron window service reports readiness only for a visible, loaded
blackcrab://app main window. Root retains recovery until that reply and then tracks
normal exit/crash. Reopen reuses the captured client; updates close only that client.
Mac retains AppKit. No renderer path/PID/command authority or provider run is added.

The local actual native suite passes173 tests (10 explicitly ignored fixtures),
JS desktop/QA/resource suite148 (3 ignored real-artifact fixtures), shared contracts6,
and full fresh-source desktop Effect types/bundle. The channel tests use captured
Rust/Node children; they are not Linux GUI or end-to-end service acceptance. A real
Darwin close race was reproduced: setting a read timeout after peer close can return
EINVAL while reply bytes remain buffered. Absolute-deadline poll/read preserves the
valid reply without extending timeout or accepting a stale response.

Linux Root entry now understands the package and launch path. Independent Linux
user-service setup/controls still need implementation, then Windows private native
transport and service lifecycle, native acceptance and distributable installers.
Do not enable build-only producers or publish from these protocol checks alone.
