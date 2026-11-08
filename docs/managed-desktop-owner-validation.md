# Private native owner and host identity validation

This milestone adds a private Rust launcher/broker; no main-window launch command or UI entry is registered yet. Main-app adoption and native browser transport are separate remaining work. The launcher accepts only the pinned production package role and verifies its complete inventory, namespace, exact source patches, bounded framework/dependency links, native Mach-O executable and plist identity.

The owner creates the existing standard-client grant through the host, supplies only its one-time pairing credential over inherited FD3, and handles subsequent grant requests over inherited duplex FD4. It never sends the controller seed/bearer to the client. The broker checks the captured child, exact host environment/origin and owner generation around each mint. Ordinary expiry may renew; explicit client revocation is not bypassed. Detach closes only this client channel.

Managed-host patch 009 adds a public nonce challenge signed with the owner's existing private bootstrap secret. Origin, environment and protocol fields are authenticated before sending bootstrap credentials. Spoofed request Host/Origin cannot select the signed origin. This proves possession at verification time; it is not encrypted transport or continuous request binding.

Validation on darwin-arm64:

- 43 focused Rust tests passed; seven Node identity/contract checks passed. Fixtures compare Rust FD3/FD4 bytes and fixed delegation scopes with the canonical shared SDK contract. Two packaged-runtime cases are normally opt-in.
- A fresh managed runtime containing all nine patches built and passed full integrity verification: 3,736 files, 356,179,724 bytes; manifest SHA256 `afdbaf815be9d676657939f1235290de5765b81ac008f11f3836b7cb80a9041e`.
- The compiled endpoint returned the expected nonce/environment/configured-origin/version HMAC, rejected malformed nonces, and was unavailable without its bootstrap secret. A fixture consumer's failed-proof gate sent zero OAuth requests; valid proof permitted authentication. This JavaScript gate observation is distinct from the Rust consumer tests.
- The actual Rust `native_packaged_host_survives_launcher_exit_and_reconnects` test passed against that runtime. It launched its captured child, exited the launcher, reattached to the surviving environment, rejected wrong-secret and wrong-environment probes, and cleaned up only its captured fixture host. The host and its resource monitor were confirmed gone afterward. The run took 496 seconds while repeatedly checking the full artifact on the external HFS volume.
- Toolchain validation also passed from the npm-managed repository with the actual Node 26.12.1 and pnpm 12.14.0 executables. A separate regression checks that version probes run outside project package-manager hooks and remove only their own temporary directory.

No provider session or model turn was created. This does not certify a Rust-launched Electron client's complete workflow, OS integrations, publisher signing, mobile control or full parity.
