# Native background service controls

The desktop workspace entry can inspect, install, start, stop, restart and uninstall a native-owned macOS background service. Fresh setup uses the native initialization command; existing direct workspaces are not converted. Uninstall removes only the verified service unit and preserves workspace data.

The native plan verifies the compiled host selection and native issuer binding before constructing the fixed launchd identity. Renderer requests supply only a closed action value. Unit ownership binds the program, payload manifest, native generation, environment and OS account home. Manager operations use bounded output/deadlines and retained child handles; no persisted PID is imported for control. Concurrent operations serialize. Uncertain same-boot native epochs prevent starting another issuer.

## Validation

- Production Release compilation and 36 focused native policy, manager IO, issuer/boot and identity tests passed. The generated ACL changed only by adding the new command; the frozen authored inputs were unchanged.
- Twelve frontend tests passed, including service controls, response validation and the existing workspace entry; TypeScript no-emit checking passed.
- Actual inactive macOS registration verified kernel metadata and zero host runs; normal and independent fallback cleanup passed with unchanged configuration and native epoch journal.
- Actual isolated launchd install, restart, stop, start and uninstall passed with the original packaged service launcher and native issuer. Native readiness authenticated on epochs 10, 11 and 12 (initial epoch 9); final epoch 12 retired. Configuration was unchanged. No provider turns were requested. Normal and independent fallback cleanup passed, with every captured build/test process group quiescent.

The real OS test used a fixed private QA service label instead of the production label; the control implementation was otherwise byte-equivalent apart from appended private test modules. Those modules and label are not shipped. The existing private fixture was already initialized by the native issuer. This does not establish production fresh-setup external dispatch, actual Root-button acceptance, full Electron service transport, Windows/Linux lifecycle support, or complete parity. Resource-profile packaging is a separate peer change.
