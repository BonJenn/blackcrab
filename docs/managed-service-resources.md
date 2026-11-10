# Explicit native service resources

`npm run build:native -- --managed-service-host <verified service artifact>` selects the complete service profile for the native host resource. It is mutually exclusive with `--managed-host`, whose direct-host verification remains unchanged. Neither option installs or activates a service. The currently verified service resource target is macOS arm64.

The service path verifies the exact complete profile, source records, build provenance and artifact inventory. It preserves the existing private archive and extraction roundtrip, byte pins and mode/link checks. Only after verification does it emit the compiled `BLACKCRAB_EMBEDDED_HOST_SERVICE_PROFILE` capability alongside the manifest and archive pins. Ambient inherited profile and hash values are cleared before every preparation.

Eleven resource tests passed, including mutual exclusion, unsupported-target refusal, direct-artifact refusal and inherited-profile clearing. Two optional tests were skipped in that portable run. The real service artifact was then exercised separately through the actual helper under a captured process group: source verification, archive/extract roundtrip and all post-verifications passed. The source manifest remained unchanged, the output archive matched its computed pin, cleanup completed, and the captured group was quiescent. The production desktop/QA-role rejection checks also passed. The optional actual Tauri bundler test was not run in this change.

This provides an explicit native resource producer. Fresh-owner setup, OS service controls, product UI and full desktop/mobile parity remain separate acceptance work. No host, OS unit or provider run was activated by these checks.
