// @effect-diagnostics nodeBuiltinImport:off - Atomic rename, inode hard-link recovery and fsync require native descriptor operations; errors are mapped by WorkspaceFileSystem.
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Serialize writes through this host, including legacy file saves. Provider processes do not
// share this queue: check again before rename and retain the old inode as a recovery copy.
const queues = new Map<string, Promise<unknown>>();
export async function ideWriteFile(target: string, contents: string, expected?: string) {
  const previous = queues.get(target) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (expected === undefined) {
      await fs.writeFile(target, contents, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0) });
      return {};
    }
    if (Buffer.byteLength(contents) > 2 * 1024 * 1024) throw Error("IDE file exceeds 2 MiB save limit");
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error("IDE saves require a regular existing file");
    const bytes = await fs.readFile(target);
    if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== expected) return { conflict: true };
    const token = randomUUID();
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.blackcrab-ide-${token}.tmp`);
    const recoveryPath = path.join(path.dirname(target), `.${path.basename(target)}.blackcrab-ide-${token}.bak`);
    try {
      const handle = await fs.open(temporary, "wx", stat.mode & 0o777);
      try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
      // A hard link retains the original inode even across the replacement, including a provider
      // still writing through an open descriptor. Never overwrite or delete this recovery copy.
      await fs.link(target, recoveryPath);
      const current = await fs.lstat(target);
      if (current.ino !== stat.ino || current.dev !== stat.dev || !(await fs.readFile(target)).equals(bytes)) {
        return { conflict: true, recoveryPath };
      }
      await fs.rename(temporary, target);
      return { conflict: false, recoveryPath };
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  queues.set(target, next);
  try { return await next; } finally { if (queues.get(target) === next) queues.delete(target); }
}
