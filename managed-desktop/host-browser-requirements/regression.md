# Actual endpoint regression gate

Every Unix managed-host production build runs the actual payload9 SocketDesktopBrowserChannel.test.ts after pinned source/dependency preparation and before web/executable/monitor publication. Windows advertises no leased UDS capability and retains its existing FD transport. A failed test stops publication.

The same command in a prepared, authenticated pinned source tree is:

```sh
cd "$SOURCE/apps/server"
"$PINNED_NODE" "$SOURCE/node_modules/vite-plus/bin/vp" test run src/preview/SocketDesktopBrowserChannel.test.ts --maxWorkers=1
```

This uses the pinned real @effect/platform-node WebSocket server, Effect Socket.fromWebSocket reader/writer latch and actual TCP/UDS connections. Root Node CI has no platform-node dependency; no framework mock, duplicated adapter or lockfile change was added to simulate this gate.

Regression evidence: the previous implementation passes the endpoint-owner test but times out waiting for an expired CDP socket to close (1/2 pass). The fix acquires the reader before writing a close frame, closes rejected sockets1008 and closes live sockets1012 when the retired inbound queue ends. Both tests pass, covering expiry before connect and detach after connect. Exact source/payload hashes remain in registry.json. Native CDP/JPEG/reconnect acceptance is a separate required gate.
