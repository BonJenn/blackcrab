import { FlatList, StyleSheet, Text, View } from "react-native";
import { MOCK_APPROVALS, type ApprovalRequest } from "@blackcrab/remote-protocol";

import { screenStyles } from "./styles";

export function ApprovalScreen() {
  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Needs your attention</Text>
      <Text style={screenStyles.note}>
        Approve and deny actions are wired through the protocol but inactive
        until a host connection exists.
      </Text>
      <FlatList
        data={MOCK_APPROVALS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ApprovalRow approval={item} />}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
        ListEmptyComponent={
          <Text style={localStyles.empty}>Nothing waiting.</Text>
        }
      />
    </View>
  );
}

function ApprovalRow({ approval }: { approval: ApprovalRequest }) {
  return (
    <View style={localStyles.row}>
      <Text style={localStyles.kind}>{approval.kind.replace("_", " ")}</Text>
      <Text style={localStyles.summary}>{approval.summary}</Text>
      <View style={localStyles.actions}>
        <Text style={[localStyles.action, localStyles.approve]}>Approve</Text>
        <Text style={[localStyles.action, localStyles.deny]}>Deny</Text>
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
  kind: {
    color: "#9aa3ad",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summary: {
    color: "#f4f6f8",
    fontSize: 14,
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    marginTop: 8,
    gap: 12,
  },
  action: {
    fontSize: 13,
    fontWeight: "600",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    overflow: "hidden",
  },
  approve: {
    color: "#0b0d10",
    backgroundColor: "#7ad48a",
  },
  deny: {
    color: "#f4f6f8",
    backgroundColor: "#3a2229",
  },
  empty: {
    color: "#6b7480",
    fontSize: 13,
    paddingVertical: 24,
    textAlign: "center",
  },
});
