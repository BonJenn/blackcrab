# Fork identity patch preparation

This directory contains preparation only. It does not alter an active producer,
managed-host registry, mobile activation registry, immutable vendor tree, or app.
Pinned source: `BonJenn/t3code` commit
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`, archive SHA256
`eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6`.
`LICENSE.upstream` preserves the original MIT attribution. `registry.json` records
full source before/after hashes, exact diff hashes, unique replacements and audit
fixture hashes. The full original and effective source files are retained.

## Prepared changes

1. `001-own-pairing-app-links`: the shared builder emits an encoded
   `blackcrab-remote://pair?pairingUrl=...` envelope. Its reader accepts exactly
   that scheme/authority, empty or `/` path, one nonempty `pairingUrl` parameter,
   no user information, port, extra query parameters or fragment. It does not
   authorize the nested backend URL: the unchanged shared HTTP(S)/WS(S) target
   codec remains responsible for decoding it. Direct and hosted-envelope backend
   semantics are unchanged.
2. `002-own-desktop-provider-return`: replaces the two external desktop schemes
   with `blackcrab://app` and `blackcrab-dev://app`. Loopback HTTP(S) is preserved;
   the unowned `https://app.t3.codes` OAuth return origin is removed without an
   invented replacement. Original welcome/settings path restrictions, allowed
   query names, welcome-query removal, hash sanitation and userinfo rejection
   remain unchanged.
3. `003-own-mobile-pairing-reader`: delegates the native QR reader to the shared
   strict envelope reader. Other input stays unchanged and still passes through
   the existing SDK target parser. This prevents a protocol-only native reader
   from bypassing envelope authority/path/query checks.

## Producer integration boundaries

Apply 001 and 002 independently to fresh pinned host and desktop source trees,
then record their descriptors in each producer's own provenance/registry and
rebuild. `applyIdentityPatch(bytes, descriptorOrId)` returns patched bytes and
fails closed for unknown descriptors, mutated diff bytes or changed source.
This is unsigned source consistency checking, with the authenticated pinned
archive as the upstream trust anchor; a caller must not treat metadata as a
publisher signature.

For native source export, carry 001/002 through the existing generated-consumer
provenance machinery before updating any raw-source hashes. Apply 003 to the
original mobile source. **Do not stack it after the current activation adapter's
one-line `t3code:` -> `blackcrab-remote:` QR change**: the before hash intentionally
rejects that order. Replace that activation rule with the reviewed delegation,
and regenerate its exact before/after hashes. No existing registry is changed by
this preparation. Internal `t3-thread://v1` and `t3-thread://v2` codecs are not
patched and are executed unchanged by the tests.

## Provider OAuth audit and service gaps

The pinned native provider screen's `startSignIn` sends `{ instanceId, methodId }`
(or the instance target) to `serverEnvironment.startProviderAuth`; it does not
construct or send `returnUrl`. It opens the authorization URL and supports manual
submission of the final localhost callback using `callbackUrl`. Consequently no
`blackcrab-remote:` OAuth return authority/path is added. Widget/navigation
`Linking.createURL` calls are not evidence of a provider OAuth return contract.
A future native automatic return flow needs an explicit route, lifecycle handler,
provider/server contract and owned registration before allowlisting it.

No Blackcrab hosted auth domain, OAuth client registration, relay endpoint or
credentials are invented. `connectAuth.DEFAULT_HOSTED_APP_URL` and hosted-thread
link generation retain their pinned source and require separate owned-service
configuration before those external hosted experiences can be advertised.
Desktop scheme registration must continue to match the owned `app` authority;
the mobile app must register `blackcrab-remote`, as the current owned app does.

## Validation

Run `node --test fork-integration/identity/identity.test.mjs` using pinned Node 26.
Tests transpile and execute effective TypeScript with the installed TypeScript
compiler and actual Effect/contracts dependencies; no installer, native build,
provider sign-in, credentials or network service is invoked. They cover exact
provenance, mutation rejection, encoded round trips, direct transport parity,
lookalikes, userinfo/ports, paths, query ambiguity, sanitation, mobile auth-call AST
and the unchanged internal thread codec.


## Current integration and independent policy candidate

The first two effective patches have now been promoted into the host/desktop recipes in draft desktop PR215. The third mobile QR candidate remains unapplied, as described above. This preparation registry itself is not a production producer registry.

`004-own-managed-policy` moves only administrator-policy names and human-readable product names: macOS JSON under `/Library/Application Support/Blackcrab`, managed preferences under `com.blackcrab.desktop.managed`, Windows protected Program Files and HKLM policy locations under Blackcrab, and Linux `/etc/blackcrab/policy.json`. Original decoders, error tags/exit codes, machine-admin ownership boundaries, unknown-field refusal, precedence and enforcement code remain exact. It does not read, modify or migrate another application's policy. Eight identity tests pass, including actual execution of each platform's path selector and reversal of all reviewed replacements back to the exact original source. This fourth candidate is not active in either production recipe yet; the owner exposure acceptance probe applies it privately before running the real original services.
