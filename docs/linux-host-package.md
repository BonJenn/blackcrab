# Native Linux host package integration

The Linux desktop needs the actual independent agent host and standalone issuer,
in addition to the Electron workspace. `managed-linux-host.yml` builds the existing
pinned service-profile producer on Ubuntu x64 and exercises that package under a
new disposable systemd user account. This is not a published installer.

## Package and helper

`scripts/build-linux-host-ci.mjs` uses Node26.12.1, pnpm12.14.0 and the existing
authenticated BonJenn/t3code source archive. It calls the unchanged host producer:
locked dependency installation, full server types, actual browser-channel tests,
web and SEA executable builds, native resource monitor, notices, service profile
and complete inventory. Its subprocess groups are captured and must settle before
success. No account credentials or production cloud configuration enter this build.

The native resource preparer now accepts Linux x64 desktop and service artifacts.
It checks the requested target, exact source/profile evidence, complete files and
tar roundtrip before selecting the manifest/archive hashes. Windows remains refused
at this boundary pending its native ownership/IPC integration.

The standalone helper is compiled with the selected host manifest pin. Linux
requires an ELF64 little-endian x86-64 executable; it does not invoke codesign or
notarization. The complete helper bytes are embedded in Root and bound by the
existing native issuer digest/owner protocol. Apple-silicon signing, standalone
notarization and the production Mac service artifact/freeze are unchanged.
Updater-signature verification and final installer acceptance remain separate.

## Real service acceptance

After building the actual archive and helper, CI compiles the Root test executable
with their fresh pins and runs
`managed_host::service_package_tests::actual_packaged_linux_service_lifecycle`.
`scripts/test-linux-service-manager.py --actual-host` refuses existing QA accounts,
creates its own account/home, starts that account's user manager and copies only
the test executable, public marker and pinned archive. The test:

- Extracts/verifies the real archive and explicitly initializes a fresh Service owner.
- Publishes the embedded issuer and starts the real host through the product's
  systemd install path.
- Authenticates native desktop attachment and requests a real short-lived pairing
  grant, without sending an agent prompt.
- Recreates the desktop supervisor and verifies the same runtime, environment ID
  and private browser capability remain authoritative.
- Checks stop, refusal of direct restart by attachment, explicit start and restart.
- Removes the owned unit while retaining configuration and a data fixture.

The controller checks that exactly one test passed with no ignored tests. A zero
test filter match cannot pass. It always stops/removes only its new OS account.
Local Mac runs compile but intentionally ignore this Linux acceptance test.

## Evidence and remaining delivery

PR306 merged at4ac132512eb65f39d46cfd88b6dfdba96db52c74 after eleven passing checks
on0e53afc5145d699df6525352215265f7f96f2d28. Actual native job132390531684 in
run43576064552 built3797 host files and passed the real service lifecycle test:
1 passed,0 failed,0 ignored. Captured producer groups settled; no provider prompt
was sent. The host manifest was
ab4c4154c5a5683e25a2b60994e899efc42d18e8bcbd80fb1f3bea151c635be7,
archive4414978755c367dc8a5ccdd3f94653c7878c5713504b8bdb1879b2eb8e957156,
helper1afede47f4e59d3305c9193821934b51d60b4ec7247a6b3abcecd07cbe72cbb7.
The next [installed workspace acceptance](linux-installed-workspace.md) builds
actual Debian/AppImage candidates and checks normal graphical launch/reopen.

Local native regression:181 passed,11 explicitly ignored artifact/native cases.
Focused resource/helper checks:18 passed,3 explicitly skipped actual-artifact cases.
The dedicated Linux job must provide actual runtime evidence; local fixture success
is not that evidence. CI retains build reports/logs, not user data or credentials.

Linux Electron window activation, complete launcher/installer acceptance and update
delivery remain next. Windows IPC/ACL/service integration is still unfinished.
0.4.4 remains unpublished until the coordinated three-platform installers are built
and verified. Do not substitute the historical root-only Linux/Windows packages.
