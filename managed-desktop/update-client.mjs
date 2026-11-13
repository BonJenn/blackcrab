import fs from 'node:fs';
import net from 'node:net';
const statuses = new Set(['idle','checking','available','up-to-date','downloading','downloaded','error']);
export function validateUpdateReply(value) {
  const s = value?.state;
  if (typeof value?.accepted !== 'boolean' || !s || !statuses.has(s.status) ||
      typeof s.currentVersion !== 'string' || s.currentVersion.length > 80 ||
      !(s.availableVersion === null || typeof s.availableVersion === 'string' && s.availableVersion.length <= 80) ||
      !(s.downloadPercent === null || Number.isFinite(s.downloadPercent) && s.downloadPercent >= 0 && s.downloadPercent <= 100) ||
      typeof s.installing !== 'boolean' || !(s.message === null || typeof s.message === 'string' && s.message.length <= 2048)) throw Error('Invalid launcher update response');
  return value;
}
/** One serialized, bounded channel; authority comes only from the inherited socket. */
export function createUpdateClient(stream) {
  let closed = false, pending = null, buffer = '';
  let tail = Promise.resolve();
  const fail = () => {
    if (closed) return;
    closed = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(Error('Blackcrab update connection closed. Reopen the app and try again.')); pending = null; }
    stream.destroy();
  };
  stream.on('data', bytes => {
    buffer += bytes.toString('utf8');
    if (Buffer.byteLength(buffer) > 16384) { fail(); return; }
    const end = buffer.indexOf('\n'); if (end < 0) return;
    if (!pending || end !== buffer.length - 1) { fail(); return; }
    const current = pending;
    try { const result = validateUpdateReply(JSON.parse(buffer.slice(0, end))); buffer = ''; pending = null; clearTimeout(current.timer); current.resolve(result); } catch { fail(); }
  });
  stream.on('error', fail); stream.on('end', fail); stream.on('close', fail); stream.unref?.();
  return { close: fail, request(action, expectedVersion = null) {
    if (!['status','check','download','install'].includes(action) || !(expectedVersion === null || typeof expectedVersion === 'string' && expectedVersion.length <= 80)) return Promise.reject(Error('Invalid update action'));
    const task = tail.then(() => new Promise((resolve, reject) => {
      if (closed) { reject(Error('Blackcrab update connection closed. Reopen the app and try again.')); return; }
      const timer = setTimeout(fail, 10000); timer.unref?.(); pending = { resolve, reject, timer };
      stream.write(JSON.stringify({action, expectedVersion}) + '\n', error => { if (error) fail(); });
    }));
    tail = task.catch(() => {}); return task;
  } };
}
export function openUpdateClient(control) {
  if (control.kind !== 'launcher-updates-fd-v1' || control.fd !== 5 || !fs.fstatSync(5).isSocket()) throw Error('Blackcrab launcher update connection unavailable');
  return createUpdateClient(new net.Socket({fd:5, readable:true, writable:true}));
}
