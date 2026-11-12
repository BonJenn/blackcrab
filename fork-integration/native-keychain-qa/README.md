# Native keychain QA identity candidate

SOURCE ONLY. The distinct build-only producer option and shared strict verifier are now integrated in managed-desktop/; no CLI, Rust registration, native build, app launch or keychain call has been performed. `recipe.mjs` reads pinned fixtures and returns in-memory bytes; it never writes producer source or publishes an artifact. Production defaults and runtime selection remain unchanged.

The identity is fixed per artifact/profile: 16 lowercase hexadecimal nonce characters plus the original app version and original stage resolver. The actual pinned `updateChannels.ts` predicate and `DesktopEnvironment.ts` resolver are stripped of TypeScript and evaluated in an isolated pure VM, without importing Electron or Effect. No Rust/JavaScript clone of version/channel precedence is introduced.

For sample nonce `44a10b1c0fee1234`, version0.1.7:

- App name/account: `Blackcrab Native QA 44a10b1c0fee1234 Beta`.
- Service: `Blackcrab Native QA 44a10b1c0fee1234 Beta Safe Storage`.
- Bundle/app ID: `com.blackcrab.desktop.managed.nativekeychainqa.n44a10b1c0fee1234`.
- Nonadoptable kind: `blackcrab-managed-desktop-native-keychain-qa`.
- Renderer scheme stays `blackcrab`; logical profile stays `blackcrab-managed-v1`. A fresh private QA root supplies actual filesystem isolation. No host CORS, auth scope, FD schema or production profile migration is changed.

`registry.json` pins nine effective-production inputs, including full current production graph hash and the original stage predicate. `sample-records.json` contains concrete before/after SHA256 for every target, with reviewable byte outputs in `fixtures/sample-after/`.

Only four inputs change: DesktopEnvironment's base-name constant, descriptor namespace's appId/name, packaged package.json productName/role, and Info.plist identifier/name/displayName. Package name remains unchanged because explicit productName wins Electron's initial name selection. Bootstrap, managed environment/storage authority, DesktopAppIdentity, ElectronSafeStorage and the real main service graph remain byte-identical. Effective Bootstrap delegates to configureManagedEnvironment, whose preserved app.name=NAMESPACE.name sees the unique QA namespace. Later original identity configure derives the same base+stage name. This covers early/fallback and later names without setter shims.

The old generic QA policy is deliberately absent: no ManagedQA.layerSafe, mock keychain, plaintext encryption or safeStorage replacement. `assertIdentityConsistency` compares every emitted byte and every identity/provenance field with deterministic expected output and rejects mixed names or extra targets. `assertProductionRegistry` refuses any unreviewed complete graph change.

The full-registry check initially caught a legitimate concurrent production update. `production-predecessor-update.json` proves that reverting only native-os-home-environment-mjs's sha256/afterSha256 to its prior payload reconstructs the exact old whole-registry SHA. Only that unchanged-logic predecessor fixture was rebased; the recipe does not undo its production directory-normalization fix.

Tests: pinned Node26.12.1, `node --test fork-integration/native-keychain-qa/recipe.test.mjs`. Eleven cases cover original channel behavior, fixed/disjoint identity, exact before/result bytes, real-storage preservation, malformed/overridden policy refusal, missing/tampered inputs, inconsistent names, forged provenance, unchanged descriptor auth body, full production graph changes, and **actual existing Node production verifier rejection**, with and without its old allowQA option. Rust is a design-only seam below; no native-verifier test or keychain isolation result is claimed.

See `PRODUCER-HOOK.md`, `RUST-TEST-ADAPTER.md` and managed-desktop/native-keychain-qa.md before any actual build. A fresh QA profile must never import production catalog/Clerk/Local State/browser credential data. This identity separates this safeStorage service/account pair; it does not assert isolation of every unrelated OS credential API.
