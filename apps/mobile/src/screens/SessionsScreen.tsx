import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MOCK_SESSIONS, type SessionSummary } from "@blackcrab/remote-protocol";

import type { Transport, TransportStatus } from "../transport/types";
import { screenStyles } from "./styles";

/** Compact "3m"/"2h"/"5d" style age from an ISO-8601 timestamp. */
function relativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "now";
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  return `${Math.floor(diff / day)}d`;
}

export interface SessionsScreenProps {
  /** Live connection to the active host, when one is paired and connected. */
  transport?: Transport | null;
  /** Status of the active transport, used to enable/disable controls. */
  status?: TransportStatus | null;
  /** Live sessions pushed by the host. Falls back to mock fixtures when null. */
  sessions?: SessionSummary[] | null;
  /** Open a session's transcript (slide-over detail). */
  onOpenSession?: (session: SessionSummary) => void;
}

export function SessionsScreen({
  transport,
  status,
  sessions,
  onOpenSession,
}: SessionsScreenProps) {
  const connected = status?.state === "connected" && Boolean(transport);
  const live = sessions != null;
  const data = live ? sessions : MOCK_SESSIONS;

  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Chats</Text>
      <Text style={screenStyles.note}>
        {live
          ? "Tap a conversation to open it."
          : connected
            ? "Waiting for the host's session list…"
            : "Mocked sessions. Connect to a host to open a conversation."}
      </Text>
      <FlatList
        data={data}
        keyExtractor={(item) => `${item.hostId}:${item.sessionId}`}
        renderItem={({ item }) => (
          <SessionRow
            session={item}
            connected={connected}
            onOpenSession={onOpenSession}
          />
        )}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
      />
    </View>
  );
}

function SessionRow({
  session,
  connected,
  onOpenSession,
}: {
  session: SessionSummary;
  connected: boolean;
  onOpenSession?: (session: SessionSummary) => void;
}) {
  const openable = connected && Boolean(onOpenSession);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!openable}
      onPress={() => onOpenSession?.(session)}
      style={({ pressed }) => [
        localStyles.row,
        pressed && openable && localStyles.rowPressed,
      ]}
    >
      <View style={localStyles.rowMain}>
        <View style={localStyles.titleRow}>
          {session.unreadCount > 0 && <View style={localStyles.unreadDot} />}
          <Text
            style={[
              localStyles.title,
              session.unreadCount > 0 && localStyles.titleUnread,
            ]}
            numberOfLines={1}
          >
            {session.title}
          </Text>
        </View>
        <Text style={localStyles.meta} numberOfLines={1}>
          {session.model} · {session.state.replace("_", " ")}
          {session.updatedAt ? ` · ${relativeTime(session.updatedAt)}` : ""}
        </Text>
      </View>
      {session.pendingApprovalCount > 0 && (
        <Text style={localStyles.badge}>{session.pendingApprovalCount}</Text>
      )}
      {openable && <Text style={localStyles.chevron}>›</Text>}
    </Pressable>
  );
}

const localStyles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#1f242b",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowMain: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e26a4b",
  },
  title: {
    flexShrink: 1,
    color: "#f4f6f8",
    fontSize: 15,
    fontWeight: "500",
  },
  titleUnread: {
    fontWeight: "700",
  },
  meta: {
    color: "#9aa3ad",
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    minWidth: 20,
    textAlign: "center",
    color: "#0b0d10",
    backgroundColor: "#e26a4b",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
  },
  chevron: {
    color: "#6b7480",
    fontSize: 20,
    fontWeight: "400",
  },
});
