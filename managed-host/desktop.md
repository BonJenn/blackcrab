# Managed desktop workspaces

Build a native package using [the runtime builder](README.md). In Blackcrab
Settings, use **Managed workspaces → Choose workspace runtime** and select the
package directory containing `blackcrab-managed-host.json`. **Open workspace**
opens the packaged client in a separate native window.

The main window verifies the package before starting or attaching. The service
binds `127.0.0.1` and keeps running after its window or Blackcrab closes. A later
open reconnects to its existing environment. Closing a window does not interrupt
agents. This launcher does not install a login or system service; machine restart
requires opening the workspace again.

Managed state lives under Blackcrab's app data directory at `managed-host/v1/`:
private launcher configuration and logs, plus the host's own `host/` data root.
Legacy execution journals, Claude/Codex panes, provider session identities and
existing phone pairings are not imported or resumed. Managed workspaces create
their own host-owned threads. Runtime replacement is rejected while a managed
host is responding; changed packages require explicit verification while stopped.

The launcher serializes configuration/start attempts across app processes. The
host also retains its upstream data-directory ownership lock. Runtime records
are discovery hints: a loopback descriptor, exact server/protocol compatibility,
stable environment identity and authenticated session must succeed before
attachment. Neither stale PIDs nor failed authentication cause process killing
or automatic restart loops. A slow or conflicting host returns an error for
explicit retry. Output is redirected to private durable files, independent of
launcher pipes. Only each launcher's captured child is reaped.

Bootstrap secrets are stored in private native configuration and sent over a
one-time input pipe. Rotating HMAC tokens reach the web client in the URL
fragment, which the client exchanges for an HttpOnly session cookie and removes.
The frontend entry receives status only, never tokens or origins. The managed
window may navigate only within the current verified host origin. On macOS it
receives a narrowly scoped native capability for folder selection and HTTP(S)
external links. It cannot invoke the main window's managed commands or general
file/dialog plugins. No partial Electron desktop bridge is injected.

This first attachment uses the packaged web client in a Tauri window. It does not
certify native desktop bridge features, full remote native iOS workflows, actual
provider turns, legacy session migration, fork-owned cloud/update infrastructure,
release signing, or native Windows/Linux lifecycle behavior. Those remain parity
gates in [the delivery plan](../docs/t3-parity-plan.md).

Focused native fixture (uses disposable data and no model calls):

```sh
BLACKCRAB_MANAGED_ARTIFACT=/path/to/native-package \
  cargo test --locked --manifest-path src-tauri/Cargo.toml \
  managed_host::tests::native_packaged_host_survives_launcher_exit_and_reconnects \
  -- --ignored --exact --nocapture
```

The parent fixture captures the actual launched child PID from its own launcher,
checks authenticated reconnection after that launcher exits, and stops only its
owned process group. It does not use PID records as authority to stop a user host.

## Recorded validation

On 2026-11-07, all 173 desktop tests and 145 native tests passed (three native
fixtures ignored by default). The required repository smoke, native check and
production build passed. The explicit macOS arm64 packaged-runtime fixture also
passed: its launcher exited, later supervisor instances authenticated to the
same environment, incorrect credentials and changed identities were rejected,
and the owned host was stopped afterward. No provider model was called.

The Rust verifier passed against the relocated 3,727-file package with manifest
SHA-256 `0f695b3d9ac0e6e0b7ed3ed0195056de232f396c9db95e94f10a2439dcf6a63b`.
Unit fixtures additionally cover payload mutation/relocation, metadata rejection,
launcher lease waiting, unmarked data and linked paths, private configuration,
windowed HMAC derivation, HTTP backend construction and startup-only 503 retry.

The isolated native QA bundle opened the managed window, which displayed its
connected local environment and stripped the token fragment. Closing that window
returned to Blackcrab with the service still running. After quitting the QA app,
the captured host remained alive under PID 1; its runtime PID and environment ID
matched, and a fresh native-secret-derived exchange authenticated successfully.
The QA app's relaunch process ran, but automation could not expose a window
(timeouts/noWindowsAvailable), so GUI relaunch is not certified. The captured
QA app and host were stopped afterward. No user session was opened or resumed.

## Native folder and link integration

The packaged web client uses a separate, immutable `window.blackcrabNative`
version-1 interface. Its two methods implement the existing LocalApi folder and
external-link contracts. Browser and Electron behavior remain covered by source
adapter tests. Native errors propagate without falling through to another opener.
The Command Palette exposes native folder browsing only for the primary local
environment; selecting a remote environment never opens this computer's picker.

A grant binds an authenticated live environment, exact loopback origin/port, and
random generation to a unique native window label. Host replacement retires the
previous grant. Each invocation revalidates the live host, and folder selection
revalidates after the dialog returns. Folder hints must be bounded absolute paths;
external links accept bounded HTTP(S) URLs without credentials or control
characters. Windows and Linux do not receive this interface pending native
provenance and lifecycle verification.

Capabilities deliberately contain no numeric command scopes: Tauri 2.11.1's
runtime capability installation can reuse scope IDs. Unique window labels prevent
older grants from authorizing a newly created managed window. macOS fetch IPC
uses the browser-supplied Origin; fallback WKScriptMessage IPC uses the invoking
frame's request URL. Cross-origin iframe rejection was tested on both transports,
including an origin with a stale capability for a different window label.
Same-URL sandboxed opaque-origin frame behavior remains unverified.

The explicit `managed-bridge-qa` Cargo feature supplies disposable native fixtures
and reports. It requires a QA bundle identifier; production builds exclude these
fixtures, navigation exceptions, invoke-key access and process reports. Captured
child process identity, rather than a runtime PID record, controls fixture cleanup.
No provider request is needed for these checks.

The rebuilt arm64 package contains 3,729 payload files / 355,973,950 bytes and
manifest SHA-256
`0bcf99ef96fb7e0713d9503d8b917119c359e651fe010efc889ac9c79c3192d6`.
Its three registered patches preserve exact pinned before/after/diff hashes.
Native integration does not certify the remaining Electron facilities or full
scenario parity. Folder-dialog interaction and final production smoke evidence
will be recorded with this increment's validation results.
