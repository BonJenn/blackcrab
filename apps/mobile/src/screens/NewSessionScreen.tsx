import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { HostId } from "@blackcrab/remote-protocol";

import type { StoredPairedHost } from "../pairingStore";
import type { TransportStatus } from "../transport/types";
import { screenStyles } from "./styles";

export interface NewSessionScreenProps {
  storedHosts: StoredPairedHost[];
  activeHostId: HostId | null;
  activeStatus: TransportStatus | null;
  /** Recent project directories on the active host. */
  projectDirs: string[];
  /** Make a paired host the active connection (to start a session on it). */
  onSwitchHost: (host: StoredPairedHost) => void;
  /** Start an idle session in `cwd`; the first message is typed in the chat. */
  onStart: (cwd: string) => void;
  onCancel: () => void;
}

function dirLabel(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

export function NewSessionScreen({
  storedHosts,
  activeHostId,
  activeStatus,
  projectDirs,
  onSwitchHost,
  onStart,
  onCancel,
}: NewSessionScreenProps) {
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState("");

  // Pre-select the most recent project so Start isn't silently disabled just
  // because no directory was tapped.
  useEffect(() => {
    if (!selectedDir && !customDir.trim() && projectDirs.length > 0) {
      setSelectedDir(projectDirs[0]);
    }
  }, [projectDirs, selectedDir, customDir]);

  const connected = activeStatus?.state === "connected";
  const cwd = (customDir.trim() || selectedDir || "").trim();
  const canStart = connected && cwd.length > 0;

  return (
    <KeyboardAvoidingView
      style={screenStyles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={localStyles.header}>
        <Text
          accessibilityRole="button"
          onPress={onCancel}
          style={localStyles.back}
        >
          ‹ Chats
        </Text>
        <Text style={localStyles.headerTitle}>New session</Text>
        <View style={localStyles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={localStyles.body}>
        <Text style={localStyles.sectionLabel}>Machine</Text>
        {storedHosts.length === 0 && (
          <Text style={screenStyles.note}>No paired machines. Pair one first.</Text>
        )}
        {storedHosts.map((host) => {
          const isActive = host.hostId === activeHostId;
          return (
            <Pressable
              key={host.hostId}
              accessibilityRole="button"
              onPress={() => onSwitchHost(host)}
              style={({ pressed }) => [
                localStyles.option,
                isActive && localStyles.optionSelected,
                pressed && localStyles.pressed,
              ]}
            >
              <Text style={localStyles.optionTitle}>{host.displayName}</Text>
              <Text style={localStyles.optionMeta}>
                {isActive
                  ? activeStatus?.state ?? "selected"
                  : "tap to connect"}
              </Text>
            </Pressable>
          );
        })}

        <Text style={localStyles.sectionLabel}>Directory</Text>
        {!connected && (
          <Text style={screenStyles.note}>
            Connect to a machine to load its recent projects.
          </Text>
        )}
        {connected && projectDirs.length === 0 && (
          <Text style={screenStyles.note}>
            No recent projects — enter a path below.
          </Text>
        )}
        {projectDirs.map((dir) => {
          const isSel = !customDir.trim() && selectedDir === dir;
          return (
            <Pressable
              key={dir}
              accessibilityRole="button"
              onPress={() => {
                setSelectedDir(dir);
                setCustomDir("");
              }}
              style={({ pressed }) => [
                localStyles.option,
                isSel && localStyles.optionSelected,
                pressed && localStyles.pressed,
              ]}
            >
              <Text style={localStyles.optionTitle}>{dirLabel(dir)}</Text>
              <Text style={localStyles.optionMeta} numberOfLines={1}>
                {dir}
              </Text>
            </Pressable>
          );
        })}
        <TextInput
          style={localStyles.input}
          value={customDir}
          onChangeText={(v) => {
            setCustomDir(v);
            if (v.trim()) setSelectedDir(null);
          }}
          editable={connected}
          placeholder="…or type a directory path"
          placeholderTextColor="#6b7480"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable
          accessibilityRole="button"
          disabled={!canStart}
          onPress={() => onStart(cwd)}
          style={({ pressed }) => [
            localStyles.startButton,
            !canStart && localStyles.disabled,
            pressed && localStyles.pressed,
          ]}
        >
          <Text style={localStyles.startText}>Start session</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f242b",
  },
  back: {
    color: "#e26a4b",
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    flex: 1,
    color: "#f4f6f8",
    fontSize: 16,
    fontWeight: "600",
  },
  headerSpacer: {
    width: 44,
  },
  body: {
    paddingVertical: 12,
    gap: 8,
  },
  sectionLabel: {
    color: "#6b7480",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
  },
  option: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2f37",
    backgroundColor: "#11151a",
  },
  optionSelected: {
    borderColor: "#e26a4b",
  },
  optionTitle: {
    color: "#f4f6f8",
    fontSize: 14,
    fontWeight: "600",
  },
  optionMeta: {
    color: "#9aa3ad",
    fontSize: 12,
    marginTop: 2,
  },
  input: {
    backgroundColor: "#11151a",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f242b",
    color: "#f4f6f8",
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  startButton: {
    marginTop: 16,
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: "#e26a4b",
  },
  startText: {
    color: "#f4f6f8",
    fontSize: 15,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
