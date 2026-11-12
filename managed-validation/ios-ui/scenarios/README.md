# Current service acceptance scenarios

These are source copies of the manually approved native/SDK acceptance scenarios,
not tests that CI should run automatically. The TypeScript templates were staged
under the isolated mobile build's `apps/mobile/.generated/` directory with its
actual generated original client runtime and the reviewed native service adapter.
Relative imports intentionally refer to that staging layout. Inputs and raw
results stay in the private test workspace; no provider prompt is submitted.

`service-revocation-sdk.test.ts.template` uses two real shared SDK clients and the
original native service. It identifies the remote session through the server's
current-session identity, revokes it through the public auth API, verifies live
blocking and credential/ticket rejection, then pairs that same environment again.
A read-only grant permits reads but the host rejects a bare-RPC edit; an operate
grant restores rename/archive. A native service restart must preserve both the
successful metadata changes and the old credential's revoked state. Both client
runtimes dispose and the captured native service owner closes before publication.

The SDK's network, storage and app-state ports are in-memory test adapters. This
scenario tests the real connection/auth/service paths, not native storage, UI,
provider execution or an off-LAN relay. See
[`current-service-sdk-revocation-result.json`](../current-service-sdk-revocation-result.json)
for the exact source and evidence digests.

Swift files run through Apple XCUITest on fresh task-owned simulators using the
already-built app. Each accepted phase requires an official one-pass/zero-skip
result and a nonce/device-bound completion attachment. They do not select an
existing device, instrument product state, or grant system permissions.

`service-revocation.swift` exercises the actual Settings → Environments screens.
It reads the authentication failure from expanded connection diagnostics, because
the summary row groups its visible status under a Manage accessibility label.
After pairing with a read/operate grant, the scenario checks the exact app-owned
legacy-permission alert for the sole saved host before acknowledging `Got it`.
It has no global interruption monitor or system-permission dismissal. The observer
independently checks that the repaired session is new and has exactly read/operate
scopes, and that native rename/archive changed the original thread.

The native summary-row accessibility gap is recorded in the parity ledger. The
scenario's diagnostics navigation does not repair or certify that summary row.

The accepted native result is recorded in
[`current-service-revocation-result.json`](../current-service-revocation-result.json),
with six official UI passes and two reviewed pairing canaries.

`service-connection-accessibility.swift` repeats the revocation/re-pairing scenario
on the rebuilt app and requires the main environment row's native accessibility
value to expose Connected, the authentication diagnosis, and Connected again.
Its matching observer is `service-connection-accessibility-observer.test.ts.template`.
See [native accessibility acceptance](../current-service-accessibility-result.json).
These assertions inspect native accessibility values; spoken VoiceOver and
physical-device coverage remain separate.
