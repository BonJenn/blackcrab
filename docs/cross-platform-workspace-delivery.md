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
