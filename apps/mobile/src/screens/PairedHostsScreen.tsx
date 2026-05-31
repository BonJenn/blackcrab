import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import {
  MOCK_PAIRED_HOSTS,
  type HostId,
  type PairedHostSummary,
} from "@blackcrab/remote-protocol";

import type { StoredPairedHost } from "../pairingStore";
import type { TransportStatus } from "../transport/types";
import { screenStyles } from "./styles";

interface PairedHostsScreenProps {
  loading: boolean;
  storedHosts: StoredPairedHost[];
  onForgetHost: (hostId: HostId) => void;
  onPairHost: () => void;
  activeHostId?: HostId | null;
  activeStatus?: TransportStatus | null;
}

export function PairedHostsScreen({
  loading,
  storedHosts,
  onForgetHost,
  onPairHost,
  activeHostId,
  activeStatus,
}: PairedHostsScreenProps) {
  const hasStoredHosts = storedHosts.length > 0;
  const hosts = loading ? [] : hasStoredHosts ? storedHosts : MOCK_PAIRED_HOSTS;

  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Paired hosts</Text>
      <Text style={screenStyles.note}>
        {loading
          ? "Loading hosts..."
          : hasStoredHosts
            ? "Hosts stored on this device."
            : "No paired hosts on this device."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onPairHost}
        style={({ pressed }) => [
          localStyles.secondaryButton,
          pressed && localStyles.secondaryButtonPressed,
        ]}
      >
        <Text style={localStyles.secondaryButtonText}>Pair desktop</Text>
      </Pressable>
      {!loading && !hasStoredHosts && (
        <Text style={localStyles.sectionLabel}>Sample hosts</Text>
      )}
      <FlatList
        data={hosts}
        keyExtractor={(item) => item.hostId}
        renderItem={({ item }) => (
          <HostRow
            host={item}
            isStored={hasStoredHosts}
            onForgetHost={hasStoredHosts ? onForgetHost : undefined}
            connectionStatus={
              activeHostId && activeHostId === item.hostId
                ? activeStatus ?? null
                : null
            }
          />
        )}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
        ListEmptyComponent={
          loading ? <Text style={screenStyles.note}>Loading hosts...</Text> : null
        }
      />
    </View>
  );
}

function HostRow({
  host,
  isStored,
  onForgetHost,
  connectionStatus,
}: {
  host: PairedHostSummary;
  isStored: boolean;
  onForgetHost?: (hostId: HostId) => void;
  connectionStatus: TransportStatus | null;
}) {
  const label = connectionStatus
    ? connectionStatus.state.replace("_", " ")
    : host.online
      ? "online"
      : "offline";
  return (
    <View style={localStyles.row}>
      <View style={localStyles.rowMain}>
        <Text style={localStyles.name}>{host.displayName}</Text>
        <Text style={localStyles.meta}>
          {host.platform} · v{host.appVersion}
        </Text>
      </View>
      <View style={localStyles.rowActions}>
        <Text
          style={[localStyles.status, statusStyle(connectionStatus, host.online)]}
        >
          {label}
        </Text>
        {isStored && onForgetHost && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onForgetHost(host.hostId)}
            style={({ pressed }) => [
              localStyles.forgetButton,
              pressed && localStyles.secondaryButtonPressed,
            ]}
          >
            <Text style={localStyles.forgetButtonText}>Forget</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function statusStyle(
  status: TransportStatus | null,
  fallbackOnline: boolean,
) {
  if (status) {
    switch (status.state) {
      case "connected":
        return localStyles.online;
      case "connecting":
      case "reconnecting":
        return localStyles.connecting;
      case "error":
        return localStyles.error;
      default:
        return localStyles.offline;
    }
  }
  return fallbackOnline ? localStyles.online : localStyles.offline;
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
    gap: 12,
  },
  rowMain: {
    flex: 1,
  },
  name: {
    color: "#f4f6f8",
    fontSize: 15,
    fontWeight: "500",
  },
  meta: {
    color: "#9aa3ad",
    fontSize: 12,
    marginTop: 2,
  },
  rowActions: {
    alignItems: "flex-end",
    gap: 8,
  },
  status: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  online: {
    color: "#7ad48a",
  },
  offline: {
    color: "#6b7480",
  },
  connecting: {
    color: "#e6c065",
  },
  error: {
    color: "#ff9b8a",
  },
  secondaryButton: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#303741",
    backgroundColor: "#11151a",
    marginBottom: 12,
  },
  secondaryButtonPressed: {
    opacity: 0.78,
  },
  secondaryButtonText: {
    color: "#f4f6f8",
    fontSize: 13,
    fontWeight: "700",
  },
  sectionLabel: {
    color: "#6b7480",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  forgetButton: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#303741",
  },
  forgetButtonText: {
    color: "#d9dee4",
    fontSize: 12,
    fontWeight: "600",
  },
});
