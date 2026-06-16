import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import {
  MOCK_TRANSCRIPT_TAIL,
  type MessageId,
  type RemoteAttachment,
  type SessionId,
  type SessionState,
  type TranscriptEntry,
} from "@blackcrab/remote-protocol";

import { pickFile, pickPhoto, takePhoto } from "../attachments";
import { replyHaptic } from "../haptics";
import { Markdown } from "../components/Markdown";
import { firstUnreadIndex, latestEntryId } from "../transcriptDivider";
import { screenStyles } from "./styles";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Gentle, consistent layout transition used for new rows and expand/collapse. */
function easeNext() {
  LayoutAnimation.configureNext({
    duration: 220,
    create: { type: "easeInEaseOut", property: "opacity" },
    update: { type: "easeInEaseOut" },
  });
}

export interface TranscriptScreenProps {
  /** Live transcript tail pushed by the host. Falls back to mock when null. */
  entries?: TranscriptEntry[] | null;
  /** Show a loading spinner while the first transcript is still in flight. */
  loading?: boolean;
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
  /** Send a follow-up message (with optional attachments) to this session. */
  onSend?: (body: string, attachments?: RemoteAttachment[]) => void;
  /** Stop this session's current turn. */
  onStop?: () => void;
  /** Bumped by the host reporting a failed action; flips stuck sends to failed. */
  failSignal?: number;
  /** Called to advance the read cursor as the user views the conversation. */
  onMarkRead?: (messageId: MessageId) => void;
}

/** Collapse whitespace so an optimistic body can be matched to a host preview. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function TranscriptScreen({
  entries,
  loading = false,
  sessionId,
  title,
  connected = false,
  sessionState,
  lastReadMessageId,
  onBack,
  onSend,
  onStop,
  failSignal,
  onMarkRead,
}: TranscriptScreenProps) {
  const live = entries != null;
  const hostData = live ? entries : MOCK_TRANSCRIPT_TAIL;
  const listRef = useRef<FlatList<TranscriptEntry>>(null);
  const [draft, setDraft] = useState("");
  // Files staged in the composer, and whether a picker is currently open.
  const [pendingAttachments, setPendingAttachments] = useState<RemoteAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  // Locally-echoed sends, shown instantly until the host's tail reflects them.
  const [optimistic, setOptimistic] = useState<TranscriptEntry[]>([]);
  // Image/file bytes the phone picked this session, so a thumbnail can render
  // inline. Keyed by both the echo id (the optimistic bubble) and a normalized
  // body signature, so the preview survives reconciliation onto the host entry.
  const [sentAttachments, setSentAttachments] = useState<
    { id: string; sig: string; atts: RemoteAttachment[] }[]
  >([]);
  // True from the moment of a send until the host reports the turn running, so
  // the "thinking" indicator appears immediately rather than after a round-trip.
  const [justSent, setJustSent] = useState(false);
  // Assistant-message count captured at send time. The thinking indicator stays
  // up until the count grows (a real reply lands), so it never blanks out in the
  // gap between the session leaving "running" and the reply transcript arriving.
  const [assistantCountAtSend, setAssistantCountAtSend] = useState(0);
  // Optimistic echoes the host never reflected (failed/dropped/conflict) — so
  // the bubble shows "not delivered" instead of spinning on "sending…" forever.
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const optimisticSeq = useRef(0);
  // Generous: a send that wakes a dormant session (resume + read an attached
  // image) can take a while before the host echoes it back. Genuine failures
  // are reported immediately via action_failed, so this is just a backstop —
  // keep it long enough not to cry wolf mid-turn.
  const SEND_TIMEOUT_MS = 60000;

  // Drop optimistic echoes once a host user_message reflects them. The host
  // preview can be shorter (truncated) or longer (it appends an attachment
  // list), so accept a prefix match in either direction. An attachment-only
  // send (empty text) matches the host's "(see attached files)" placeholder.
  const pendingOptimistic = useMemo(
    () =>
      optimistic.filter((opt) => {
        const body = collapse(opt.preview);
        return !hostData.some((e) => {
          if (e.kind !== "user_message") return false;
          const hp = collapse(e.preview).replace(/[.…]+$/, "");
          if (!body) return hp.startsWith("(see attached files)");
          return hp.length > 0 && (body.startsWith(hp) || hp.startsWith(body));
        });
      }),
    [optimistic, hostData],
  );
  const data = useMemo(
    () => [...hostData, ...pendingOptimistic],
    [hostData, pendingOptimistic],
  );

  // Image/file bytes for a given message bubble, if the phone picked them this
  // session. Matches the optimistic echo by id, then falls back to the same
  // prefix match used for reconciliation so the host-reflected entry (whose
  // preview appends the attachment list) still resolves to its thumbnail.
  function attachmentsFor(entry: TranscriptEntry): RemoteAttachment[] | undefined {
    if (entry.kind !== "user_message" || sentAttachments.length === 0) return;
    const byId = sentAttachments.find((s) => s.id === entry.id);
    if (byId) return byId.atts;
    const hp = collapse(entry.preview).replace(/[.…]+$/, "");
    const bySig = sentAttachments.find((s) => {
      if (!s.sig) return hp.startsWith("(see attached files)");
      return hp.length > 0 && (s.sig.startsWith(hp) || hp.startsWith(s.sig));
    });
    return bySig?.atts;
  }

  const assistantCount = useMemo(
    () => hostData.filter((e) => e.kind === "assistant_message").length,
    [hostData],
  );

  // Track which echoes are still unreflected, so the send timeout can tell a
  // genuinely-stuck message from one the host already echoed back.
  const pendingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    pendingIdsRef.current = new Set(pendingOptimistic.map((o) => o.id));
  }, [pendingOptimistic]);

  // The host reported a failed action — flip any still-pending sends to failed
  // immediately rather than waiting for the timeout.
  const firstFailSignal = useRef(failSignal);
  useEffect(() => {
    if (failSignal === firstFailSignal.current) return;
    if (pendingIdsRef.current.size > 0) {
      setFailedIds((prev) => new Set([...prev, ...pendingIdsRef.current]));
    }
    setJustSent(false);
  }, [failSignal]);

  // Show the indicator while a send is awaiting its first reply (no new
  // assistant message since the send) or while the host reports the turn
  // running. Gating on the message count — not on sessionState alone — keeps the
  // dots up through the gap between "running" ending and the reply arriving.
  const awaitingReply = justSent && assistantCount <= assistantCountAtSend;
  const thinking = live && (awaitingReply || sessionState === "running");

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

  // Follow streaming output when the user is already at the bottom, and let
  // new rows / the thinking indicator animate in.
  const prevLenRef = useRef(data.length);
  useEffect(() => {
    if (data.length !== prevLenRef.current || thinking) {
      easeNext();
      prevLenRef.current = data.length;
    }
    if (atBottomRef.current) scrollToEnd(true);
  }, [data.length, thinking]);

  // Buzz softly when a new assistant message lands while viewing. The baseline
  // resets on session change / first load so pre-existing messages don't fire.
  const prevAssistantCountRef = useRef(assistantCount);
  useEffect(() => {
    prevAssistantCountRef.current = assistantCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, live]);
  useEffect(() => {
    if (live && assistantCount > prevAssistantCountRef.current) replyHaptic();
    prevAssistantCountRef.current = assistantCount;
  }, [assistantCount, live]);

  // Drop the just-sent bridge once a new assistant message actually lands in the
  // transcript (the count grows past what it was at send). Keying on the reply
  // arriving — rather than on sessionState leaving "running" — avoids the blank
  // gap that occurred when state changed before the reply transcript was pushed.
  useEffect(() => {
    if (justSent && assistantCount > assistantCountAtSend) {
      setJustSent(false);
      // A reply landed, so the send plainly went through — retract any
      // "not delivered" the timeout may have flagged in the meantime.
      setFailedIds((prev) => (prev.size > 0 ? new Set() : prev));
    }
  }, [justSent, assistantCount, assistantCountAtSend]);

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
    const atts = pendingAttachments;
    // Allow sending text, attachments, or both.
    if ((!body && atts.length === 0) || !connected || !onSend || !sessionId) {
      return;
    }
    optimisticSeq.current += 1;
    const echoId = `optimistic-${optimisticSeq.current}`;
    const echo: TranscriptEntry = {
      id: echoId,
      sessionId,
      kind: "user_message",
      createdAt: new Date().toISOString(),
      preview: body,
      truncated: false,
    };
    setOptimistic((prev) => [...prev, echo]);
    if (atts.length > 0) {
      setSentAttachments((prev) => [
        ...prev,
        { id: echoId, sig: collapse(body), atts },
      ]);
    }
    setAssistantCountAtSend(assistantCount);
    setJustSent(true);
    onSend(body, atts.length > 0 ? atts : undefined);
    setDraft("");
    setPendingAttachments([]);
    atBottomRef.current = true;
    scrollToEnd(true);
    // If the host never reflects this message, stop spinning and flag it.
    setTimeout(() => {
      if (pendingIdsRef.current.has(echoId)) {
        setFailedIds((prev) => new Set(prev).add(echoId));
        setJustSent(false);
      }
    }, SEND_TIMEOUT_MS);
  }

  const canSend =
    connected && (draft.trim().length > 0 || pendingAttachments.length > 0);

  async function runPicker(fn: () => Promise<RemoteAttachment | null>) {
    setAttaching(true);
    try {
      const att = await fn();
      if (att) setPendingAttachments((prev) => [...prev, att]);
    } catch (e) {
      Alert.alert("Couldn't attach", e instanceof Error ? e.message : String(e));
    } finally {
      setAttaching(false);
    }
  }

  function openAttachMenu() {
    if (attaching) return;
    Alert.alert("Add to message", undefined, [
      { text: "Photo Library", onPress: () => runPicker(pickPhoto) },
      { text: "Take Photo", onPress: () => runPicker(takePhoto) },
      { text: "File", onPress: () => runPicker(pickFile) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function removeAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
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

      {loading ? (
        <View style={localStyles.loading}>
          <ActivityIndicator color="#e26a4b" />
          <Text style={localStyles.loadingText}>Loading conversation…</Text>
        </View>
      ) : (
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
              <EntryView
                entry={item}
                pending={item.id.startsWith("optimistic-")}
                failed={failedIds.has(item.id)}
                attachments={attachmentsFor(item)}
              />
            </View>
          )}
          contentContainerStyle={localStyles.listContent}
          ItemSeparatorComponent={() => <View style={localStyles.separator} />}
          ListFooterComponent={thinking ? <ThinkingIndicator /> : null}
          onScrollToIndexFailed={() => {
            // Window not measured yet; leave the user at the top rather than crash.
          }}
          ListEmptyComponent={
            <Text style={screenStyles.note}>No transcript entries yet.</Text>
          }
        />
      )}

      {pendingAttachments.length > 0 && (
        <View style={localStyles.attachTray}>
          {pendingAttachments.map((a, i) => {
            const isImage =
              !!a.dataBase64 && (a.mimeType?.startsWith("image/") ?? false);
            return (
              <Pressable
                key={`${a.name}-${i}`}
                accessibilityRole="button"
                onPress={() => removeAttachment(i)}
                style={localStyles.attachChip}
              >
                {isImage ? (
                  <Image
                    source={{ uri: `data:${a.mimeType};base64,${a.dataBase64}` }}
                    style={localStyles.attachChipThumb}
                    resizeMode="cover"
                  />
                ) : null}
                <Text style={localStyles.attachChipText} numberOfLines={1}>
                  {isImage ? a.name : `📎 ${a.name}`}
                </Text>
                <Text style={localStyles.attachChipRemove}>✕</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={localStyles.composer}>
        <Pressable
          accessibilityRole="button"
          disabled={!connected || attaching}
          onPress={openAttachMenu}
          style={({ pressed }) => [
            localStyles.attachButton,
            (!connected || attaching) && localStyles.disabled,
            pressed && localStyles.pressed,
          ]}
        >
          <Text style={localStyles.attachButtonText}>+</Text>
        </Pressable>
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
          disabled={!canSend}
          onPress={handleSend}
          style={({ pressed }) => [
            localStyles.sendButton,
            !canSend && localStyles.disabled,
            pressed && localStyles.pressed,
          ]}
        >
          <Text style={localStyles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Three softly-pulsing dots — the "assistant is thinking" state. */
function ThinkingIndicator() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, {
            toValue: 1,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={localStyles.thinking}>
      <Text style={localStyles.roleLabel}>claude</Text>
      <View style={localStyles.dotRow}>
        {dots.map((v, i) => (
          <Animated.View
            key={i}
            style={[
              localStyles.dot,
              {
                opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
                transform: [
                  { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
                ],
              },
            ]}
          />
        ))}
      </View>
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

/** Renders a transcript entry with a treatment specific to its kind. */
function EntryView({
  entry,
  pending,
  failed,
  attachments,
}: {
  entry: TranscriptEntry;
  pending?: boolean;
  failed?: boolean;
  attachments?: RemoteAttachment[];
}) {
  if (entry.kind === "tool_call") {
    return <ToolCallCard toolName={entry.toolName} detail={entry.preview} />;
  }
  if (entry.kind === "tool_result") {
    return <ToolResultCard text={entry.preview} truncated={entry.truncated} />;
  }
  if (entry.kind === "system_notice") {
    return <Text style={localStyles.systemNotice}>{entry.preview}</Text>;
  }
  if (entry.kind === "thinking") {
    return (
      <View style={localStyles.msgBlock}>
        <Text style={localStyles.roleLabel}>thinking</Text>
        <Text style={localStyles.thinkingText}>{entry.preview}</Text>
      </View>
    );
  }
  const isUser = entry.kind === "user_message";
  return (
    <View style={localStyles.msgBlock}>
      <Text style={[localStyles.roleLabel, isUser && localStyles.roleLabelUser]}>
        {isUser ? "you" : "claude"}
        {pending && !failed ? "  ·  sending…" : ""}
        {failed ? "  ·  not delivered" : ""}
      </Text>
      <View style={isUser ? localStyles.userBody : undefined}>
        {entry.preview ? <Markdown text={entry.preview} /> : null}
        {attachments && attachments.length > 0 && (
          <View style={localStyles.attachGallery}>
            {attachments.map((a, i) => {
              const isImage =
                !!a.dataBase64 && (a.mimeType?.startsWith("image/") ?? false);
              if (isImage) {
                return (
                  <Image
                    key={`${a.name}-${i}`}
                    source={{ uri: `data:${a.mimeType};base64,${a.dataBase64}` }}
                    style={localStyles.attachThumb}
                    resizeMode="cover"
                    accessibilityLabel={a.name}
                  />
                );
              }
              return (
                <Text key={`${a.name}-${i}`} style={localStyles.attachListItem}>
                  📎 {a.name}
                </Text>
              );
            })}
          </View>
        )}
      </View>
      {failed && (
        <Text style={localStyles.failedNote}>
          The host didn’t confirm this message. It may be open in another window
          or on the desktop — try again from there.
        </Text>
      )}
      {entry.truncated && (
        <Text style={localStyles.truncated}>… open on desktop for the full message</Text>
      )}
    </View>
  );
}

const TOOL_GLYPH: Record<string, string> = {
  Bash: "❯",
  Read: "↗",
  Write: "✎",
  Edit: "✎",
  MultiEdit: "✎",
  Grep: "⌕",
  Glob: "⌕",
  WebFetch: "⊕",
  WebSearch: "⌕",
};

/** A tool invocation rendered as a minimalist terminal-style card. */
function ToolCallCard({
  toolName,
  detail,
}: {
  toolName?: string;
  detail: string;
}) {
  const name = toolName || "tool";
  const glyph = TOOL_GLYPH[name] ?? "•";
  return (
    <View style={localStyles.toolCard}>
      <View style={localStyles.toolHeader}>
        <Text style={localStyles.toolGlyph}>{glyph}</Text>
        <Text style={localStyles.toolName}>{name}</Text>
      </View>
      {detail ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={localStyles.toolBody}
        >
          <Text style={localStyles.mono}>{detail}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

/** A tool result, dimmed and collapsed when long. */
function ToolResultCard({ text, truncated }: { text: string; truncated?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = (text || "").split("\n");
  const isLong = lines.length > 6 || (text?.length ?? 0) > 320;
  const shown = open || !isLong ? text : lines.slice(0, 6).join("\n");
  if (!text) {
    return <Text style={localStyles.systemNotice}>tool finished</Text>;
  }
  return (
    <View style={localStyles.resultCard}>
      <View style={localStyles.toolBody}>
        <Text style={localStyles.mono}>
          {shown}
          {open || !isLong ? "" : "\n…"}
        </Text>
      </View>
      {isLong && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            easeNext();
            setOpen((o) => !o);
          }}
        >
          <Text style={localStyles.resultToggle}>{open ? "show less" : "show more"}</Text>
        </Pressable>
      )}
      {truncated && !open && (
        <Text style={localStyles.truncated}>… open on desktop for the full output</Text>
      )}
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
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: "#6b7480",
    fontSize: 13,
  },
  listContent: {
    paddingVertical: 8,
  },
  separator: {
    height: 18,
  },
  msgBlock: {
    gap: 6,
  },
  roleLabel: {
    color: "#6b7480",
    fontSize: 10.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  roleLabelUser: {
    color: "#e26a4b",
  },
  userBody: {
    borderLeftWidth: 2,
    borderLeftColor: "#e26a4b",
    paddingLeft: 12,
  },
  systemNotice: {
    color: "#6b7480",
    fontSize: 11.5,
    textAlign: "center",
    fontStyle: "italic",
    paddingVertical: 2,
  },
  truncated: {
    color: "#6b7480",
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 6,
  },
  failedNote: {
    color: "#e0896f",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  thinkingText: {
    color: "#aab2bb",
    fontSize: 14,
    lineHeight: 21,
    fontStyle: "italic",
  },
  dotRow: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e26a4b",
  },
  toolCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#242a31",
    backgroundColor: "#0e1216",
    overflow: "hidden",
  },
  toolHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1b2026",
  },
  toolGlyph: {
    color: "#e26a4b",
    fontSize: 13,
    fontWeight: "700",
  },
  toolName: {
    color: "#cfd5dc",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  toolBody: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mono: {
    fontFamily: "Menlo",
    fontSize: 12.5,
    lineHeight: 19,
    color: "#d7dde3",
  },
  resultCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1b2026",
    backgroundColor: "#0c0f13",
    opacity: 0.92,
  },
  resultToggle: {
    color: "#e26a4b",
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingBottom: 10,
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
  attachTray: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 8,
  },
  attachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2f37",
    backgroundColor: "#11151a",
  },
  attachChipThumb: {
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: "#0b0e12",
  },
  attachChipText: {
    flexShrink: 1,
    color: "#cfd5dc",
    fontSize: 12,
  },
  attachChipRemove: {
    color: "#6b7480",
    fontSize: 12,
    fontWeight: "700",
  },
  attachButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2f37",
    backgroundColor: "#11151a",
  },
  attachButtonText: {
    color: "#cfd5dc",
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "400",
  },
  attachListItem: {
    color: "#9aa3ad",
    fontSize: 12.5,
  },
  attachGallery: {
    marginTop: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  attachThumb: {
    width: 160,
    height: 160,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2f37",
    backgroundColor: "#0b0e12",
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
