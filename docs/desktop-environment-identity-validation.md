# Native desktop environment identity compatibility

The pinned upstream contract defines EnvironmentId using TrimmedNonEmptyString; ServerEnvironment also preserves non-empty persisted identity text after trimming. Blackcrab's native desktop had instead required UUIDs when binding an owner and parsing its private descriptor. Existing valid environments could authenticate to the service yet fail to open the native desktop.

The owner binding, native descriptor and client parser now preserve trimmed non-empty environment IDs. The Rust policy matches ECMAScript trim, including BOM and excluding NEL. Environment IDs remain opaque data: credential renewal compares the exact owner identity and generation, and renewal request IDs still require UUIDs. The existing descriptor byte bound remains enforced.

Seven JavaScript descriptor tests passed. Fourteen native policy tests and the descriptor/renewal regression passed, covering non-UUID and Unicode identities, interior whitespace, rejected boundary whitespace, request-ID constraints and oversized descriptors. A real isolated packaged service fixture with its preexisting non-UUID identity passed two complete native binding, pairing, attachment and graceful stop cycles. Issuance retired at epochs 8 and 9. All captured process groups were quiescent, and no provider turns were requested.

The private real-host acceptance module is excluded from production files. Its removal does not change runtime implementation. This evidence covers native identity transport, owner binding and pairing; it does not certify rendered full-desktop entry, fresh service initialization, OS service activation or the complete desktop/mobile parity ledger.
