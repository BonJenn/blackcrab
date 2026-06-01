import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { MOCK_APPROVALS, type ApprovalRequest } from "@blackcrab/remote-protocol";

import type { Transport } from "../transport/types";
import { screenStyles } from "./styles";

export interface ApprovalScreenProps {
  /** Live connection to the active host, when paired and connected. */
  transport?: Transport | null;
  /** Pending approvals pushed by the host. Null until a host connects. */
  approvals?: ApprovalRequest[] | null;
}

export function ApprovalScreen({ transport, approvals }: ApprovalScreenProps) {
  const live = approvals != null && transport != null;
  const data = live ? approvals : MOCK_APPROVALS;

  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Needs your attention</Text>
      <Text style={screenStyles.note}>
        {live
          ? "Live permission prompts from the connected host. Approve or deny without leaving your phone."
          : "Approve and deny are wired through the protocol but inactive until a host connection exists."}
      </Text>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ApprovalRow
            approval={item}
            transport={live ? transport : null}
          />
        )}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
        ListEmptyComponent={
          <Text style={localStyles.empty}>Nothing waiting.</Text>
        }
      />
    </View>
  );
}

function ApprovalRow({
  approval,
  transport,
}: {
  approval: ApprovalRequest;
  transport: Transport | null;
}) {
  const enabled = transport != null;

  function resolve(decision: "approve" | "deny") {
    if (!transport) return;
    if (decision === "approve") {
      transport.sendAction({
        type: "approve",
        hostId: approval.hostId,
        approvalId: approval.id,
      });
    } else {
      transport.sendAction({
        type: "deny",
        hostId: approval.hostId,
        approvalId: approval.id,
      });
    }
  }

  return (
    <View style={localStyles.row}>
      <Text style={localStyles.kind}>{approval.kind.replace("_", " ")}</Text>
      <Text style={localStyles.summary}>{approval.summary}</Text>
      <View style={localStyles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={!enabled}
          onPress={() => resolve("approve")}
          style={({ pressed }) => [
            localStyles.action,
            localStyles.approve,
            !enabled && localStyles.disabled,
            pressed && localStyles.pressed,
          ]}
        >
          <Text style={localStyles.approveText}>Approve</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!enabled}
          onPress={() => resolve("deny")}
          style={({ pressed }) => [
            localStyles.action,
            localStyles.deny,
            !enabled && localStyles.disabled,
            pressed && localStyles.pressed,
          ]}
        >
          <Text style={localStyles.denyText}>Deny</Text>
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
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  approve: {
    backgroundColor: "#7ad48a",
  },
  approveText: {
    color: "#0b0d10",
    fontSize: 13,
    fontWeight: "600",
  },
  deny: {
    backgroundColor: "#3a2229",
  },
  denyText: {
    color: "#f4f6f8",
    fontSize: 13,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
  empty: {
    color: "#6b7480",
    fontSize: 13,
    paddingVertical: 24,
    textAlign: "center",
  },
});
