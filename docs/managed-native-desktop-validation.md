# Native desktop producer validation

This records a local producer milestone, not full desktop parity or installation into the main application. Target: BonJenn/t3code commit `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`, Electron 44.10.1, darwin-arm64.

The production package has 3,305 inventory entries and manifest SHA256 `3b24b7e3978b83b78d2281935069e5362d0d5d912c5e14b6a800c12563838d84`. Ad-hoc strict signature verification and independent full inventory verification passed. This proves local consistency; release signing and notarization remain pending.

Nineteen focused Node tests passed, covering descriptor bounds/namespace, inherited private FD4, credential generation/expiry, revocation, delayed attachment cancellation, production refusal of QA packages, source patch hashes, bounded framework links, and physical Effect singleton enforcement. CI runs these tests independently of native packaging.

A separate disposable native acceptance build exercised the same client attachment/authentication implementation with fixture-only OS/account ports. It passed client settings read/write and invalid-value rejection, forwarded keyboard-shortcut IPC, physical window bounds persistence, an existing-thread secondary composer, fresh HTTP/WebSocket access after two controller exchanges, and one FD4 renewal after advancing the client credential cache clock by 31 days. Normal application quit preserved the independently owned host. Final run and provider-session inventories were empty; no model turns were sent. Owned process groups and temporary profile were cleaned up.

The acceptance policy is deliberately non-adoptable: production integrity verification rejects its role and QA payload. This evidence does not certify production keychain, OS capture, real interactive typing, provider OAuth, or every native addon. Two identical-version physical Effect copies originally broke settings/shortcut codecs; canonical dependency resolution and bundled-source singleton checks now reject that packaging error without changing the upstream contracts.

Remaining work includes the main application's owner and launch integration, authenticated host challenge validation, reconnecting browser transport, fork account/hosted endpoints, CLI/update/SSH distribution, provider OAuth return-origin handling, release distribution and the remaining scenario ledger. Source presence and passing packaging checks do not close those scenarios.
