# Inactive manifest-bound owner identity v2 candidate

This directory prepares a protocol and exact source deltas. It does **not** install an issuer, enable Service attachment, build a profile-4 artifact, activate a service, expose a listener, or change either active producer registry. Current native Service ownership restrictions must remain in place.

## Audited chain and distinction

`source-records.json` records the authenticated upstream archive/commit, every active `apps/server/src/http.ts` patch in order, their actual hashes, and exact native working-source snapshots. The HTTP before image is reconstructed from the authenticated archive by applying those real registry replacements with every before/after/payload digest checked; it is not a rewritten approximation. `registry.json` uses the ordinary producer patch format but is candidate-only. The Rust add-only patch is separate and has no active call site. `LICENSE.upstream` preserves the original MIT notice; the added candidate codec/interface/tests are Blackcrab integration work under the repository license.

Active proof9 signs a fresh nonce, environment, configured loopback origin, server version and orchestration protocol. Native `probe_at` verifies it before generating/sending a bootstrap-derived OAuth credential. Existing direct ownership retains this exact v1 behavior, including version `0.1.7`. The native desktop launcher obtains an independent pairing grant only through that verified host binding; its FD4 broker does not supply a durable service-child bootstrap issuer.

Current `Configuration.ownership` Service restrictions fail before direct probe/start/grant paths. No restriction is removed here. The future Service verifier is separate, requires response version2 and ten exact response fields, and cannot accept v1 even when environment/version/secret are otherwise identical. Direct v1 does not silently upgrade to a Service policy based on response JSON.

## V2 transcript

The UTF-8 HMAC-SHA256 input is the JSON array, in this exact order:

```
["blackcrab-managed-host-proof-v2", nonce, environmentId, origin,
 serverVersion, orchestrationProtocolVersion, manifestSha256,
 "blackcrab-local-service-layout-v1", 4]
```

Nonce, owner secret and selected manifest digest are lowercase 64-character hexadecimal values for the Service contract. Response fields are `version:2`, `nonce`, `environmentId`, `origin`, `serverVersion`, `orchestrationProtocolVersion`, `manifestSha256`, `layoutProfile`, `serviceProtocol`, `proof`. The domain-separated transcript binds the service layout profile/protocol and **exact native-selected manifest bytes**, preventing a same-version C21/profile4 or other-manifest substitution. The Service server version comes from the independently verified selected manifest, not a fabricated release number or the response. Orchestration protocol remains the current supported2. The illustrative version used in one test is only a test value; no release or same-version overwrite is authorized.

The native caller generates a new random nonce per probe and retains its expected selection locally. It compares the entire expected identity before constant-time MAC verification. A previous response cannot satisfy a new nonce. This preparation does not claim a replay database, process identity proof, publisher signature, revocation protocol or protection after owner-secret compromise. Manifest binding is trustworthy only when the native issuer actually verifies/captures that artifact before handing its secret and bound identity to that exact child.

## Candidate route, not an issuer

The existing path accepts `version=2&nonce=<challenge>` for the candidate. V2 rejects duplicate/unknown authority query fields; Host/Origin headers and request bodies do not select identity. V1 requests retain their original behavior. The inherited loopback-only configuration guard remains; widening it for future LAN service exposure needs its own reviewed native-origin/policy design.

`ManagedOwnerProofIssuer` is an optional backend Effect service whose only input is the nonce. The candidate returns404 when that service is absent. There is **no layer, JSON constructor, authorized-boolean receipt or native bootstrap implementation here**. The interface is not an authentication boundary by itself. Tests inject a fixture signer solely to exercise the actual staged route; that injection is not a deployable issuer. `proof-codec.mjs` is likewise a pure crypto/schema reference, not an issuance or artifact-verification API.

Before any activation, a genuine native-private issuer must:

1. Hold the ownership-aware native configuration/selection fence, fully verify the selected artifact and its exact manifest digest, verify the owned external layout marker/profile4/protocol4, and bind the actual environment and configured local control origin. Recheck generation/selection through issuance; no request JSON may supply any of these values.
2. Establish the actual captured service child and preserve original launcher protocol4 Node IPC on descriptor3. As documented in `../../boot-service/bootstrap/README.md`, the proposed bootstrap descriptor is the child's captured stdin0; replacing IPC3 is invalid. Original update trial/rollback, exit78, child ownership and cleanup remain necessary.
3. Supply the original private auth bootstrap plus bound identity through an authenticated native-only captured-FD path. Do not place secrets in argv, service.env, service state, URL, public config, renderer messages or diagnostic serialization. Missing/timeout/partial/malformed issuance must fail closed rather than use the original optional-bootstrap fallback.
4. Keep direct-owner migration and existing live-host reconciliation explicit. A persisted PID, native-looking JSON receipt or layout marker alone does not authorize adoption or signaling. GUI absence/restart, concurrent Root start, stale issuer generation and uncertain FD writes require real lifecycle tests.
5. Wire the separate v2 native verifier into a reviewed Service-only probe before any bootstrap-derived OAuth exchange or pairing grant, and only then reconsider the current `require_direct` restrictions. Bind to independently selected manifest/version/profile, never fields learned from the challenged endpoint.

Those issuer semantics are not yet implemented, so no executable launcher/credential route is invented here. Profile4 remains unbuilt and C21 remains ineligible for the service installer. Existing independently paired native/mobile sessions and original OAuth grant semantics are unchanged.

## Validation and limits

Run:

```
node --test fork-integration/owner-control/identity-v2/proof.test.mjs fork-integration/owner-control/identity-v2/replay.test.mjs
node fork-integration/owner-control/identity-v2/typecheck.mjs
```

Eleven tests exercise the actual staged HTTP route, v1 compatibility, mandatory v2 Service policy, every signed field, fresh-nonce mismatch, exact selected-manifest substitution, profile/protocol/version mismatch, malformed tags/challenges, authority injection, missing issuer, and atomic replay/refusal using the real producer helper. The issuer interface passes strict TypeScript6.0.3 against the installed Effect types. The route tests use a small generator interpreter and fixture issuer; they are not a real Effect HTTP server or native issuer integration test. The Rust candidate is source-reviewed/add-only and **has not been compiled or executed**; its cross-language transcript and lifecycle wiring still require native tests before promotion. No native build, networking, service/host activation or account operation was performed.
