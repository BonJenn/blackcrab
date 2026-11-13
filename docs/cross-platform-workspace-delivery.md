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
