import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import {
  type HostId,
  type PairedHostSummary,
} from "@blackcrab/remote-protocol";

import type { StoredPairedHost } from "../pairingStore";
import type { TransportStatus } from "../transport/types";
import { isConnectable } from "../transport/reconnect";
import { screenStyles } from "./styles";

interface PairedHostsScreenProps {
  loading: boolean;
  storedHosts: StoredPairedHost[];
  onForgetHost: (hostId: HostId) => void;
  onPairHost: () => void;
  activeHostId?: HostId | null;
  activeStatus?: TransportStatus | null;
  connectionError?: string | null;
  selectionError?: string | null;
  savingSelection?: boolean;
  onRetrySelection?: () => void;
  onConnectHost?: (hostId: HostId, reconnect: boolean) => void;
  onDisconnectHost?: () => void;
  onViewSessions?: () => void;
}

export function PairedHostsScreen({
  loading,
  storedHosts,
  onForgetHost,
  onPairHost,
  activeHostId,
  activeStatus,
  connectionError,
  selectionError,
  savingSelection,
  onRetrySelection,
  onConnectHost,
  onDisconnectHost,
  onViewSessions,
}: PairedHostsScreenProps) {
  const hasStoredHosts = storedHosts.length > 0;
  const hosts = loading ? [] : storedHosts;

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
      {savingSelection && <Text style={screenStyles.note}>Saving startup host…</Text>}
      {selectionError && <View>
        <Text accessibilityRole="alert" style={screenStyles.note}>{selectionError}</Text>
        {onRetrySelection && <Pressable accessibilityRole="button" onPress={onRetrySelection} disabled={savingSelection} style={localStyles.secondaryButton}><Text style={localStyles.secondaryButtonText}>Retry saving startup host</Text></Pressable>}
      </View>}
      {onDisconnectHost && !activeHostId && !loading && <Pressable accessibilityRole="button" onPress={onDisconnectHost} style={localStyles.secondaryButton}><Text style={localStyles.secondaryButtonText}>Disconnect on startup</Text></Pressable>}
      {connectionError && <Text accessibilityRole="alert" style={screenStyles.note}>{connectionError}</Text>}
      {onDisconnectHost && <Text style={screenStyles.note}>Disconnecting closes this phone connection. Agent runs continue on the host.</Text>}
      <FlatList
        data={hosts}
        keyExtractor={(item) => item.hostId}
        renderItem={({ item }) => (
          <HostRow
            host={item}
            isStored={hasStoredHosts}
            onForgetHost={hasStoredHosts ? onForgetHost : undefined}
            active={item.hostId === activeHostId}
            connectable={isConnectable(item)}
            onConnectHost={onConnectHost}
            onDisconnectHost={onDisconnectHost}
            onViewSessions={onViewSessions}
            onPairHost={onPairHost}
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
  active,
  connectable,
  onConnectHost,
  onDisconnectHost,
  onViewSessions,
  onPairHost,
}: {
  host: PairedHostSummary;
  isStored: boolean;
  onForgetHost?: (hostId: HostId) => void;
  connectionStatus: TransportStatus | null;
  active: boolean;
  connectable: boolean;
  onConnectHost?: (hostId: HostId, reconnect: boolean) => void;
  onDisconnectHost?: () => void;
  onViewSessions?: () => void;
  onPairHost: () => void;
}) {
  const label = connectionStatus
    ? connectionStatus.state.replace("_", " ")
    : "not connected";
  const connecting = active && (!connectionStatus || ["connecting", "reconnecting"].includes(connectionStatus.state));
  const connected = active && connectionStatus?.state === "connected";
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
          style={[localStyles.status, statusStyle(connectionStatus, false)]}
        >
          {label}
        </Text>
        {onConnectHost && <Pressable accessibilityRole="button" accessibilityLabel={`${connected ? "Open chats on" : !connectable ? "Pair again with" : active ? "Reconnect to" : "Connect to"} ${host.displayName}`} disabled={connecting} onPress={() => {
          if (connected) onViewSessions?.();
          else if (!connectable) onPairHost();
          else onConnectHost(host.hostId, active);
        }} style={({ pressed }) => [localStyles.secondaryButton, pressed && localStyles.secondaryButtonPressed]}>
          <Text style={localStyles.secondaryButtonText}>{connected ? "Open chats" : connecting ? "Connecting…" : !connectable ? "Pair again" : active ? "Reconnect" : "Connect"}</Text>
        </Pressable>}
        {active && onDisconnectHost && <Pressable accessibilityRole="button" accessibilityLabel={`Disconnect from ${host.displayName}`} onPress={onDisconnectHost} style={localStyles.forgetButton}><Text style={localStyles.forgetButtonText}>Disconnect</Text></Pressable>}
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
