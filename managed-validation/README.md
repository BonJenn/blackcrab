# Packaged-host acceptance

These opt-in checks run the pinned shared connection/RPC implementation against a
previously verified native managed-host package. They use fresh private host,
project, HOME, temporary, credential and cache state. They never create a provider
run or submit an agent message. The host process group is captured at spawn and
stopped in cleanup; runtime PID files never authorize process termination.

```sh
BLACKCRAB_MANAGED_ACCEPTANCE=1 \
BLACKCRAB_MANAGED_HOST_PATH=/path/to/verified/runtime/t3 \
  npm exec -- vitest run --config managed-validation/vitest.config.ts
npm exec -- tsc --project managed-validation/tsconfig.json
```

The test creates a project through the real CLI and pairs independent write and
read-only clients. It checks command-ID deduplication, thread metadata updates,
archive/unarchive, host-enforced rejection of read-only mutations and restoration
after a complete host restart with the saved credential catalog. Repeated
desktop-bootstrap exchanges revoke the prior owner bearer session while the
independently paired client remains authenticated over HTTP and WebSocket. Empty run and
provider-session projections confirm that no provider was started.

The fixture intentionally supplies a no-prompt SDK permission guard so the
read-only mutation reaches the server's authorization boundary. This override
exists only in this test, changes no host grants and is not product code.

Without the explicit opt-in flag, the integration test skips. The packaged
executable must match the current platform. This is a macOS packaged-host check,
not evidence of native iOS controls, real provider turns or full domain parity.
The private test directory retains a sanitized report and private host logs for
diagnosis; pairing links stay in memory and are never printed. After inspection,
remove the exact reported disposable directory.

Recorded macOS arm64 evidence: the three-patch relocated managed package passed
the complete test on 2026-11-07. Its native host survived client disposal, retained
its environment identity across restart and restored the same unarchived thread
title; a read-only paired client could not change it. Command deduplication and
empty run/provider-session projections also passed. The scoped TypeScript check
passed. CI checks imports and types without opting into a missing native artifact;
that skipped CI test does not replace the real packaged-host run.

The extended owner/session coexistence check also passed against the same
verified packaged runtime on 2026-11-07. The session-inspection endpoint returns
HTTP 200 with `authenticated: false` for a revoked token; the fixture asserts
that field rather than mistaking HTTP success for authenticated access. This
server-side result does not certify the native client renewal broker.
