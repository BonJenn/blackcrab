import { FlatList, StyleSheet, Text, View } from "react-native";
import { MOCK_PAIRED_HOSTS, type PairedHostSummary } from "@blackcrab/remote-protocol";

import { screenStyles } from "./styles";

export function PairedHostsScreen() {
  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Paired hosts</Text>
      <Text style={screenStyles.note}>
        Pairing is not yet implemented. This screen renders mock host summaries
        from the remote protocol package.
      </Text>
      <FlatList
        data={MOCK_PAIRED_HOSTS}
        keyExtractor={(item) => item.hostId}
        renderItem={({ item }) => <HostRow host={item} />}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
      />
    </View>
  );
}

function HostRow({ host }: { host: PairedHostSummary }) {
  return (
    <View style={localStyles.row}>
      <View style={localStyles.rowMain}>
        <Text style={localStyles.name}>{host.displayName}</Text>
        <Text style={localStyles.meta}>
          {host.platform} · v{host.appVersion}
        </Text>
      </View>
      <Text style={[localStyles.status, host.online ? localStyles.online : localStyles.offline]}>
        {host.online ? "online" : "offline"}
      </Text>
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
});
