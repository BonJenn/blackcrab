# Identity-only native keychain QA producer — source integration

Source is integrated, but NO actual artifact build, compiler, codesign command, native app or keychain call has run. Full signed QA acceptance remains pending. Ordinary production and existing `qa:true` behavior remain separate and unchanged.

## Explicit build-only option

`buildManagedDesktop({...existingInputs, nativeKeychainQaNonce: '<16 lowercase hex>'})` is a distinct opt-in owner/developer API. It is mutually exclusive with old `qa:true` and is not exposed by existing CLI parsers, renderer, runtime selection or production adoption. Ordinary calls do not even load the QA recipe/helper; regression tests import/use the production artifact API with no QA files present.

The shared pipeline authenticates/applies the complete current production source chain first. The identity hook then checks the raw54-record registry pin and seven actual effective source predecessors. Only DesktopEnvironment base-name and descriptor namespace appId/name change before the original full compile. Bootstrap, managed storage authority, original DesktopAppIdentity, real ElectronSafeStorage layer and production main graph remain exact passthroughs. Current source is rechecked after compilation.

At the ordinary canonical package/plist stage, the hook authenticates both actual production metadata predecessors and changes only productName/package role plus bundle ID/name/displayName. Metadata changes precede ad-hoc codesign; helper bundle IDs use the same unique QA appId. No host, auth wire, scopes, CORS, scheme or logical profile change. All nine actual predecessor inputs and expected outputs are recorded, and the staged metadata/source output is rechecked before manifest evidence is written.

A new manifest kind `blackcrab-managed-desktop-native-keychain-qa` and exact unique namespace are emitted directly. This path never writes/publishes a production-kind manifest. A complete original-source graph plus identity records and before/after proof files are packaged; proof file set is exact. The final root manifest contains the actual complete inventory. Source data has no actual bearer/credential/token values.

## Shared verification boundaries

The original inventory/link/hash primitives moved unchanged to `artifact-data.mjs`, re-exported from `artifact.mjs`. The actual structural/provenance gates moved to private internal `artifact-structure.mjs`; ordinary `verifyArtifact` never passes a native-QA policy and rejects this new kind with either value of its existing allowQA option. Existing production/old-QA filesystem fixtures still pass their previous paths.

`verifyNativeKeychainQaArtifact(root,{nonce,expectedManifestSha256})` is distinct. It requires the explicit expected nonce and full manifest digest; expected identity/source/result records derive from the pinned recipe, never arbitrary artifact metadata. It shares actual inventory, link, required-file, original-source registry/payload, asset and role gates, then additionally validates all identity evidence, exact actual package bytes and build-identity provenance. It ALWAYS executes fixed `/usr/bin/codesign --verify --deep --strict` after structural verification. There is no injected signature callback, allowUnsigned option or fallback. The existing actual build signature/verification steps also remain unchanged and shared.

Internal `verifyArtifactStructure` is deliberately not exported from the public artifact API and is not full verification, signing or adoption authority. Source tests call it with unsigned disk fixtures to prove only structural gates. They NEVER invoke the successful full QA signature path and never substitute a fake signature verifier. A future positive complete QA result requires an actual built/signed artifact and separate Root approval.

No current Rust production verifier or launch path changed. The compiled-test-only exact policy design remains in `fork-integration/native-keychain-qa/RUST-TEST-ADAPTER.md`. Production native adoption must continue rejecting all such QA artifacts.

## Validation

Pinned Node26.12.1: 26 tests, 26 passed, zero failed/skipped. Log: `/tmp/blackcrab-native-keychain-producer-structure-tests.log`.

Coverage includes real filesystem seven-source/two-package phases, exact predecessor failures, changed-during-compile rejection, symlink ancestor refusal without outside writes, unchanged real storage source, actual shared unsigned structural success, identity/proof/registry/inventory/link tamper rejection, wrong nonce, extra proof files, actual production/old-QA structural behavior, production API rejection of new QA including attempted private-policy injection, and no unsigned/signature override API. Existing 11 recipe tests remain included. No Native or keychain result is claimed.
