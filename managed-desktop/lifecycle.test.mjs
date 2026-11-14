import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { serveLifecycle } from './lifecycle.mjs';
class Peer extends Duplex {
  replies = [];
  _read() {}
  _write(bytes, _, done) { this.replies.push(JSON.parse(bytes)); this.emit('reply'); done(); }
}
const request = (id = 1) => JSON.stringify({ version: 1, id, action: 'activate' }) + '\n';
test('activation acknowledges readiness and supports reopen, including split frames', async () => {
  const stream = new Peer(); let visible = false;
  const server = serveLifecycle(stream, async () => visible);
  const first = once(stream, 'reply'); const frame = request(); stream.push(frame.slice(0, 4)); stream.push(frame.slice(4)); await first;
  assert.deepEqual(stream.replies.pop(), { version: 1, id: 1, visible: false });
  visible = true;
  for (const id of [2, 3]) { const next = once(stream, 'reply'); stream.push(request(id)); await next; assert.deepEqual(stream.replies.pop(), { version: 1, id, visible: true }); }
  server.close();
});
test('malformed, oversize, extra authority and pipelined requests cannot activate', async () => {
  for (const input of ['x\n', 'x'.repeat(1025), request(0), request() + request(2), '{"version":1,"id":1,"action":"activate","pid":2}\n']) {
    const stream = new Peer(); let calls = 0;
    serveLifecycle(stream, async () => { calls++; return true; });
    const closed = once(stream, 'close'); stream.push(input); await closed; assert.equal(calls, 0);
  }
});
test('timeout and disconnect fence a late window activation result', async () => {
  for (const disconnect of [false, true]) {
    const stream = new Peer(); let resolve;
    serveLifecycle(stream, () => new Promise(r => { resolve = r; }), { timeoutMs: 20 });
    const closed = once(stream, 'close'); stream.push(request());
    await new Promise(r => setImmediate(r));
    // Keep a timer referenced so the unref'ed protocol deadline is exercised.
    const keepAlive = setTimeout(() => {}, 1000);
    if (disconnect) stream.push(null);
    await closed; clearTimeout(keepAlive); resolve(true);
    await new Promise(r => setImmediate(r)); assert.equal(stream.replies.length, 0);
  }
});
test('actual child receives only the inherited lifecycle socket', { skip: process.platform === 'win32' }, async () => {
  const moduleUrl = new URL('./lifecycle.mjs', import.meta.url).href;
  const code = `import { openLifecycle } from ${JSON.stringify(moduleUrl)}; const server=openLifecycle({lifecycle:{kind:'launcher-lifecycle-fd-v1',fd:6}}, async()=>true); process.stdin.resume();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: {}, stdio: ['pipe','ignore','pipe','pipe','pipe','pipe','pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const exited = once(child, 'exit');
  try {
    const reply = once(child.stdio[6], 'data'); child.stdio[6].write(request());
    const [bytes] = await reply; assert.deepEqual(JSON.parse(bytes), { version: 1, id: 1, visible: true });
    assert.equal(stderr, '');
  } finally { child.stdin.end(); for (const stream of child.stdio.slice(3)) stream.destroy(); await exited; }
});
