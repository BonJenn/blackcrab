import { FlatList, StyleSheet, Text, View } from "react-native";
import { MOCK_SESSIONS, type SessionSummary } from "@blackcrab/remote-protocol";

import { screenStyles } from "./styles";

export function SessionsScreen() {
  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Sessions</Text>
      <Text style={screenStyles.note}>
        Mocked sessions. Connecting to a real host will replace this list.
      </Text>
      <FlatList
        data={MOCK_SESSIONS}
        keyExtractor={(item) => `${item.hostId}:${item.sessionId}`}
        renderItem={({ item }) => <SessionRow session={item} />}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
      />
    </View>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  return (
    <View style={localStyles.row}>
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
    paddingVertical: 12,
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
});
