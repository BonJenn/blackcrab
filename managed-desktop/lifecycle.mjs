import fs from 'node:fs';
import net from 'node:net';

/** Private Root-to-workspace channel. No URL, PID, path or executable is accepted. */
export function serveLifecycle(stream, activate, { timeoutMs = 2000 } = {}) {
  let closed = false, pending = false, buffer = Buffer.alloc(0), timer;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    stream.destroy();
  };
  stream.on('error', close);
  stream.on('end', close);
  stream.on('close', close);
  stream.unref?.();
  stream.on('data', bytes => {
    if (closed) return;
    if (pending) { close(); return; }
    buffer = Buffer.concat([buffer, bytes]);
    if (buffer.length > 1024) { close(); return; }
    const end = buffer.indexOf(10);
    if (end < 0) {
      timer ??= setTimeout(close, timeoutMs);
      timer.unref?.();
      return;
    }
    if (end !== buffer.length - 1) { close(); return; }
    let request;
    try { request = JSON.parse(buffer.subarray(0, end).toString('utf8')); } catch { close(); return; }
    if (!request || Object.keys(request).sort().join(',') !== 'action,id,version' ||
        request.version !== 1 || request.action !== 'activate' ||
        !Number.isSafeInteger(request.id) || request.id < 1) { close(); return; }
    buffer = Buffer.alloc(0);
    clearTimeout(timer);
    pending = true;
    timer = setTimeout(close, timeoutMs);
    timer.unref?.();
    Promise.resolve().then(activate).then(visible => {
      if (closed) return;
      if (typeof visible !== 'boolean') { close(); return; }
      clearTimeout(timer);
      timer = undefined;
      pending = false;
      stream.write(JSON.stringify({ version: 1, id: request.id, visible }) + '\n', error => { if (error) close(); });
    }, close);
  });
  return { close };
}

export function openLifecycle(descriptor, activate) {
  if (!descriptor.lifecycle) return { close() {} };
  if (descriptor.lifecycle.kind !== 'launcher-lifecycle-fd-v1' || descriptor.lifecycle.fd !== 6 || !fs.fstatSync(6).isSocket()) {
    throw Error('Blackcrab launcher lifecycle connection unavailable');
  }
  return serveLifecycle(new net.Socket({ fd: 6, readable: true, writable: true }), activate);
}
