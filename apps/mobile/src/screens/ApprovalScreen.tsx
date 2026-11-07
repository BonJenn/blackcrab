import { useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { type ApprovalRequest } from "@blackcrab/remote-protocol";

import type { Transport, TransportStatus } from "../transport/types";
import { screenStyles } from "./styles";

export interface ApprovalScreenProps {
  /** Live connection to the active host, when paired and connected. */
  transport?: Transport | null;
  status?: TransportStatus | null;
  hostId?: string | null;
  /** Pending approvals pushed by the host. Null until a host connects. */
  approvals?: ApprovalRequest[] | null;
}

export function ApprovalScreen({ transport, status, hostId, approvals }: ApprovalScreenProps) {
  const live = status?.state === "connected" && transport != null && !!hostId && (!status.hostId || status.hostId === hostId);
  const data = (approvals ?? []).filter(approval => approval.hostId === hostId);

  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Needs your attention</Text>
      <Text style={screenStyles.note}>
        {live
          ? "Live permission prompts from the connected host. Approve or deny without leaving your phone."
          : "Reconnect to the selected host to receive and answer approval requests."}
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
          <Text style={localStyles.empty}>No approval requests received.</Text>
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
  const [submitted, setSubmitted] = useState(false);
  const submittedRef = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const enabled = transport != null && !submitted;

  function resolve(decision: "approve" | "deny") {
    if (!transport || submittedRef.current) return;
    const status = transport.status();
    if (status.state !== "connected" || (status.hostId && status.hostId !== approval.hostId)) return;
    const accepted = transport.sendAction({ type: decision, hostId: approval.hostId, approvalId: approval.id });
    if (accepted) { submittedRef.current = true; setSubmitted(true); setProblem(null); }
    else setProblem("The decision was not sent. Reconnect and review the request before trying again.");
  }

  return (
    <View style={localStyles.row}>
      <Text style={localStyles.kind}>{approval.kind.replace("_", " ")}</Text>
      <Text style={localStyles.summary}>{approval.summary}</Text>
      {submitted && <Text>Decision submitted. Waiting for host confirmation.</Text>}
      {problem && <Text accessibilityRole="alert">{problem}</Text>}
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
