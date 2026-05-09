export type SessionRecord = { id: string };
export type SessionInfoUpdater<T extends SessionRecord> = (session: T) => T;

export function patchSessionInfoList<T extends SessionRecord>(
  sessions: T[],
  id: string,
  updater: SessionInfoUpdater<T>,
): T[] {
  let changed = false;
  const next = sessions.map((session) => {
    if (session.id !== id) return session;
    changed = true;
    return updater(session);
  });
  return changed ? next : sessions;
}

export function removeSessionInfoFromList<T extends SessionRecord>(
  sessions: T[],
  id: string,
): T[] {
  const next = sessions.filter((session) => session.id !== id);
  return next.length === sessions.length ? sessions : next;
}
