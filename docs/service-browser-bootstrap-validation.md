# Service-owned native browser bootstrap

Fresh service setup allocates the native private browser capability only when the selected, digest-bound runtime manifest contains all four browser-bootstrap source records. Older service payloads remain usable without silently advertising that capability. Issuer delivery validates the capability against the native workspace owner and requires matching source records in the installed payload.

The optional capability travels only in the private native authentication envelope. Both launcher and backend validate its exact shape, fixed native socket layout, key and safe generation. Backend configuration receives it without changing the existing host, port, LAN or Serve precedence. Network paths, arbitrary FDs and extra metadata are rejected. The original direct-start bootstrap remains unchanged.

Validation: seven portable policy/profile tests passed, including complete composition against pinned original source and the unchanged default producer. Production Release compilation and 26 focused native tests passed (23 issuer/boot, one selected-feature manifest test and two fresh-setup tests). Frozen source inputs remained unchanged and all captured compiler/test process groups were quiescent.

Eleven permanent launcher regression tests also pass, including private FD0 capability delivery with IPC3, rejection of malformed/configuration-bearing capabilities before child spawn, existing trial-update handling, helper loss and cleanup failure behavior. The browser cases load the exact registered launcher result and policy bytes. Three public-projection privacy checks pass as well.

This change is not runtime acceptance: rebuilding the complete service artifact, typing/bundling the effective server graph, real native/Electron socket handshake, reconnect and shutdown still require validation. It does not certify full desktop or iOS parity.
