# Managed-host runtime package

This builds an optional managed-workspace payload from the pinned T3 source.
It does not install a service, start a user host, migrate legacy sessions, attach
the desktop/mobile clients, or publish a release. Those remain separate gates.

## Build

Provide the exact reference archive recorded in `artifact.mjs`, Node 26.12.1,
pnpm 12.14.0, the selected Node distribution's complete LICENSE, a Rust toolchain
and the native tools required by the target platform. Node/pnpm can be installed
in an isolated prefix with `npm install --prefix /path/to/tools node@26.12.1 pnpm@12.14.0`.
pnpm 12's executable is passed directly, rather than as a Node script.

```sh
npm run build:managed-host -- \
  --archive /path/to/pinned-reference.tar.gz \
  --cache /path/to/build-cache \
  --output /path/to/new-managed-host \
  --node /path/to/tools/node_modules/.bin/node \
  --pnpm /path/to/tools/node_modules/.bin/pnpm \
  --node-license /path/to/node-distribution/LICENSE
```

The output must not already exist. The builder checks the archive checksum and
toolchain before extracting fresh source; a changed archive is never executed.
The workspace install uses its frozen lockfile with lifecycle scripts disabled.
The upstream runtime archiver separately installs its declared runtime externals;
that upstream installer uses its package ranges and records actual installed files
in the resulting integrity manifest. This is not a bit-reproducible release claim.

The pipeline builds the web client, standalone executable and native resource
monitor, then invokes the target's native runtime archiver. Temporary directories
and per-step logs are retained in the chosen build cache for diagnosis. Package
manager downloads may also use its default per-volume store. Local macOS signing
is explicitly ad hoc; release signing/notarization is not performed.

Attribution includes the upstream MIT license, complete web/server/desktop
third-party notices, Node's supplied license, and resource-monitor dependency
license files. Published objc2 crates omit their workspace notice; exact crate
versions and published Git revisions select vendored upstream notices plus the
standard MIT text and original authors/metadata. Unknown omissions fail closed.
Source integration changes are recorded under `patches/`, applied
only to their exact original file hashes, and included in package provenance.
The office font alias patch fixes file URLs on paths containing spaces and
Windows drive paths; it preserves the feature rather than removing its assets.
The native LocalApi and Command Palette patches connect the separate Blackcrab
macOS folder/link interface without advertising an Electron desktopBridge.
Project icon patches extend the original settings dialog only for compatible
local project selections, preserving the optional-capability/browser/Electron
fallbacks. See [native workspace integration](desktop.md) for authorization and limitations.
The renderer-origin patch adds the exact `blackcrab://app` and
`blackcrab-dev://app` origins to the existing native cookie-session trust list.
A second narrow CORS patch returns that exact production origin with an Origin
cache variance marker, allowing the native client to distinguish compatible hosts.
Other browser origins retain their existing CORS behavior. These changes preserve
bearer authentication; full native attachment and Blackcrab cloud configuration
remain separate work.

The managed owner challenges an existing loopback listener before sending its
bootstrap credential. Patch 009 exposes a nonce-bound HMAC proof only on an
explicit owned loopback binding with a bootstrap secret. The proof binds the
configured origin, environment and protocol versions; request Host/Origin
headers cannot choose those values. This authenticates possession of the
owner secret at challenge time; it does not provide TLS or continuous channel
attestation. Packages predating this patch must be rebuilt before attachment.
An unrelated listener is refused without sending it the bootstrap credential.

A complete staging tree is hashed and checked before its final rename. The
manifest records the upstream commit, source patch digests, host target and every
regular file's path, byte count, SHA-256 and executable flag. Extra/missing/changed
files, unsafe paths, symlinks, incompatible targets and missing payload/notices
are rejected. This is unsigned integrity checking, not release authentication.

## Verify and exercise a relocated package

```sh
npm run verify:managed-host -- /path/to/relocated-managed-host
npm run smoke:managed-host -- /path/to/relocated-managed-host
npm run test:managed-host
```

The Unix smoke always creates fresh private data. It binds loopback, launches the
packaged executable directly without Node/npm on its prepared PATH, fetches its
environment descriptor and local client assets, verifies unpaired project access
is rejected, and uses separate CLI clients to create/rename a project across a
server restart. It checks stable identity, client-disconnect survival and package
integrity after stopping. No provider turn, service installation or user data
migration is performed. A bootstrap pipe marks the fixture PATH as already
prepared; otherwise the target intentionally restores the user's login PATH.
Logs may contain this disposable host's pairing credentials and remain private
in its smoke directory; the JSON report omits them.

Native smoke is currently Unix-only. Windows metadata fixtures are not native
Windows distribution evidence. Desktop window attachment, authenticated iOS,
provider turns, legacy migration, daemon supervision, update/configuration
isolation and signed multi-platform distribution remain required before claiming
an independent production host or parity.

## Recorded local evidence

On 2026-11-07, the pinned archive and native macOS arm64 toolchain built the
web client, standalone executable, resource monitor and 112,660,622-byte archive.
Assembly initially stopped on omitted objc2 workspace notices; after correcting
attribution it continued from the retained staging directory. The complete
package contained 3,727 regular files / 355,967,313 bytes, excluding its manifest.

The package was moved to a new parent and the fresh build source renamed out of
reach for the smoke. Both starts passed: unauthenticated projects returned 401,
the local HTML/script asset loaded, separate CLI clients added then renamed a
project across restart, environment identity remained stable, and hosts survived
client disconnects. Post-stop verification found no payload modifications. The
source directory was restored afterward and owned host processes were stopped.

Validation: 30 managed-host tests; required repository smoke (167 desktop tests,
133 native tests passed, one ignored; native check and production build passed).
This is native macOS arm64 package evidence only, not full parity certification.
