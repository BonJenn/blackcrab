# Native managed-experience source preparation

This independent preparation slice analyzes the original iOS app entry (`apps/mobile/index.ts`) before upgrading Blackcrab's native platform. It does not activate that app, modify existing legacy Hosts/queues, alter the current shared runtime export, or change Expo/native build tooling.

Authenticate/extract the existing pinned T3 archive using the managed-source preparation first. Then run:

```sh
node mobile-experience/snapshot.mjs write /path/to/authenticated-source /tmp/mobile-graph.json
node mobile-experience/snapshot.mjs verify /path/to/authenticated-source /tmp/mobile-graph.json
node --test mobile-experience/graph.test.mjs
```

Write refuses to overwrite an existing output. `analyzeMobileExperience(sourceRoot)` returns deterministic relative file hashes, runtime/type reachability, original package manifests/hashes, used workspace exports/conditions and actual dependency edges. The mobile app manifest is included as an owning package. The fixed external allowlist is independent of dependency metadata, so unused SDK declarations cannot expand executable closure. Unknown external names, Node builtins, ambiguous conditional workspace exports, unresolved references, source escapes, symlinks and nonliteral imports fail closed. iOS/native relative variants override generic modules. Explicit import-type queries and literal JSON assets are included.

`verifyMobileExperienceGraph(sourceRoot, graph)` recomputes the complete graph, including parser version and dependency policy. This verifies unsigned consistency against the supplied source, not source authenticity. Callers must independently validate the archive SHA and pinned commit. This is deliberately not the production vendor exporter yet: native sources/assets, npm package internals, autolinking, generated stream/license modules and CSS resource imports need separate inventories. A matching graph does not prove Metro/Hermes/native compilation compatibility. TypeScript is taken from the installed root development dependency; parser changes intentionally invalidate snapshots.

Pinned upstream `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8` currently yields 1,457 files, 23 shared workspace packages plus the mobile app package, and 77 bare dependency names. Five special bare names are generated Metro aliases or local native packages; they are explicitly classified in graph metadata, not claims of installable npm dependencies. Full source UI activation requires Expo58/RN0.88/React19.3, custom screens/native-stack and native module dependencies. Existing Expo54 direct connection work remains independent.

Next exporter work must preserve source/package provenance and full native/resources inventory, resolve actual per-owner dependency pins, and apply own branding/cloud/update configuration through recorded patches. Do not copy T3-owned Apple teams, Expo updates projects, app groups or credentials. Avoid mounting the original App conditionally: it installs outbox, update, share and other services at module import, so embedding requires an explicit lifecycle adapter and one managed registry/runtime owner.

## Authenticated complete source preparation export

```sh
node mobile-experience/export-cli.mjs build /path/to/t3-reference.tar.gz /tmp/mobile-source-cache /tmp/mobile-experience-source
node mobile-experience/export-cli.mjs verify /tmp/mobile-experience-source
node --test mobile-experience/*.test.mjs
```

`buildMobileExperience` authenticates the exact archive SHA from `managed-host/artifact.mjs`, extracts fresh unpatched source using the shared archive helper, never imports/runs upstream generators/configuration, and removes its extracted temporary root after completion. Output is staged and renamed only after verification; existing output is refused. The source archive pin is the build trust anchor. The subsequent standalone verifier checks unsigned consistency, not authenticity if all payload and metadata are replaced together.

The bundle preserves original mobile source/configuration/assets/native modules, all source in selected workspace packages, root assets/scripts/patches, original licenses and lock/config inputs. Runtime/type graph membership is separately marked; supporting files and original devDependency declarations do not become installed runtime closure. Original manifests are **unchanged**: there are no generated consumer manifests and no source patches. The bundle retains T3-owned configuration as inert reference source and must not be run as a configured fork app. A later reviewed config/branding adapter must replace those settings before activation.

`RESOURCE-INVENTORY.json` explicitly records all ten local native module directories and registration/podspec/codegen manifest files. It preserves the two custom native npm archives and their SHA256 values via payload records. Three generated Metro aliases record output locations, generator files and browser/config entry inputs. Their generation remains pending installation of pinned tool dependencies; exported source is not a false claim that these outputs exist. Full mobile and selected package directory inventories preserve adjacent images/fonts/Swift/C++/Rust/bundled native resources and upstream attribution files even when static imports cannot discover them.

`DEPENDENCY-LOCK.json` records every selected owner's original dependency groups, original declaration, pinned lock specifier/resolution (including peer and patch hashes), explicit lock override, and actual external import-edge ownership. Local native peer dependencies record their provider and exact mobile-app lock resolution. The preserved raw lock also retains complete transitive snapshots/integrities. This is install preparation metadata, not an npm lock conversion or proof that all transitive native dependencies build on a different platform version. Generated aliases and type module aliases are handled explicitly; an unowned bare source dependency fails export.

Actual authenticated export currently contains **3,109 payload files / 116,930,797 bytes**, including 1,457 graph-reachable source files, 24 original owner manifests, ten native modules and three generator aliases. Two independent builds must produce identical `VENDOR-MANIFEST.json` bytes. Full native compilation, npm consumer-manifest generation, own config patches and feature testing remain integration gates.

## Recorded source preparation evidence

Two independently extracted pinned archives produced identical manifest SHA-256
`1556f294c45b8bfe7d7c73bc32bb205d9a3e53160e8ac72c90fd179b4c861859`: 3,109 payload
files / 116,930,797 bytes, 1,457 graph files, 24 package owners, ten native modules
and three generated aliases. All 15 graph/export boundary tests passed, including
archive rejection, changed metadata/provenance and source consistency. Run them
with `npm run test:mobile:experience`. This preparation does not establish native
platform compatibility or activate the mobile experience.

License generation inputs additionally preserve all pinned third-party-licenses/spdx templates, apps/server/src/device/deviceToolVersions.json, and native/libghostty-vt/LICENSE (required by a mobile custom notice). These prevent the original license generator from needing omitted source inputs or fetching missing templates.

## Owned Expo 58 consumer platform

`build-consumers-cli.mjs <preparation> <absent-output>` creates the installable source layout separately from unchanged preparation. It unions the original App, both generated browser-script entries and the six existing public direct-connection entries. The consumer has 1,459 reachable files and 23 trimmed shared manifests; original manifests, archive provenance, the known JavaScript-neutral RPC type patch and every generated manifest change remain recorded. `verify-consumers-cli.mjs` recomputes the actual closure, checks original-source and lock provenance, and permits installed dependencies only at exact selected package roots. Nested source `node_modules` trees remain rejected. Byte-preserving Git attributes keep archive checksums portable across checkouts.

Blackcrab owns the Expo configuration, schemes, bundle IDs, fonts and disabled update checks. The original upstream app configuration is inert reference source. Root desktop React stays 19.1; the mobile Metro resolver forces React 19.3, including compiler-runtime, across application, hoisted and vendored importers. Existing Hosts, queues and managed workspace list remain active; upstream full UI activation is separate work.

Use Node **26.12.1** and npm **12.2.2**. The lock retains exact Expo 58.0.14, React Native 0.88.0 and React 19.3.0. The postinstall verifier applies 27 pinned upstream dependency patches using original pnpm package integrity, diff SHA and complete before/after file hashes. It also applies one independently pinned build-only Expo Widgets adapter: its private Metro build must watch the actual workspace root to index hoisted helpers. Resolver stubs and widget runtime sources are unchanged. This is the npm layout equivalent of the upstream workspace visibility, not a forced dependency peer or transport change.

Owned resource generation bundles the two original browser entries, preserves pinned style/theme inputs and collects notices from the **host application dependency graph**, including legacy dependencies. Supplemental notice inputs and hashes are recorded under `.generated/licenses/NOTICE-INPUTS.json`; no upstream notice configuration is edited. Native build reports record tree-sitter/grammar versions and URLs, RaTeX archive/source checksums, actual downloaded C/Swift/framework file hashes and the three bundled font hashes. Generated outputs live outside the immutable vendor inventory.

For authoritative isolated native preparation:

```sh
node scripts/prepare-mobile-ios.mjs --mode build --npm-cli /path/to/npm-12.2.2/bin/npm-cli.js --derived-data-parent /path/to/external/build-cache --npm-cache /path/to/external/npm-cache
```

New source files must first be tracked in Git. The producer snapshots their exact bytes into a physical whitespace-free directory, installs without account/provider configuration, generates native projects, verifies the iOS 18 deployment floor and builds a standalone Release Hermes application. This validates the platform baseline; it does not establish complete mobile workflow parity or distribution signing.

Native dependency verification resolves Expo Modules JSI from both the app and
Expo Modules Core contexts, requiring JSI 58.0.15 with Core 58.0.22. A compatible
semver range had selected JSI 58.0.22, whose native Swift ABI omitted a symbol
required by the pinned Core framework; the exact override and both-context
guard prevent that installation from becoming a native product. The producer
bounds native compilation and Metro to two workers and certifies arm64 simulator
output. Use a physical whitespace-free staging directory; the optional existing
canonical npm cache must be outside the source repository. Cache and DerivedData
paths are recorded in the build report.
