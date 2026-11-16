# Paired models — 0.4.5 draft

This opt-in source recipe adds the composer partner picker and the host's bounded
lead → review → resolve execution. See [behavior and validation](../../docs/paired-models-045.md)
and the [continuation handoff](../../docs/paired-models-045-handoff.md).

Call `preparePairedModelsSource({profile, archive, cacheDir})` from `prepare.mjs`
with `profile: 'desktop'` or `'host'`. The archive must match the production
upstream pin. Each profile applies after its existing authenticated production
recipe and returns `releaseEligible: false`. The host and desktop registries have
different predecessors; do not interchange them or apply either twice.

No release producer imports this module. Production registries, the service
profile/build freeze, the native QA identity pin, and installed payloads remain
unchanged. Promotion of both profiles, a verified new host build, and a stopped,
data-preserving service upgrade must be coordinated for 0.4.5. Do not package this
source using unchanged production provenance or enable it in the 0.4.4 release.

Use isolated QA state and provider fixtures. `validation.json` identifies the
exact tested record hashes and separates fixture/build results from pending
authenticated provider, installed UI, and lifecycle acceptance.
