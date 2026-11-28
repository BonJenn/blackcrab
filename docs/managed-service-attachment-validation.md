# Native attachment to an owned background service

A service-owned configuration previously failed every desktop connection at `require_direct`. Native status and attachment now accept an already running service after verifying the protected native selection against the compiled Host manifest, installed issuer bytes, private binding and complete selected payload. A fresh challenge explicitly requests service proof v2; the response cannot select its manifest, version, environment, origin or secret. OAuth credentials are sent only after that proof succeeds. Direct owners retain their separate v1 path.

Desktop attachment does not acquire service process ownership. It cannot replace the selected runtime, start a stopped service, mint an issuer envelope or modify an issuance journal. An invalid native service selection is rejected before any network request, even when a listener is present.

## Validation

The source hashes in `managed-host/service-attachment-validation.json` identify the tested implementation. Release library compilation and six service identity tests passed. The regression test exercised an unverified service configuration and observed no HTTP request, configuration mutation or direct process spawn.

An isolated macOS arm64 test used the real archived service profile and the real installed optimized issuer, then launched the original packaged `__service-launcher` through captured child handles. Both cycles passed native probe authentication, status and start-as-attachment; explicit runtime replacement failed. After each graceful launcher stop, native status was stopped, desktop start refused, and issuance remained retired. The v1 downgrade endpoint remained rejected. Native epochs advanced to 6 and 7. No process authority was reconstructed from a PID. All three captured controller groups settled and were quiescent; no provider turn was sent.

The first attempt passed the first complete cycle but checked runtime discovery too early during the second start. The retry waits up to 180 seconds only for the missing discovery record, checks captured launcher liveness, and still rejects proof, selection and authentication errors immediately. Failed evidence was retained separately.

This covers native attachment to a preinstalled private service fixture. It does not certify fresh product service initialization, the product current-executable publication wrapper, OS service installation/activation, the full native desktop entry or rendered UI, or full desktop/mobile parity. Those remain acceptance obligations.
