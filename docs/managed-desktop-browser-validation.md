# Native browser and bundled desktop integration

This increment adds production browser attachment and a bundled full-desktop entry. It does not certify whole-desktop or remote iOS parity. Native browser acceptance and actual main-app packaged launch must be recorded separately from source tests and artifact verification.

## Browser ownership

An optional private FD3 descriptor carries the reviewed `leased-uds-v2` browser capability. The baseline descriptor and credential-only FD4 exchange retain their existing shapes when the capability is absent. The host listens on an owned private Unix socket; the native desktop connects without taking ownership of the host process. Independent handshake nonces, directional frame authentication, sequence checks and environment/generation/peer fences prevent stale browser work from crossing connections. Pending connections, frames and active command fibers are bounded. Retiring a connection cancels its outstanding work; uncertain commands are not replayed.

The original browser Manager, CDP services and schemas remain in use. Ten reviewed host source records install the transport and preserve the original attachment deadline/headless policy. Public environment/configuration/diagnostic projections do not expose the private socket path or key. The own pairing scheme and provider-auth return URL patches apply in both producer recipes; immutable mobile SDK consumers are unchanged.

## Bundled main-app entry

The main window offers **Open full desktop** and status refresh. Its native commands take no renderer-supplied paths, digests, credentials or process IDs. Compile-time manifest/archive pins and fixed bundle resource names determine authority. Existing selected managed hosts remain authoritative; a bundled host is a lazy default only when no stored selection exists. Desktop-only bundles can use an existing host, and host-only bundles do not claim to contain the desktop app.

The build wrapper accepts verified `--managed-desktop` and/or `--managed-host` packages. Opaque archive resources preserve the framework symlinks that Tauri directory-resource copying otherwise loses. Extraction verifies the archive bytes and complete original producer manifest before atomic adoption into a private marked cache. It refuses unsafe archive entries, unexpected modes/links, unmarked caches and tampered existing payloads. Initialization and extraction use bounded exclusive leases. The wrapper retains its owned temporary archive staging until the Tauri child has exited.

## Evidence and remaining gates

The real production C desktop package passed strict ad-hoc signature and independent inventory verification: 3,316 entries, 585,644,062 bytes, 40 symlinks; manifest SHA256 `b7e3a5f37a383ad803803e7881257e6546a9d559a1d42d5e00076ad315d9b891`. This is local artifact consistency, not release signing or notarization.

The native source baseline passed 63 focused managed tests with two opt-in packaged-runtime cases intentionally ignored. After review, the extraction harness passed 14 tests, including concurrent first constructors and bounded lease expiry. The final post-review Root suite, real archive roundtrip, native browser reconnect/navigation/CDP/frame acceptance, main-app bundled launch and required CI are still being completed. A direct inherited-FD fixture is distinct from a Rust-owned main-app launch; neither substitutes for the other. Provider turns, actual remote endpoint operation, updates and signed distribution remain open parity gates.
