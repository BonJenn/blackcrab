import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MOCK_SESSIONS, type SessionSummary } from "@blackcrab/remote-protocol";

import type { Transport, TransportStatus } from "../transport/types";
import { screenStyles } from "./styles";

export interface SessionsScreenProps {
  /** Live connection to the active host, when one is paired and connected. */
  transport?: Transport | null;
  /** Status of the active transport, used to enable/disable controls. */
  status?: TransportStatus | null;
}

export function SessionsScreen({ transport, status }: SessionsScreenProps) {
  const connected = status?.state === "connected" && Boolean(transport);

  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Sessions</Text>
      <Text style={screenStyles.note}>
        {connected
          ? "Mocked sessions — actions are sent over the live connection. Real session data lands next."
          : "Mocked sessions. Connect to a host to send messages or stop a session."}
      </Text>
      <FlatList
        data={MOCK_SESSIONS}
        keyExtractor={(item) => `${item.hostId}:${item.sessionId}`}
        renderItem={({ item }) => (
          <SessionRow
            session={item}
            transport={transport ?? null}
            connected={connected}
          />
        )}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
      />
    </View>
  );
}

function SessionRow({
  session,
  transport,
  connected,
}: {
  session: SessionSummary;
  transport: Transport | null;
  connected: boolean;
}) {
  const [draft, setDraft] = useState("");

  function handleSend() {
    const body = draft.trim();
    if (!body || !transport) return;
    const sent = transport.sendAction({
      type: "send_message",
      hostId: session.hostId,
      sessionId: session.sessionId,
      body,
    });
    if (sent) setDraft("");
  }

  function handleStop() {
    transport?.sendAction({
      type: "stop_session",
      hostId: session.hostId,
      sessionId: session.sessionId,
    });
  }

  return (
    <View style={localStyles.row}>
      <View style={localStyles.rowHeader}>
        <View style={localStyles.rowMain}>
          <Text style={localStyles.title}>{session.title}</Text>
          <Text style={localStyles.meta}>
            {session.model} · {session.state.replace("_", " ")}
          </Text>
        </View>
        {session.pendingApprovalCount > 0 && (
          <Text style={localStyles.badge}>
            {session.pendingApprovalCount} pending
          </Text>
        )}
      </View>
      <View style={localStyles.actions}>
        <TextInput
          style={localStyles.input}
          value={draft}
          onChangeText={setDraft}
          editable={connected}
          placeholder={connected ? "Send a follow-up…" : "Not connected"}
          placeholderTextColor="#6b7480"
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <Pressable
          accessibilityRole="button"
          disabled={!connected || draft.trim().length === 0}
          onPress={handleSend}
          style={({ pressed }) => [
            localStyles.button,
            localStyles.sendButton,
            (!connected || draft.trim().length === 0) && localStyles.buttonDisabled,
            pressed && localStyles.buttonPressed,
          ]}
        >
          <Text style={localStyles.buttonText}>Send</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!connected}
          onPress={handleStop}
          style={({ pressed }) => [
            localStyles.button,
            localStyles.stopButton,
            !connected && localStyles.buttonDisabled,
            pressed && localStyles.buttonPressed,
          ]}
        >
          <Text style={localStyles.buttonText}>Stop</Text>
        </Pressable>
      </View>
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
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowMain: {
    flex: 1,
  },
  title: {
    color: "#f4f6f8",
    fontSize: 15,
    fontWeight: "500",
  },
  meta: {
    color: "#9aa3ad",
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    color: "#e26a4b",
    fontSize: 12,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#11151a",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f242b",
    color: "#f4f6f8",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  button: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  sendButton: {
    backgroundColor: "#e26a4b",
  },
  stopButton: {
    backgroundColor: "#2a2f37",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#f4f6f8",
    fontSize: 14,
    fontWeight: "600",
  },
});
