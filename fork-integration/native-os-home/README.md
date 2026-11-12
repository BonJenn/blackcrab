# Native OS HOME and managed environment

The production integration lives in `src-tauri/src/managed_desktop_home.rs` and the four desktop-only records at the end of `managed-desktop/patches/registry.json`. This directory contains the exact patch capsule, fixture bases and upstream notice needed by the light regression tests. The service producer/shared registry is unchanged.

The Native viewer obtains HOME from the current real/effective UID's account record, ignoring inherited HOME and renderer inputs. The backend HOME is unchanged. Mandatory descriptor-owned appData, userData/sessionData, temp, crash reports and logs remain private. Real Electron secure storage and browser/SSH implementations are retained.

The early bootstrap clears foreign configuration. After login-shell capture or cache replay, the policy removes already-present `GITHUB_APP_CLIENT_ID` and `T3CODE_`/`VITE_`/`OTEL_` values before restoring owned authority and applying the original shell patch. Legitimate PATH, SSH agent, CA and provider settings remain available.

Run `node --test managed-desktop/source.test.mjs fork-integration/native-os-home/environment.test.mjs`. Tests apply actual preflight records in disposable directories and execute the patched publication generator with the original shared shell applicator. Rust account-home tests additionally require a scoped native compile; the poisoned-HOME subprocess must report exactly one executed/passed test.

No mock keychain, secure-storage denial or plaintext fallback ships here. Native real-keychain acceptance requires a separately reviewed isolated QA identity. New client outputs use the existing full-file/source-record manifest digest as revision identity; server compatibility remains 0.1.7. Existing b7 artifacts and their archived verifier/pins are preserved.

Reproduced upstream source in `base/` and the shell delta retain `LICENSE.upstream` (MIT). New Blackcrab code follows the repository Apache-2.0 license.
