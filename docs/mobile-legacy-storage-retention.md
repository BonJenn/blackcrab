# Legacy mobile storage retention

The legacy mobile host catalog and read-position cache keep their existing v1
keys and record formats. Reading either collection does not rewrite it. A malformed
JSON value, an unsupported collection shape, or an invalid row now blocks the
whole collection instead of silently turning it into an empty or filtered list.
Pairing, forgetting a host and saving a read position cannot overwrite that
unreadable value. Error messages omit the stored contents and native diagnostics.

Native operations require SecureStore throughout the read-and-write operation.
Temporary unavailability never falls back to browser storage or process memory.
The web client requires durable browser storage. Failed persistence is reported
to the existing pairing error flow, which closes the accepted transport without
reporting a successful pairing.

Each collection serializes its mutations and reads behind pending writes. Two
simultaneous pairings or cursor updates retain both records; later operations can
retry after a failed write. Read-position identity uses a host/session tuple so
colons inside either identifier cannot overwrite a different session's position.
The persisted cursor records themselves do not change.

## Validation

The new storage suite reproduced 19 failures in 22 cases against the preceding
implementation. With the fix, all 122 tests in 16 affected files passed, covering
storage, the pairing screen, loopback WebSocket pairing, reconnect/failover,
drafts and queue recovery. Scoped strict TypeScript checking also passed.
Loopback transport tests verify that a newly accepted connection closes when
existing credentials cannot be read, preserving the original stored bytes.

These checks use controlled storage adapters and inert loopback protocol fixtures.
They do not establish iOS keychain behavior across an installed application
upgrade, physical-device behavior, or live cloud/off-LAN/provider acceptance.
No schema migration, data deletion, or automatic corruption repair is performed.

## Populated native upgrade still required

Use only a fresh task-owned simulator and an isolated host with no provider
execution. Install the recorded baseline build, pair through its UI, open an
existing inert session and enter a multiline unsent draft. Exercise the queue's
uncertain-delivery path with a controlled fixture without executing a provider.
Record the baseline product identity and the nonempty host, cursor, draft and
queue state. Identify fixture evidence explicitly rather than presenting it as
real-provider or real-legacy-server acceptance.

Install the newly built candidate over the same application without erasing its
container. Verify the same host/session identities and visible draft recovery,
plus pending queue recovery without automatic duplicate submission. Verify
cross-host/session isolation and a second cold launch. Native file/keychain
inventories supplement UI and protocol observations; unchanged file digests alone
do not prove recovery. An empty legacy queue does not satisfy this gate.

Draft attachments, the managed mobile experience's update path, owned Expo
updates, physical devices and full desktop legacy migration remain separate
acceptance obligations in the parity ledger.
