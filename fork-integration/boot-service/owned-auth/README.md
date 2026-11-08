# Auth-only owned service bootstrap candidate

Inactive source candidate, not a producer profile, launcher integration or native
issuer registration. No listener, service installation, model, network exposure,
public JSON route or GUI exposure gate is added. License: upstream MIT, adjacent.

## Effective source chain

ServiceLauncherClient starts from pinned original commit
7f02de2eb8e253e0ec23f005b3cfff8e2c963be8, archive
 eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6.
Config starts from **after active managed-host native-browser-host-2**, preserving
Direct desktopBrowserSocket parsing/forwarding and active host1 contract schema.
Config predecessor SHA is b91c02c7fe7e3453b7ca10a47e40549fb37a4ce13706669e50a4f1bec1bfa1d0.
ServiceProtocol starts from **after existing boot-service004**, protocol4, not
pristine protocol3. The source fixtures and registry pin both exact predecessors
and resulting bytes. Binding type/validator live inline in builtin-only ServiceProtocol; the Effect
reader imports them, never the reverse. An unloaded child Effect graph cannot
prevent the Node-only launcher from loading its protocol.
Original trial/update/prepared/committed messages and version
checks remain unchanged; the optional ownedAuth context extension is additional.
Use exact existing profile `blackcrab-local-service-layout-v1` consistently.

Add OwnedServiceAuthBootstrap.ts at apps/server/src; apply the three recorded
source deltas. A real producer must promote all four new records on top of the
reviewed owned profile4 chain, rebuild and verify the complete selected artifact.
The candidate developer bundle does not confer artifact/native authority.

## Private channel contract

Actual owned launcher supplies protocol4 context with ownedAuth equal to:

```
{profile:"blackcrab-local-service-layout-v1",generation:positiveSafeInteger,
 manifestSha256:lowercaseSha256,environmentId:existingNonemptyString}
```

Environment IDs are not restricted to UUID; existing trimmed strings up to128
UTF16 units with no control characters are preserved. Real Node IPC is mandatory:
original ServiceLauncherClient uses actual connected/send availability, original
context decoder and matching childVersion. Inherited context without IPC is
ignored. Protocol3 is refused by the effective protocol4 base.

For this branch only, FD0 must receive exactly one bounded JSON document and EOF
within1second, maximum16KiB. FD3 remains Node IPC. Envelope:

```
{schema:1,kind:"blackcrab-owned-service-auth-v1",binding:ownedAuth,
 desktopBootstrapToken:string,desktopBootstrapSecret:string,
 desktopBrowserFd?:integer>=5,desktopBrowserControlFd?:integer>=5}
```

Browser descriptors must be present as a pair. Unknown fields, network/mode fields,
missing/empty/oversized/stale binding, timeout/EOF without envelope all fail. Error
messages do not contain secret values. Existing desktop bootstrap FD selection is
forbidden in this owned branch (including environment selection). No new public
flag selects this envelope. Ordinary Direct DesktopBackendBootstrap schema and
precedence remain unchanged.

**Context is a selector, not authority.** A forged environment plus some IPC does
not constitute native authorization. Actual launcher integration must mark EVERY
owned child and must get the envelope only from the captured native issuer under
its selected manifest/generation/environment lease. Missing owned marker must not
be an allowed downgrade in that actual owned-launch path. This folder does not
implement that launch/native issuance transaction. Native issuer must use the new
auth schema instead of its earlier DesktopBackendBootstrap proposal, and own proof
publisher installation must retain the verified binding separately; do not trust a
context object or developer fixture as identity-v2 authority.

## Fidelity

Only original auth/browser fields are sourced from the new envelope. The original
`bootstrap` variable remains desktop-only for mode/host/port/noBrowser/Tailscale,
base-dir and observability precedence. Service child remains original `serve` with
its original sealed service.env/CLI settings. No desktop local-enabled preference
is consulted or forced true. Original implicit service LAN privateNetworkOnly,
undefined host, IPv6/Tailnet hosts, port selection and Serve policy survive.
No network precedence extraction or Rust reimplementation is necessary.

Original resolveServerConfig still creates its expected directories. This is real
service startup configuration, not the prior read-only desktop settings query.
The native issuer therefore needs auth issuance only, not a precomputed effective
host/port packet. Native child launch must preserve original service.env semantics
and bind readiness to the actual resulting service endpoint through original
runtime publication plus authenticated proof, not assume the old loopback port.
Ownership/exposure/policy enforcement beyond original config remains a separate
native integration gate. Active GUI exposure setters stay blocked before persistence.

## Validation

prepare-probe.mjs stages/checks ALL active21 managed-host records, then all boot5,
then the four owned-auth records, identity-v2 HTTP/interface records, and the four
backend-identity successor records, retaining a complete composed-chain.json. Workspace
imports use that composed tree, including modified contracts, never pristine sources.
It checks protocol4/config predecessors and uses frozen
read-only dependencies, bundles real original Config/Effect graph with a single
Effect4.1.2 physical identity. integration.test.mjs spawns actual child IPC and FD0;
only boolean presence of fixture auth fields is printed. No real credentials,
accounts, models or service child are used. Runtime configuration tests exercise
original functions, not copied precedence assertions. provenance.test.mjs pins the
deltas and additionally checks original network-precedence source remains exact.

Focused auth schema/reader strict types pass. Whole-Config strict typecheck was
attempted but lacks broad pinned provider workspace mappings in this small probe;
it is NOT claimed passed. Real complete Config graph bundle/execution passes.
Latest composed Config/capture/provenance/mirror tests:19 passed, zero skipped.
This bounded Config fixture graph verifies273 workspace input hashes, no cached workspace inputs,
and no desktop-query-only identity refactor. Owned config capture/proof uses the
SAME actual Config object; spreading it and ordinary Direct configuration cannot
transfer that marker. This supersedes the
earlier pristine Config-only14-test scope. Full monorepo/package/native issuer/service
readiness acceptance remains pending.

## Staging integrity correction

The earlier developer mirror had a stale-lstat bug: after recursively creating a
parent, a newly seeded intermediate symlink could be followed. It changed exactly
one reference file (DesktopBackendBootstrap) to the registered active host1 result.
The full authenticated archive/source audit covered all36419 entries: no extras,
no other content/type/link differences, and all extraction-normalized modes matched.
Before bytes and inventories were preserved; only that file was restored from the
SHA-verified archive, with canonical nofollow directory/file descriptors and its
original UID501/GID20 and mode0644. Full postrestore source verification passed.

source-mirror.mjs now materializes parents FIRST and obtains a fresh lstat, requires
disjoint canonical owned roots, validates every relative path, and unlinks final
entries before exclusive creation. ALL source/addsource writes in both developer
preparers use it. Three adversarial tests cover preexisting ancestor/final symlinks,
the exact fresh-parent stale-lstat regression, and overlapping-root refusal; original
source bytes/modes/UID/GID remain unchanged. No artifact/native authority comes from
this developer helper. Full reference-source postrun verification is required in
addition to these tests; validation.json records its current acceptance status.

This fixture does not apply the separate full Blackcrab namespace/identity producer
patch set. Its explicit-baseDir service Config results do not certify an exact
production producer graph, installable package or native service readiness.
