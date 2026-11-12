# Pinned mobile source and activation adapters

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and apps/mobile's guide.

This directory owns source export/consumer verification, native resources,
dependency/build patches, Metro integration and full-interface activation.
`vendor/t3-mobile` preserves authenticated source and original metadata.
Make product adaptations here or in the appropriate recorded shared patch set;
never mutate generated vendor output or package caches as an undocumented fix.

Original source inventory, graph membership, consumer manifests, installed
dependency closure and generated native resources are different proofs.
Update each affected record deliberately. A matching lock hash does not prove
nested owner dependencies exist or that a hoisted fallback is correct.

Preserve Expo Modules Core 58.0.22 / JSI 58.0.15 compatibility and the distinct
mobile React 19.3 versus root React 19.1 resolution. The real compiler/runtime
and custom native modules must remain enabled; no resolver stubs or silent
feature removal to get a build green.

Owned adapters replace T3-owned cloud/update/bundle identifiers. Updates require
an explicitly owned Expo project and channel. Production/preview use native
fingerprint compatibility; development follows its configured policy.
Do not claim live OTA delivery from config tests alone.

Run `npm run test:mobile:experience` or focused Node suites for changed modules,
the affected scoped runtime tests, and `verify:mobile:consumers` when provenance
changes. Native resource generation must occur in the owned staged source.
An exporter, Hermes bundle or simulator build alone does not establish iOS
workflow, device signing, TestFlight or full mobile parity.
