# Captured native desktop lifecycle validation

The isolated macOS arm64 Rust entry/owner lifecycle passed using the exact
reviewed non-adoptable QA archive. The source-defined sealed permit binds its
archive, full manifest, identity proof and original patch registry. Production
verification cannot adopt this QA identity; environment variables and renderer
arguments cannot select alternative pins.

The reduced candidate compiled and passed its production check with all 52
inputs stable, including four generated Tauri schemas. All 74 focused Rust tests
and six source-contract tests passed. The real lifecycle authenticated through
the original auth-access contract, reused the captured window, quit normally,
retained the host, reopened, authenticated again and quit normally again. Its
controller exited zero and captured-host cleanup completed with no error. No
provider/model commands were sent. Bounded evidence is in
`managed-desktop/native-lifecycle-acceptance.json`; raw logs remain private.

AppKit documents launchDate as unavailable for direct launches outside
LaunchServices. The normal-quit helper corroborates it when present and always
requires the retained live Child, complete current kernel birth identity, exact
bundle path and fixed verified bundle ID. No persisted PID authorizes control.
QA-only match arms are ARM64 guarded so Intel macOS test compilation retains its
production-only identity. Intel runtime validation remains open.

An earlier candidate run timed out while a full protected-store audit was active.
No source or timeout change followed. The fresh isolated-volume run after that
bulk I/O completed passed. Cold-launch reliability under heavy concurrent I/O is
not certified. The real visible main-window button, full renderer interactions,
other platforms and complete desktop parity remain separate acceptance gates.
