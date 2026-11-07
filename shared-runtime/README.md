# Pinned native connection runtime

Blackcrab's managed workspace connection uses source from `BonJenn/t3code` at
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`. This is separate from the legacy
Blackcrab remote protocol. Its identities, credentials, RPC, receipts and event
streams are not translated into the legacy protocol.

`vendor/t3` contains the static source closure of six public entry points:
connection, authorization, RPC, platform, shell state and relay services. The
current closure contains 207 source files across 20 workspace packages. Generated
package manifests expose only selected upstream exports and actual dependencies;
the full original manifests and lockfile remain in the provenance directory.
External dependencies are pinned to Effect 4.1.2 and `@noble/hashes` 1.8.0.

## Reproduce and verify

Use the exact archive described in `managed-host/README.md`. The export command
requires a nonexistent output directory and a separate extraction cache:

```sh
npm run build:shared-runtime -- --archive /path/to/t3-reference.tar.gz --cache /path/to/external-cache --output /path/to/new-vendor-directory
npm run verify:shared-runtime
npm run test:shared-runtime
npm run typecheck --workspace @blackcrab/mobile
npm run bundle:shared-runtime:ios
```

See `scripts/build-shared-runtime.mjs` for the archive, cache and output arguments.
The archive digest is checked before fresh extraction. Analysis rejects symlinks,
Node imports, unknown external dependencies, unresolved imports and conditional
exports that resolve to different runtime files. Export does not execute upstream
source. The verifier checks every recorded file and reconstructs the selected
import graph and package manifests.

One recorded TypeScript-only patch annotates three RPC callback parameters that
otherwise fail the existing mobile TypeScript compiler. Its before/after hashes,
diff and original source are retained. Tests establish identical emitted
JavaScript; protocol behavior is not rewritten. Other selected source files are
unchanged. Upstream MIT attribution is retained at `vendor/t3/LICENSE.upstream`.

## Native boundary and acceptance limit

The native adapters live in `apps/mobile/src/managed`. Their catalog and selected
environment use separate versioned SecureStore keys; legacy phone pairings,
drafts, queues and read cursors retain their existing namespaces. Cache keys are
hashed per environment and cache records use the upstream codecs. Cache data is
not an authorization source. Failed writes do not replace committed catalog or
cache data. Native lifecycle subscriptions are scoped to the runtime owner.

Direct bearer pairing is supported by the shared connection services. Blackcrab
cloud identity, managed relay, SSH routing and cloud account flows are not yet
implemented by these native adapters. Disabled services fail explicitly and do
not contact T3 cloud or fabricate credentials.

The iOS bundle command compiles the actual product entry to Hermes bytecode.
`--fixture` selects a standalone six-entry import fixture. Compilation is not
execution on iOS, and neither compilation nor source reuse establishes full
mobile parity. Agent mutations, transcript interactions, approval controls and
remaining target mobile workflows require their own implementation and evidence.
## Verification trust boundary

`buildSharedRuntime` checks the complete reference archive SHA-256 before
extracting source. It then computes the client import boundary, applies the known
recorded parameter-type patch, generates restricted package metadata and verifies
its assembled output before publication.

`verifySharedRuntime` checks the artifact's file inventory/hashes, recomputes its
runtime/type import closure and dependency boundary, validates generated metadata
against preserved upstream manifests/lock importers, and independently requires
the known exact source patch and original source bytes. The source patch also
has a pinned before/after digest and identical TypeScript JavaScript emission.
Removing its declared provenance does not make it an unchanged upstream file.

This is unsigned source integrity and consistency checking. The pinned archive
check authenticates the source consumed by the trusted builder; the standalone
verifier does not reopen that archive or independently authenticate every
self-described source digest to a publisher. Rewriting all mutually consistent
source/provenance metadata is outside that verifier's authentication claim. The
trusted build/verifier code, patch registry and reviewed reference checksum are
part of the trust base. Release signing/attestation remains a separate gate.

Installed third-party dependencies are outside the source artifact inventory and
are governed separately by the consumer's npm lock/install workflow. Only exact
selected workspace package-root `node_modules` directories may be exempted from
source scanning. `src/node_modules`, the vendor root's `node_modules`, and
unselected package locations are rejected: they can shadow root dependencies
without belonging to a normal selected npm workspace dependency installation.
The source verifier does not authenticate the bytes of exempted installed npm
packages or claim that package versions alone prove native compatibility.
