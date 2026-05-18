import { FlatList, StyleSheet, Text, View } from "react-native";
import { MOCK_TRANSCRIPT_TAIL, type TranscriptEntry } from "@blackcrab/remote-protocol";

import { screenStyles } from "./styles";

export function TranscriptScreen() {
  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Transcript tail</Text>
      <Text style={screenStyles.note}>
        Read-only previews are intentional. Full transcripts stay on the
        desktop host.
      </Text>
      <FlatList
        data={MOCK_TRANSCRIPT_TAIL}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TranscriptRow entry={item} />}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
      />
    </View>
  );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  return (
    <View style={localStyles.row}>
      <Text style={localStyles.kind}>{entry.kind.replace("_", " ")}</Text>
      <Text style={localStyles.preview}>{entry.preview}</Text>
      {entry.truncated && <Text style={localStyles.truncated}>Truncated by host</Text>}
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
  preview: {
    color: "#f4f6f8",
    fontSize: 14,
    marginTop: 4,
  },
  truncated: {
    color: "#6b7480",
    fontSize: 11,
    marginTop: 4,
  },
});
