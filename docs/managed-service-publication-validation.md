# Native profile4 transaction publisher

Implemented candidate native core in managed_service_install.rs, registered as a module only. No Root command, public serialized receipt, OS service unit, activation, host stop/restart, exposure change, updater/feed or browser/mobile input was added. No real profile4 artifact exists/was installed in this proof.

Selection takes the existing opaque EmbeddedPayload supplied by trusted native compiled selection. It requires Host role, preserves the exact original expected manifest anchor across ensure_verified and the independent original Host verifier, then requires all five exact merged216 boot-service record IDs/hashes. Generic artifact integrity or a caller-provided JSON hash cannot mint this private-field Rust selection. C21/profile3-only artifacts fail before installation directories. The existing verifier still hard-pins the actual selected runtime version0.1.7/current OS+architecture; no alternate release/feed/target was invented. An explicit picker authority adapter is not provided by this API.

prepare retains a bounded cross-process native-owned install lease under the existing canonical private Blackcrab owner root/marker, copies only regular non-hardlinked files/directories into fresh owned staging, preserves every payload file/directory mode after safe construction, and verifies the complete unchanged payload. Wrapper/staging remains private; completion/profile metadata are never put inside payload. Source aliases/special files and changed bytes fail closed.

validate_version executes only the captured staged entry with exact --version argument, private staging HOME/TMP/CWD, cleared inherited environment, original30s deadline/exit+stdout version semantics and bounded64KiB stdout/stderr. Timeout/output failure kills/reaps only that actual captured child, never a persisted PID. After validation the complete original verifier/profile/anchor checks run again. No global current directory/environment is mutated.

commit requires successful validation, verifies again immediately prepublication, writes/fsyncs0600 external layout/sentinel metadata in the private wrapper, fsyncs the tree, then atomically publishes without replacement and fsyncs the versions parent. An existing/racing version is never replaced, including same-version/different-digest. If post-publication sync fails, the target remains intact and the transaction cannot retry or remove it; a subsequent prepare refuses that version. Dropping/failing an unpublished transaction cleans only its own staging.

Metadata contract is exact216: host/runtime/versions/<actual-version>/payload/t3, .install-complete, and .blackcrab-service-layout.json {schema:1,profile:"blackcrab-local-service-layout-v1",protocol:4,version,manifestSha256}. The native private binding to LocalInstaller.ts is still an integration step: its original Effect validation must remain; native validation cannot be replaced by an unauthenticated boolean acknowledgement. No private bootstrap reader, service manager, activation or updater capability is wired here.

## Changed paths

- New src-tauri/src/managed_service_install.rs (implementation and focused tests).
- One approved mod registration in lib.rs.
- Approved managed_payload native-only getter + pub(super) access to five existing filesystem helpers, with no filesystem helper behavior changes.

No Cargo/dependency changes in this task. native-publisher-owned.patch records only these changes by removing the precisely owned registration/getter/visibility deltas from live shared-file bytes; it does not claim other parent changes. owned-paths.txt/.nul and source-freeze.json provide selective staging inputs and SHA records.

## Actual validation

Real cached Root Cargo tests, not a stub harness: offline,jobs1,DEV/TEST DEBUG0, owned APFS TMP, focused managed_service_install::tests. Final12/12 pass in22.05s after2m01s build. Tests cover actual opaque selection, wrong role/compiled digest/C21-only profile refusal, source/owner tampering, payload directory modes, original version output boundaries, validation ordering/failure cleanup, no validation/no commit, existing/racing version preservation and injected uncertain postpublication fsync.

All publication tests use explicitly synthetic profile4 manifests and owned harmless --version shell fixtures. They prove native transaction behavior, not a production profile4 host or installed service. No manager/network/model turn occurred.

The live-captured compile watchdog recorded minimum internal free5,098,057,728 bytes (~4.75GiB), above the2GiB mobile floor; no stop signals were needed. focused-test-run.json and focused-root-tests.log retain the exact invocation/result. A cached rust-objcopy/libLLVM stripping warning remained in Cargo build-script output; no Rust/test failure resulted. The existing NativeDesktopOwner.detach unused warning remains. Compile slot is released; no further build is running.
