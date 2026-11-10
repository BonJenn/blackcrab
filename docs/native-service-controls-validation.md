# Native background service controls

The desktop workspace entry can inspect, install, start, stop, restart and uninstall a native-owned macOS background service. Fresh setup uses the native initialization command; existing direct workspaces are not converted. Uninstall removes only the verified service unit and preserves workspace data.

The native plan verifies the compiled host selection and native issuer binding before constructing the fixed launchd identity. Renderer requests supply only a closed action value. Unit ownership binds the program, payload manifest, native generation, environment and OS account home. Manager operations use bounded output/deadlines and retained child handles; no persisted PID is imported for control. Concurrent operations serialize. Uncertain same-boot native epochs prevent starting another issuer.

## Validation

- Production Release compilation and 36 focused native policy, manager IO, issuer/boot and identity tests passed. The generated ACL changed only by adding the new command; the frozen authored inputs were unchanged.
- Twelve frontend tests passed, including service controls, response validation and the existing workspace entry; TypeScript no-emit checking passed.
- Actual inactive macOS registration verified kernel metadata and zero host runs; normal and independent fallback cleanup passed with unchanged configuration and native epoch journal.
- Actual isolated launchd install, restart, stop, start and uninstall passed with the original packaged service launcher and native issuer. Native readiness authenticated on epochs 10, 11 and 12 (initial epoch 9); final epoch 12 retired. Configuration was unchanged. No provider turns were requested. Normal and independent fallback cleanup passed, with every captured build/test process group quiescent.

The existing-owner OS test used a fixed private QA service label instead of the production label; the control implementation was otherwise byte-equivalent apart from appended private test modules. Those modules and label are not shipped.

## Fresh native setup and external issuer

An unpublished integration of this controls change and resource-profile packaging (#234), tree `aaa9461b30d48eea0bb70525c9f99bcdadc9de8f`, passed a separate fresh-owner test. A non-libtest optimized native executable initialized a new private workspace from the verified service archive, installed and launched its own copied executable through the unchanged private issuer dispatcher, authenticated readiness and issued native desktop pairing grants on two starts across a restart. Final epoch 2 retired. The test preserved configuration, requested zero provider turns, removed its service registration/unit, and passed an independent native cleanup invocation. All captured build/runtime/cleanup groups were quiescent and every frozen source input remained unchanged.

The private harness adds only fixed QA orchestration and a distinct compiled QA service label; it does not replace the native initializer, control implementation, packaged host or private issuer dispatch. Binary SHA-256: `993be74a34174a982f73191df6b71558710592db547c4bc7f384222dac8fbf63`; host manifest: `866866e127f2b0b6562b325a01e010f288981303774c700901846bc3c79c0a64`; archive: `b6e68d378771b560910f9967736ad5db13387c26817016a19781b209ce11f445`. This supersedes the earlier libtest-only limitation for native setup/external dispatch, while remaining separate from signed packaged-app/UI acceptance.

Actual Root-button acceptance, full Electron service transport, Windows/Linux lifecycle support, and complete parity remain open. Resource-profile packaging remains a separate peer change.
