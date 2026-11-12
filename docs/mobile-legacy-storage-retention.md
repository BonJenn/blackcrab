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

The unit and transport checks use controlled storage adapters and inert loopback
protocol fixtures. Native upgrade validation is recorded below. No schema
migration, data deletion, or automatic corruption repair is performed.

## Populated native upgrade

On November 11, 2026, all four XCUITest phases passed on a fresh owned iPhone 17
Pro simulator running iOS 26.2. The Release candidate was installed over the
baseline without erasing the application container. Both artifacts and the
compiled test runner were pinned and verified.

- The baseline UI paired two inert hosts, saved three drafts across host/session
  boundaries, recorded read positions, and left one uncertain message in the
  durable outbox alongside a newer draft.
- Installation preserved the app-scoped keychain snapshot and persisted draft
  and queue records. Native UI checks then recovered both host identities, all
  three drafts, unread markers, and the pending message.
- An explicit retry submitted the original command unchanged. Its receipt
  cleared the recovery record while preserving the newer draft.
- A cold launch retained the recovered state. The protocol fixture observed
  zero automatic resubmissions and zero provider runs. The owned simulator was
  shut down and all captured child processes exited.

The baseline is integration reference `d1d4d2741a9ffece4b1cf79a5255f667f535fd1e`,
which includes queue-event delivery. The candidate is combined integration
`8254c98fb614181512e95ca7d8422cfacfb5a74e`, including this storage fix. This is
not evidence of upgrading an older published release or connecting to a real
legacy server. The [sanitized acceptance record](mobile-legacy-upgrade-acceptance.json)
contains artifact, runner, and result digests; private pairing credentials and
raw native logs are excluded.

Draft attachments, the managed mobile experience's update path, owned Expo
updates, physical devices, live cloud/off-LAN/provider behavior, and full desktop
legacy migration remain separate acceptance obligations in the parity ledger.
