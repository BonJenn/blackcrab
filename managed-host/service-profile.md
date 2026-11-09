# Opt-in native-owned service payload producer

The opt-in producer has compiled a real macOS arm64 package. Its final protected-
input audit is still pending, and the output remains unselected in quarantine.
The existing default C21 producer and its21 descriptor output remain unchanged.
The developer producer accepts an optional exact profile
`blackcrab-local-service-layout-v1`; unknown profiles and Windows service targets
fail before source preparation. No install, service action, native selection,
release feed or version invention is performed. Original version remains0.1.7.

The optional `--profile blackcrab-local-service-layout-v1` flag is passed by
scripts/build-managed-host.mjs to buildManagedHost. Source preparation always starts
from a NEW extraction of the exact authenticated pinned archive; no mutable checkout
or caller-supplied registry is a build input. This is integrity/provenance checking,
not a signature, trusted-builder attestation or native artifact grant.

## Complete fixed chain

service-profile.mjs loads only these reviewed local registries in order:

1. Full fork namespace identity4 (pairing/provider/mobile-reader/managed-policy).
2. Active managed-host21.
3. Original owned boot-service5.
4. Owned auth3patches+1source.
5. Owner identity-v2 HTTP+interface2.
6. Concrete backend identity3patches+1source.
7. Captured launcher2patches+2sources.

All44 descriptor IDs/diff or source hashes are retained, including the exact
camelcase reviewed identifiers. Two identity records are aliases of active21's
pairing/provider-return records. Their raw diff bytes, target, before/after hashes
and independently executed replacement results must match. Token edits and fullfile
edits are normalized to the SAME verified fullfile replacement only after this
proof. Both raw registries/descriptors and derivation proofs are preserved. No
other aliases, duplicate/unknown/reordered IDs or ambiguous substitutions are allowed.
The resulting42physical records enter ONE source-engine preflight before any write.

Every fixture-based change verifies exact predecessor/result fixture bytes and raw
diff bytes before normalization. Payload targets must be absent. Source parents and
files cannot be symlinks; source files cannot be hardlinked. The service preparation
root must be private0700/currentUID/canonical. Actual builder preparation creates
that root from the authenticated archive; source-only consistency tests are not
native authorization APIs.

## Original launcher and Effect graph

The pinned original bin.ts, cli/serviceLauncher.ts, scripts/cli.ts and server
vite.config.ts are checked against exact original source hashes. Original
`__service-launcher` dispatch stays in the Node-only bootstrap and loads the
modified original NodeLauncher, with builtin-only binding validation. The full
Effect CLI remains original raw `binMain.mjs` asset, keeping config capture and HTTP
proof in the SAME CLI module graph. The original build:exe script retains its
external-import checks and bootstrap<=1MiB check. No replacement launcher executable
or service-specific fake server is used. Actual built SEA/bootstrap/CLI closure
acceptance is still required after the real build; source checks alone do not prove
runtime behavior.

## Package contract

The same managed-host schema1 inventory and original`t3` entry/version are used.
sourcePatches contains all44 unique descriptor IDs. All raw group registries and
patch/payload bytes, normalized physical records, and alias derivation proofs are
included beneath source-patches/ and therefore in the complete inventory.
BLACKCRAB-SERVICE-PROFILE.json records exact profile/protocol4/entry contract and
that the producer performs no activation. BUILD-PROVENANCE.json adds serviceProfile
and serviceProtocol ONLY on the opt-in path. The service verifier checks full normal
artifact integrity plus exact fixed profile metadata/descriptors. It does not mint
native authority. Current default resource publisher remains21-only and is not
silently redirected to the new service payload.

Native adoption needs the actual complete manifest SHA compiled into the reviewed
native issuer/publisher and genuine private ownership/selection. It must still
verify the full payload, all required service records and native lifetime fences.
No manifest/profile JSON boolean authorizes activation. Sameboot uncertain issuer
recovery remains separately gated; the producer does not clear journals or signal
persisted PIDs.

## Validation scope

Focused Node tests use actual preverified original target bytes in private copied
fixtures: all namespace/21/5/auth/identity/backend/launcher transforms reach exact
pinned result hashes, late predecessor corruption causes no early writes, the
normal default still produces21 descriptors/protocol3, reviewed uppercase IDs replay
without rewriting, malformed paths/control IDs fail, and generic self-consistent
artifact metadata cannot bypass exact service-profile verification. These tests do
not install dependencies, compile a host, run a native helper, start listeners,
change OS service units, or call providers. The actual real build and packaged
private auth/proof/original launcher lifecycle tests remain pending.
