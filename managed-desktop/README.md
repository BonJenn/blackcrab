# Managed native desktop client producer

This directory produces an independent **Blackcrab** Electron client from the pinned T3 fork archive. It retains the original native service graph, trusted custom-protocol renderer, preload, native workers and external native dependency closure. It attaches to an existing managed host. It never owns, spawns, signals, locks or updates that host.

This package is **not adopted by the Rust app**. Owner-control and credential-broker integration, distribution signing/notarization, native browser transport, remaining native workflow certification, cloud accounts, CLI distribution and updates are gates. The original implementations remain available for review; unconfigured ownership/distribution actions explicitly fail instead of claiming authority. Only darwin-arm64 is currently supported by this producer.

## Reproduce

Use Node 26.12.1, pnpm 12.14.0, the checksum-pinned source archive and the official Electron 44.10.1 darwin-arm64 ZIP. The producer checks every digest before extraction. It creates new source/build directories, uses a private build HOME/TMPDIR, applies the exact `patches/registry.json` before/after records, and publishes only after integrity verification.

```sh
node scripts/build-managed-desktop.mjs \
  --archive /absolute/t3-reference.tar.gz \
  --electron-archive /absolute/electron-v44.10.1-darwin-arm64.zip \
  --cache /absolute/owned-build-cache \
  --output /absolute/new-package-directory \
  --node /absolute/pinned-node \
  --pnpm /absolute/pinned-pnpm
node scripts/verify-managed-desktop.mjs --artifact /absolute/new-package-directory
node --test managed-desktop/*.test.mjs
node managed-desktop/qa/codec-probe.mjs --source /absolute/producer-created-source
```

Optional `--dependency-cache` and `--secondary-dependency-cache` reuse read-only producer dependencies with the identical pinned lockfile. Workspace package links are rebound into the newly extracted source. No shared dist/output directories are linked. Fresh installs use the frozen lockfile and their own store. An owned web-output cache records the source/patch/toolchain fingerprint and every output digest; desktop-only changes do not rebuild unrelated web assets. Copies are independent files, with copy-on-write hints where the filesystem supports them.

Secondary cache packages resolve through the canonical primary cache whenever the exact package identity is present. All workspace and `@effect` dependency resolutions must use one physical Effect 4.1.2 runtime; desktop and web sourcemaps are checked after bundling. Two byte-identical Effect installations still create incompatible codec objects and can break settings/defaults/shortcuts, so matching versions alone is insufficient.

Dependency-cache reuse trusts the operator-provided cache contents; lockfile equality alone does not reauthenticate every installed package. Use the frozen install path with trusted registry access for an independently sourced build. The final manifest authenticates artifact bytes against an independently trusted manifest digest, rather than establishing the publisher of build inputs.

`Blackcrab.app` uses `com.blackcrab.desktop.managed`, internal `blackcrab://app`, an explicit private `blackcrab-managed-v1` profile, Blackcrab icons/wordmark and its own managed-policy namespace. No `~/.t3` or legacy profile migration fallback exists. App resources include original MIT attribution, Electron/Chromium notices, web notices, desktop bundled-input and external-package closure notices, patch records, build provenance, addon availability and a complete integrity inventory. Native addons are staged with their original files; presence does not certify OS permissions, entitlements or every workflow.

The local artifact is ad-hoc signed. Integrity verification is not publisher authentication. Before adoption, pin the manifest digest through a trusted distribution channel and pass `--manifest-sha256`; release signing/notarization is separate. Framework links are permitted only when bounded, internal, non-cyclic and non-dangling. No escaping links, special files, unexpected inventory changes, foreign source pins, namespace drift or patch drift are accepted.

## Private owner attachment contract

The owner supplies one bounded JSON descriptor on inherited **FD3**, then closes FD3. `descriptor.mjs` and `runtime/descriptor.d.mts` are the executable schema/type definition. The descriptor identifies the exact loopback origin, environment UUID and owner generation, canonical existing private owned profile directory, fixed app/profile namespace, and `control.kind = unavailable`. No endpoint, credential or profile fallback is taken from argv/environment.

Authorization is an **independent one-time pairing credential**, not the owner's bootstrap seed or a startup-static bearer. The owner mints the ordinary 12-character grant through the real host authorization service. The native client uses the unchanged shared SDK `bootstrapRemoteBearerSession`, validates cached sessions, respects `expires_in`, serializes concurrent callers and obtains fresh grants through inherited private duplex socket **FD4**. A controller desktop-bootstrap exchange may revoke other controller tokens; it must not share a session subject/method with this paired client. The Root mint/renew port is not integrated yet.

FD4 request (one outstanding request, NDJSON, bounded response, 10-second deadline):

```json
{"version":1,"kind":"native-client-credential","requestId":"uuid","generation":1,"environmentId":"uuid"}
```

The owner returns exactly `version`, `kind: paired-credential`, matching `requestId`, `generation`, `environmentId`, fresh `credential`, and `expiresAt` (future Unix milliseconds, at most 24 hours). The grant is exchanged once. Stale/wrong replies, EOF, timeout and unavailable renewal fail closed; owner channel loss closes this client, not the host. Root must authorize each mint against the captured child/generation and actual grants, and must close old client channels when replacing ownership. No arbitrary owner commands are exposed through this protocol.

Ordinary client quit only detaches. Delayed readiness is fenced against stop; window creation failure rolls attachment state back. The original single-owner auth service is retained in source for provenance but is not selected: its indefinitely cached shared-bootstrap bearer is unsafe for this multi-client topology.

## Host and product requirements

`host-requirements/registry.json` contains separate exact host deltas. Own-origin cookie/dev trust is added without removing existing origins. Packaged CORS selects an exact own-origin middleware for `blackcrab://app`; unrelated public browser requests preserve wildcard behavior. The native client refuses to open its privileged renderer against a host that does not return that exact preflight permission. It never falls back to a privileged HTTP renderer or the T3 scheme.

Fork cloud public configuration is empty and ambient repository `.env` files are not loaded. Clerk account transport/default-handler registration and cloud token persistence are unavailable until fork-owned configuration exists. Hosted pairing and prompt sharing require an explicit hosted endpoint; direct endpoint pairing and internal thread references remain available. Unconfigured download controls are hidden. Updates have no configured feed and an explicit disabled policy. CLI installation/distribution and owner exposure changes are gated. SSH discovery/resolution remain available; remote bootstrap refuses to install an upstream runtime until fork distribution is configured. These are product ownership/configuration gates, **not global network restrictions**: original preview browsing, user-requested external links, SSH implementations and provider endpoints are retained.

Private acceptance policy belongs only in `qa/` and must never be passed off as production functionality. It denies OS/keychain/capture/account ports and non-fixture outbound traffic for disposable tests. Interactive keyboard/click entry is not certified by the API-level probes. Existing external A/B evidence established trusted rendering, real windows and app-owned preference persistence; this producer's own artifact/auth/CORS acceptance is recorded separately. Native browser CDP reconnect patches will be integrated as a separate exact registry increment after Gate C passes.
