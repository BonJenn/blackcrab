# Actual endpoint regression gate

Every Unix managed-host production build runs the actual payload9 SocketDesktopBrowserChannel.test.ts and payload10 ServerBrowser.test.ts after pinned source/dependency preparation and before web/executable/monitor publication. Windows advertises no leased UDS capability and retains its existing FD transport. A failed test stops publication.

The same command in a prepared, authenticated pinned source tree is:

```sh
cd "$SOURCE/apps/server"
"$PINNED_NODE" "$SOURCE/node_modules/vite-plus/bin/vp" test run src/preview/SocketDesktopBrowserChannel.test.ts src/preview/ServerBrowser.test.ts --maxWorkers=1
```

This uses the pinned real @effect/platform-node WebSocket server, Effect Socket.fromWebSocket reader/writer latch and actual TCP/UDS connections. Root Node CI has no platform-node dependency; no framework mock, duplicated adapter or lockfile change was added to simulate this gate.

Regression evidence: the previous implementation passes the endpoint-owner test but times out waiting for an expired CDP socket to close (1/2 pass). The fix acquires the reader before writing a close frame, closes rejected sockets1008 and closes live sockets1012 when the retired inbound queue ends. Both tests pass, covering expiry before connect and detach after connect. Exact source/payload hashes remain in registry.json. Native CDP/JPEG/reconnect acceptance is a separate required gate.

The published-context lifecycle regression also fails the previous implementation: retiring a lease then closing its old Playwright wrapper deletes the durable preview session. Retaining the captured attachment and treating retired-wrapper close as reconnect preserves metadata, emits reconnect and allows a successor context. The complete actual source suites pass59/59 after this fix (2socket +57ServerBrowser tests).
