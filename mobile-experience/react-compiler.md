# Native React Compiler fidelity

The pinned T3 mobile configuration enables `experiments.reactCompiler`. Its
`reactCompilerCoverage.test.ts` deliberately checks production Metro compilation.
Blackcrab's owned Expo configuration now preserves that requirement. No upstream
hook or component source is changed.

The c603 native acceptance exposed a real render loop. The owned simulator's
Expo Observe/AppMetrics SQLite error contained the Hermes stack. Its exact
4479-source map (`63adcbe29af91eff156bc661651ee185040702efa7f10b3e0ef620cfee3e3738`)
matched the installed Hermes bundle
`849d7c30299cf1483b91c4d928f73d5f6a24135642046a61956bfc9866927874`.
Mapped calls were WorkspaceNativeTabs.ios.tsx55:21 → StackHeader.tsx177:70 →
NativeHeaderToolbar.tsx271:18, inside a layout-effect cleanup. Without compilation,
`setRouteOptions` and `isActive` are allocated again on every render. This changes
the header writer/cleanup dependencies; cleanup sets route options and starts
another render. The target depends on compiler memoization for these callbacks.
The retained c603 app, map, observed database snapshots and failed XCTest evidence
must remain unchanged for diagnosis.

`react-compiler.mjs` uses the installed Expo production option factory and Babel
transformer, rather than manufacturing a compiler-enabled caller. Its regression
executes the actual emitted cached setter across renders, checks option merging,
and contrasts the disabled transform's unstable identity. It also checks emitted
header cleanup caching. Original module hashes and the compiler1.0.0 published
lock integrity are pinned; actual compiler/Expo implementation hashes are recorded.
The lock identifies published inputs; recorded installed-file hashes are separate
provenance, not a claim of independent npm archive authentication.

The verifier compiles the actual prepared `.generated/native-ui/apps/mobile/src`
filenames under the Metro project root and requires their bytes to match the
original source policy. Read-only local dependency mode additionally requires the
installed native tree's prepared files and Babel configuration to be byte-identical;
it never falls back to the desktop installation's older Expo preset.

The native preparation pipeline records `artifacts/react-compiler-proof.json`
after verifying installed dependencies and generating the prepared UI, before prebuild/bundling. CI includes
the regression in the existing mobile-experience test glob. A local read-only
installed native dependency tree can be selected with
`BLACKCRAB_MOBILE_COMPILER_DEPENDENCIES_ROOT`; tests never install dependencies.

## Required next build

Commit the app configuration, compiler policy/check/tests and preparation wiring
first, then take a clean physical source snapshot at that revision. Generate the
full native UI in that new snapshot using the existing pinned exporter. Native
ABI dependencies and vendor source stay unchanged; an isolated incremental native
build can reuse matching reviewed dependency/Pods caches only under the existing
producer's graph and source checks. Do not modify the protected c603 SDK tree.

Use a fresh private Metro cache/TMPDIR and reset the bundle cache. The production
export's custom transform options must contain `reactCompiler: "true"`. Discard
old Metro transform outputs, the old main.jsbundle, its composed Hermes map and
Xcode's prior bundle-script products in the NEW build workspace; preserve the old
c603 copies. The native executable/Pods may compile incrementally, but the JS and
Hermes bundle must be regenerated. Record the new source revision, compiler proof,
4479-or-new-source map/hash, Hermes hash and complete signed app inventory. Update
acceptance app/source pins only after producer verification; the previous app
inventory and Hermes pin cannot represent this change. No native build, simulator
boot, or acceptance success is established by the source regression alone.
