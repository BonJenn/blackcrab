import { useState } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { ApprovalScreen } from "./src/screens/ApprovalScreen";
import { PairedHostsScreen } from "./src/screens/PairedHostsScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { TranscriptScreen } from "./src/screens/TranscriptScreen";

type TabKey = "hosts" | "sessions" | "transcript" | "approval";

const TABS: { key: TabKey; label: string }[] = [
  { key: "hosts", label: "Hosts" },
  { key: "sessions", label: "Sessions" },
  { key: "transcript", label: "Transcript" },
  { key: "approval", label: "Attention" },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>("hosts");

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Text style={styles.title}>Blackcrab Remote</Text>
        <Text style={styles.subtitle}>Experimental scaffold · not connected</Text>
      </View>
      <View style={styles.tabs}>
        {TABS.map((entry) => {
          const active = entry.key === tab;
          return (
            <Text
              key={entry.key}
              accessibilityRole="button"
              onPress={() => setTab(entry.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              {entry.label}
            </Text>
          );
        })}
      </View>
      <View style={styles.body}>
        {tab === "hosts" && <PairedHostsScreen />}
        {tab === "sessions" && <SessionsScreen />}
        {tab === "transcript" && <TranscriptScreen />}
        {tab === "approval" && <ApprovalScreen />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0b0d10",
  },
  header: {
    padding: 16,
  },
  title: {
    color: "#f4f6f8",
    fontSize: 22,
    fontWeight: "600",
  },
  subtitle: {
    color: "#9aa3ad",
    fontSize: 13,
    marginTop: 2,
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f242b",
  },
  tab: {
    color: "#9aa3ad",
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  tabActive: {
    color: "#f4f6f8",
    fontWeight: "600",
    borderBottomWidth: 2,
    borderBottomColor: "#e26a4b",
  },
  body: {
    flex: 1,
  },
});
