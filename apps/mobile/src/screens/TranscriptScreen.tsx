import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  MOCK_TRANSCRIPT_TAIL,
  type MessageId,
  type SessionId,
  type SessionState,
  type TranscriptEntry,
} from "@blackcrab/remote-protocol";

import { firstUnreadIndex, latestEntryId } from "../transcriptDivider";
import { screenStyles } from "./styles";

export interface TranscriptScreenProps {
  /** Live transcript tail pushed by the host. Falls back to mock when null. */
  entries?: TranscriptEntry[] | null;
  /** The session being viewed, used to freeze the divider per conversation. */
  sessionId?: SessionId | null;
  /** Conversation title, shown in the header. */
  title?: string;
  /** Whether the active transport is connected (enables the composer). */
  connected?: boolean;
  /** Live state of this session, drives the "thinking" indicator. */
  sessionState?: SessionState;
  /** Host-canonical last-read message id for this session, if known. */
  lastReadMessageId?: MessageId | null;
  /** Dismiss the detail and slide back to the list. */
  onBack?: () => void;
  /** Send a follow-up message to this session. */
  onSend?: (body: string) => void;
  /** Stop this session's current turn. */
  onStop?: () => void;
  /** Called to advance the read cursor as the user views the conversation. */
  onMarkRead?: (messageId: MessageId) => void;
}

/** Collapse whitespace so an optimistic body can be matched to a host preview. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function TranscriptScreen({
  entries,
  sessionId,
  title,
  connected = false,
  sessionState,
  lastReadMessageId,
  onBack,
  onSend,
  onStop,
  onMarkRead,
}: TranscriptScreenProps) {
  const live = entries != null;
  const hostData = live ? entries : MOCK_TRANSCRIPT_TAIL;
  const listRef = useRef<FlatList<TranscriptEntry>>(null);
  const [draft, setDraft] = useState("");
  // Locally-echoed sends, shown instantly until the host's tail reflects them.
  const [optimistic, setOptimistic] = useState<TranscriptEntry[]>([]);
  // True from the moment of a send until the host reports the turn running, so
  // the "thinking" indicator appears immediately rather than after a round-trip.
  const [justSent, setJustSent] = useState(false);
  const optimisticSeq = useRef(0);

  // Drop optimistic echoes once a host user_message reflects them (its preview
  // is a prefix of the sent body, since the host truncates/collapses previews).
  const pendingOptimistic = useMemo(
    () =>
      optimistic.filter((opt) => {
        const body = collapse(opt.preview);
        return !hostData.some((e) => {
          if (e.kind !== "user_message") return false;
          const hp = collapse(e.preview).replace(/[.…]+$/, "");
          return hp.length > 0 && body.startsWith(hp);
        });
      }),
    [optimistic, hostData],
  );
  const data = useMemo(
    () => [...hostData, ...pendingOptimistic],
    [hostData, pendingOptimistic],
  );

  const thinking =
    live && (justSent || sessionState === "running");

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
  const dividerIndex = firstUnreadIndex(hostData, anchorRef.current.messageId);

  // Stick to the bottom and follow new messages, unless we opened onto unread
  // (then we land at the divider until the user scrolls down).
  const atBottomRef = useRef(true);
  useEffect(() => {
    atBottomRef.current = dividerIndex < 0;
  }, [sessionId, dividerIndex]);

  function scrollToEnd(animated: boolean) {
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToEnd({ animated });
      } catch {
        // best effort
      }
    });
  }

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

  // Follow streaming output when the user is already at the bottom.
  useEffect(() => {
    if (atBottomRef.current) scrollToEnd(true);
  }, [data.length, thinking]);

  // Once the host reports the turn running (or a reply lands), the live state
  // drives the indicator — drop the transient just-sent bridge.
  useEffect(() => {
    if (sessionState === "running") return;
    const last = hostData[hostData.length - 1];
    if (last && last.kind === "assistant_message") setJustSent(false);
  }, [sessionState, hostData]);

  // Viewing the conversation marks it read up to the newest host entry.
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!live || !sessionId || !onMarkRead) return;
    const latest = latestEntryId(hostData);
    if (!latest) return;
    const key = `${sessionId}:${latest}`;
    if (lastMarkedRef.current === key) return;
    lastMarkedRef.current = key;
    onMarkRead(latest);
  }, [live, sessionId, hostData, onMarkRead]);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    atBottomRef.current = distance < 48;
  }

  function handleSend() {
    const body = draft.trim();
    if (!body || !connected || !onSend || !sessionId) return;
    optimisticSeq.current += 1;
    const echo: TranscriptEntry = {
      id: `optimistic-${optimisticSeq.current}`,
      sessionId,
      kind: "user_message",
      createdAt: new Date().toISOString(),
      preview: body,
      truncated: false,
    };
    setOptimistic((prev) => [...prev, echo]);
    setJustSent(true);
    onSend(body);
    setDraft("");
    atBottomRef.current = true;
    scrollToEnd(true);
  }

  return (
    <KeyboardAvoidingView
      style={screenStyles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={localStyles.header}>
        <Text
          accessibilityRole="button"
          onPress={onBack}
          style={localStyles.back}
        >
          ‹ Chats
        </Text>
        <Text style={localStyles.headerTitle} numberOfLines={1}>
          {title ?? "Transcript"}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={!connected}
          onPress={onStop}
          style={({ pressed }) => [
            localStyles.stopButton,
            !connected && localStyles.disabled,
            pressed && localStyles.pressed,
          ]}
        >
          <Text style={localStyles.stopText}>Stop</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        style={localStyles.list}
        data={data}
        keyExtractor={(item) => item.id}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        renderItem={({ item, index }) => (
          <View>
            {index === dividerIndex && <NewMessagesDivider />}
            <TranscriptRow entry={item} pending={item.id.startsWith("optimistic-")} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
        ListFooterComponent={thinking ? <ThinkingIndicator /> : null}
        onScrollToIndexFailed={() => {
          // Window not measured yet; leave the user at the top rather than crash.
        }}
        ListEmptyComponent={
          <Text style={screenStyles.note}>No transcript entries yet.</Text>
        }
      />

      <View style={localStyles.composer}>
        <TextInput
          style={localStyles.input}
          value={draft}
          onChangeText={setDraft}
          editable={connected}
          placeholder={connected ? "Message…" : "Not connected"}
          placeholderTextColor="#6b7480"
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline
        />
        <Pressable
          accessibilityRole="button"
          disabled={!connected || draft.trim().length === 0}
          onPress={handleSend}
          style={({ pressed }) => [
            localStyles.sendButton,
            (!connected || draft.trim().length === 0) && localStyles.disabled,
            pressed && localStyles.pressed,
          ]}
        >
          <Text style={localStyles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ThinkingIndicator() {
  return (
    <View style={localStyles.thinking}>
      <ActivityIndicator size="small" color="#e26a4b" />
      <Text style={localStyles.thinkingText}>assistant is thinking…</Text>
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

function TranscriptRow({
  entry,
  pending,
}: {
  entry: TranscriptEntry;
  pending?: boolean;
}) {
  return (
    <View style={[localStyles.row, pending && localStyles.rowPending]}>
      <Text style={localStyles.kind}>
        {entry.kind.replace("_", " ")}
        {pending ? " · sending…" : ""}
      </Text>
      <Text style={localStyles.preview}>{entry.preview}</Text>
      {entry.truncated && <Text style={localStyles.truncated}>Truncated by host</Text>}
    </View>
  );
}

const localStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f242b",
  },
  back: {
    color: "#e26a4b",
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    flex: 1,
    color: "#f4f6f8",
    fontSize: 16,
    fontWeight: "600",
  },
  stopButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#2a2f37",
  },
  stopText: {
    color: "#f4f6f8",
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    flex: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#1f242b",
  },
  row: {
    paddingVertical: 12,
  },
  rowPending: {
    opacity: 0.6,
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
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  thinkingText: {
    color: "#9aa3ad",
    fontSize: 13,
    fontStyle: "italic",
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
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1f242b",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: "#11151a",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f242b",
    color: "#f4f6f8",
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  sendButton: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#e26a4b",
  },
  sendText: {
    color: "#f4f6f8",
    fontSize: 14,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
