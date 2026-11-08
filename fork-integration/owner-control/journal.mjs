import { open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const LIMIT = 1024 * 1024;
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const exact = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join('\0') === names.sort().join('\0');
function validate(value) {
  if (!exact(value, ['environmentId', 'epoch', 'sequence', 'revision', 'requests']) ||
      !token(value.environmentId) || !token(value.epoch) ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      value.revision > value.sequence || !Array.isArray(value.requests) || value.requests.length > 1024 ||
      value.requests.some(x => !exact(x, ['id', 'phase']) || !token(x.id) ||
        !['pending', 'complete'].includes(x.phase)) ||
      new Set(value.requests.map(x => x.id)).size !== value.requests.length)
    throw new Error('Invalid owner journal');
  return value;
}
/** Parent must already be verified private and exclusively owned by native startup.
 * A file descriptor, rather than a path stat followed by readFile, binds verification to bytes.
 * Any failed commit makes this writer unusable: rename/fsync failure may have published state.
 */
export function createFileJournal(path) {
  let sequence, loaded = false, writing = false, failed = false;
  return {
    async load() {
      if (loaded || writing || failed) throw new Error('Owner journal already initialized');
      loaded = true;
      let handle;
      try {
        if (constants.O_NOFOLLOW === undefined || typeof process.getuid !== 'function')
          throw new Error('Private owner journals unsupported on this platform');
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await handle.stat();
        if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 ||
            (stat.mode & 0o777) !== 0o600 || stat.size > LIMIT)
          throw new Error('Invalid private owner journal file');
        // Bound the read even if a writer violates exclusive ownership and grows the file.
        const bytes = Buffer.alloc(LIMIT + 1);
        let length = 0;
        while (length < bytes.length) {
          const result = await handle.read(bytes, length, bytes.length - length, length);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        if (length > LIMIT) throw new Error('Owner journal too large');
        const value = validate(JSON.parse(bytes.subarray(0, length).toString('utf8')));
        sequence = value.sequence;
        return value;
      } catch (error) {
        if (error.code === 'ENOENT') { sequence = 0; return null; }
        failed = true;
        throw error;
      } finally { await handle?.close(); }
    },
    async commit(expected, value) {
      if (!loaded || failed || writing || sequence !== expected ||
          !Number.isSafeInteger(expected + 1) || value.sequence !== expected + 1)
        throw new Error('Journal sequence conflict or unavailable writer');
      validate(value);
      // Capture the complete input before the first await; callers cannot mutate persisted bytes.
      const bytes = JSON.stringify(value) + '\n';
      if (Buffer.byteLength(bytes) > LIMIT) throw new Error('Owner journal too large');
      const nextSequence = value.sequence;
      const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}`);
      writing = true;
      let handle, created = false, published = false;
      try {
        handle = await open(temp, 'wx', 0o600);
        created = true;
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close(); handle = undefined;
        await rename(temp, path); published = true;
        const directory = await open(dirname(path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
        sequence = nextSequence;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        await handle?.close().catch(() => {});
        if (created && !published) await unlink(temp).catch(() => {});
        writing = false;
      }
    },
  };
}
