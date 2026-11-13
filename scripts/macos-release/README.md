# Managed Apple-silicon release

This path packages the original Tauri shell, the full Electron workspace and the
background-service host for an M-series Mac. It preserves the existing
`com.bonjenn.blackcrab` identity and updater public key. It is not an Intel build.

For v0.4.0, the owner explicitly requested publication and will perform the
manual Mac UI and upgrade tests afterward. Use a source-bound record with
`state: "OWNER_TESTING_AUTHORIZED"`, `tag: "v0.4.0"`, the exact owner instruction
exported as `ownerTestingAuthorization`, and `deferredChecks: lifecycleChecks`.
Do not add a `checks` object or claim these tests passed. The corrective 0.4.1
follow-up for the owner's reported startup failure uses the same deferred manual
test workflow, but additionally requires `followUpOf: "v0.4.0"` and
`followUpSourceRevision: "caf57b6fab1b4391836c6635882a15a88edfac0d"`. Bind it to
the exact new source and `tag: "v0.4.1"`; later versions are not allowed by this
exception. Signatures, notarization, payload and updater verification remain
required. Website downloads, release notes and the blog are also authorized.

A corrected installer can be built privately before its native lifecycle is
accepted. Use `state: "DRAFT_VALIDATION_PENDING"`, schema 1, the exact source,
matching tag, and `deferredChecks: lifecycleChecks`; do not include passing checks.
Pass `--draft-build` to pack/unpack. The workflow independently verifies the target
release is still a draft before enabling this option, and always leaves its output
a draft. This is a build permission only: the normal `validateAcceptance` call
without `draftBuild` rejects pending evidence. Verify the final packaged app and
record actual lifecycle acceptance for that source before public publication.
This does not extend the older release-specific owner-testing exception.

1. Normally complete native lifecycle acceptance for the reviewed source. Record schema 1,
   `state: "PASSED"`, its exact `sourceRevision`, and true checks for `firstLaunch`,
   `enableService`, `openAndReuseDesktop`, `quitPreservesHost`,
   `reopenPreservesIdentityAndCatalog`, `restartReconnects`,
   `stopStartReconnects`, and `cleanup`. Keep the underlying UI/controller proof.
   A running process or an uncapturable window does not pass these checks.
2. Merge validated integration into stage. Commit the intended new version in
   package.json/lock, Cargo.toml/lock and tauri.conf.json. Use a stable version newer
   than the latest release; do not overwrite v0.3.0. Verify acceptance against the
   final source, including any changes made after the original QA run.
3. From verified production artifacts, run `sign-payloads.mjs`, then
   `notarize-payloads.mjs`. Both preserve their inputs and emit separate output.
   The latter needs an owner-only App Store Connect key file. Check Apple's
   notarization log for all submitted binaries and any warnings.
4. In a clean checkout of the accepted stage revision, set the public signing
   identity/team and run `release-inputs.mjs --mode pack --desktop <notarized-desktop>
   --service-host <notarized-service-host> --acceptance <native-acceptance.json>
   --output <outside-checkout>/blackcrab-managed-payloads.zip --tag v<version>`.
   This refuses absent/stale acceptance or owner authorization and non-notarized payloads. Retain
   its SHA-256. Create a **draft** release targeting that exact commit, and upload
   the archive under this fixed name.
5. Dispatch the existing `release.yml` at the same stage revision, with
   `kind=managed-apple-silicon`, the new tag and `payload_sha256`. It verifies the
   downloaded input, builds `aarch64-apple-darwin`, and uses the existing GitHub
   Apple/updater credentials in their intended jobs. Tauri signs/notarizes the
   outer app and signs its updater archive; the final step notarizes/staples the
   DMG. The managed wrapper prefers the same explicit API key used by the preflight
   and DMG step, removing Apple ID/password from its child environment. Tauri
   otherwise gives those credentials priority even when they are empty strings.
   Complete Apple ID-only authentication remains supported. The release remains
   a draft. Tag creation no longer triggers the old
   root-only recipe. `legacy-root-only` is available explicitly for that recipe.
6. Inspect the final app and DMG signatures, stapled tickets and actual embedded
   archive hashes; extract the updater archive and verify the same payloads.
   Validate the updater signature against the existing public key. Test normal
   installation and update from the old app with retained settings/catalog,
   service restart and remote reconnect. For v0.4.0 the owner performs the installation/UI tests after publication;
   complete the artifact and cryptographic checks before publication.
   Do not add old Intel/Linux/Windows URLs to a new arm64-only updater manifest.

`verify-update-manifest.mjs` rejects stale platform entries, wrong release URLs
and mismatched signatures. It does not replace cryptographic client verification
or an actual installation/update test. Private keys are never exported from
GitHub. Build receipts and UI gates are separate from notarization.

Version [0.4.0](https://github.com/BonJenn/blackcrab/releases/tag/v0.4.0) is now
public from source caf57b6fab1b4391836c6635882a15a88edfac0d. Release workflow
43337173131 passed; actual downloaded app, DMG, embedded payloads and updater
signature passed delivery verification. The read-only DMG app matched the updater
app. The owner still performs manual installation, UI, lifecycle and upgrade tests.
Never overwrite that public tag for later fixes; choose a new release version.
The website, blog, changelog and actual download buttons were also verified.
See docs/agent-handoff.md for exact evidence and remaining parity work.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/),
[Tauri action](https://github.com/tauri-apps/tauri-action/tree/v0.6.2),
[Apple notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

## Renewed 0.4.2 publication instruction — 2026-11-13

After testing the working private workspace and requesting branding/picker/pane
polish, the owner explicitly said: "you have plenty of usage get this published".
Publish the verified 0.4.2 follow-up with OWNER_TESTING_AUTHORIZED, that exact
authorization, the final source, followUpOf v0.4.1 and followUpSourceRevision
62ef3868d65252ba062bbee0200d6cb74a27ea6f. Keep lifecycle checks deferred unless
actually completed; never substitute PASSED. This current instruction supersedes
the earlier 0.4.2 publication hold. Signing, notarization, payload inventories and
updater cryptographic verification remain mandatory. It does not authorize later
versions or certify full parity. Retain the current production service artifact:
the separate host-copy branch needs a data-preserving manifest upgrade before
changing the installed service. Publish website notes only after the installer.
