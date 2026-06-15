import type { MessageId, TranscriptEntry } from "@blackcrab/remote-protocol";

/**
 * Index of the first unread entry — where the "— new messages —" divider goes.
 *
 * Returns -1 (no divider) when:
 *   - there is no read cursor yet (never read, or cache miss),
 *   - the cursor's message isn't in the loaded window (older than the tail, so
 *     we can't place the divider reliably), or
 *   - the cursor is already at/after the last entry (nothing new).
 *
 * Otherwise returns the index just after the last-read entry.
 */
export function firstUnreadIndex(
  entries: readonly TranscriptEntry[],
  lastReadMessageId: MessageId | null | undefined,
): number {
  if (!lastReadMessageId || entries.length === 0) return -1;
  const readIdx = entries.findIndex((e) => e.id === lastReadMessageId);
  if (readIdx < 0) return -1;
  const next = readIdx + 1;
  return next < entries.length ? next : -1;
}

/** The id of the newest entry, or null when there are none. */
export function latestEntryId(
  entries: readonly TranscriptEntry[],
): MessageId | null {
  return entries.length > 0 ? entries[entries.length - 1].id : null;
}
