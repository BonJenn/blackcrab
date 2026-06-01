import { FlatList, StyleSheet, Text, View } from "react-native";
import { MOCK_TRANSCRIPT_TAIL, type TranscriptEntry } from "@blackcrab/remote-protocol";

import { screenStyles } from "./styles";

export interface TranscriptScreenProps {
  /** Live transcript tail pushed by the host. Falls back to mock when null. */
  entries?: TranscriptEntry[] | null;
}

export function TranscriptScreen({ entries }: TranscriptScreenProps) {
  const live = entries != null;
  const data = live ? entries : MOCK_TRANSCRIPT_TAIL;

  return (
    <View style={screenStyles.container}>
      <Text style={screenStyles.heading}>Transcript tail</Text>
      <Text style={screenStyles.note}>
        {live
          ? "Live tail of the host's most recently active session. Full transcripts stay on the desktop."
          : "Read-only previews are intentional. Full transcripts stay on the desktop host."}
      </Text>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TranscriptRow entry={item} />}
        ItemSeparatorComponent={() => <View style={localStyles.separator} />}
        ListEmptyComponent={
          <Text style={screenStyles.note}>No transcript entries yet.</Text>
        }
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
