import { useEffect, useRef } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import {
  MOCK_TRANSCRIPT_TAIL,
  type MessageId,
  type SessionId,
  type TranscriptEntry,
} from "@blackcrab/remote-protocol";

import { firstUnreadIndex, latestEntryId } from "../transcriptDivider";
import { screenStyles } from "./styles";

export interface TranscriptScreenProps {
  /** Live transcript tail pushed by the host. Falls back to mock when null. */
  entries?: TranscriptEntry[] | null;
  /** The session being viewed, used to freeze the divider per conversation. */
  sessionId?: SessionId | null;
  /** Host-canonical last-read message id for this session, if known. */
  lastReadMessageId?: MessageId | null;
  /** Called to advance the read cursor as the user views the conversation. */
  onMarkRead?: (messageId: MessageId) => void;
}

export function TranscriptScreen({
  entries,
  sessionId,
  lastReadMessageId,
  onMarkRead,
}: TranscriptScreenProps) {
  const live = entries != null;
  const data = live ? entries : MOCK_TRANSCRIPT_TAIL;
  const listRef = useRef<FlatList<TranscriptEntry>>(null);

  // Freeze the divider anchor at the cursor value captured when this session
  // was opened, so marking messages read while viewing doesn't move the line.
  const anchorRef = useRef<{ sessionId: SessionId | null; messageId: MessageId | null }>(
    { sessionId: null, messageId: null },
  );
  if (anchorRef.current.sessionId !== (sessionId ?? null)) {
    anchorRef.current = {
      sessionId: sessionId ?? null,
      messageId: lastReadMessageId ?? null,
    };
  }
  const dividerIndex = firstUnreadIndex(data, anchorRef.current.messageId);

  // Land on the first unread message when opening, instead of the bottom.
  useEffect(() => {
    if (dividerIndex <= 0) return;
    const id = requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          index: dividerIndex,
          viewPosition: 0.15,
          animated: false,
        });
      } catch {
        // Best effort — onScrollToIndexFailed covers out-of-range attempts.
      }
    });
    return () => cancelAnimationFrame(id);
    // Re-run when the opened session changes, not on every cursor tick.
  }, [sessionId, dividerIndex]);

  // Viewing the conversation marks it read up to the newest entry.
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!live || !sessionId || !onMarkRead) return;
    const latest = latestEntryId(data);
    if (!latest) return;
    const key = `${sessionId}:${latest}`;
    if (lastMarkedRef.current === key) return;
    lastMarkedRef.current = key;
    onMarkRead(latest);
  }, [live, sessionId, data, onMarkRead]);

  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Transcript</Text>
      <Text style={screenStyles.note}>
        {live
          ? "Live tail of the focused session. Full transcripts stay on the desktop."
          : "Read-only previews are intentional. Full transcripts stay on the desktop host."}
      </Text>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <View>
            {index === dividerIndex && <NewMessagesDivider />}
            <TranscriptRow entry={item} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
        onScrollToIndexFailed={() => {
          // Window not measured yet; leave the user at the top rather than crash.
        }}
        ListEmptyComponent={
          <Text style={screenStyles.note}>No transcript entries yet.</Text>
        }
      />
    </View>
  );
}

function NewMessagesDivider() {
  return (
    <View style={localStyles.divider}>
      <View style={localStyles.dividerLine} />
      <Text style={localStyles.dividerLabel}>new messages</Text>
      <View style={localStyles.dividerLine} />
    </View>
  );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  return (
    <View style={localStyles.row}>
      <Text style={localStyles.kind}>{entry.kind.replace("_", " ")}</Text>
      <Text style={localStyles.preview}>{entry.preview}</Text>
      {entry.truncated && <Text style={localStyles.truncated}>Truncated by host</Text>}
    </View>
  );
}

const localStyles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#1f242b",
  },
  row: {
    paddingVertical: 12,
  },
  kind: {
    color: "#9aa3ad",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  preview: {
    color: "#f4f6f8",
    fontSize: 14,
    marginTop: 4,
  },
  truncated: {
    color: "#6b7480",
    fontSize: 11,
    marginTop: 4,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#e26a4b",
  },
  dividerLabel: {
    color: "#e26a4b",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
