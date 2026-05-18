import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  isPairingCode,
  parseDesktopPairingPayload,
} from "@blackcrab/remote-protocol";

import {
  normalizePairingCode,
  pairHostFromInput,
  type PairHostFromInputResult,
  type StoredPairedHost,
} from "../pairingStore";
import { screenStyles } from "./styles";

interface PairHostScreenProps {
  onPaired: (hosts: StoredPairedHost[]) => void;
}

export function PairHostScreen({ onPaired }: PairHostScreenProps) {
  const [pairingInput, setPairingInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payloadPreview = useMemo(
    () => parseDesktopPairingPayload(pairingInput),
    [pairingInput],
  );
  const normalizedCode = useMemo(
    () => normalizePairingCode(pairingInput),
    [pairingInput],
  );
  const recognizedCode =
    !payloadPreview && isPairingCode(normalizedCode) ? normalizedCode : null;
  const canPair = pairingInput.trim().length > 0 && !busy;

  async function handlePair() {
    if (!canPair) return;

    setBusy(true);
    setError(null);
    let result: PairHostFromInputResult;
    try {
      result = await pairHostFromInput(pairingInput);
    } catch {
      setBusy(false);
      setError("Could not save paired host.");
      return;
    }

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setPairingInput("");
    onPaired(result.hosts);
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={localStyles.content}
    >
      <Text style={screenStyles.heading}>Pair desktop</Text>
      <View style={localStyles.statusRow}>
        <Text style={localStyles.statusLabel}>Transport</Text>
        <Text style={localStyles.statusValue}>Local demo</Text>
      </View>

      <View style={localStyles.field}>
        <Text style={localStyles.label}>Pairing code or payload</Text>
        <TextInput
          accessibilityLabel="Pairing code or payload"
          autoCapitalize="characters"
          autoCorrect={false}
          multiline
          onChangeText={(value) => {
            setPairingInput(value);
            setError(null);
          }}
          placeholder="ABCDEF or JSON payload"
          placeholderTextColor="#6b7480"
          style={localStyles.input}
          value={pairingInput}
        />
      </View>

      {payloadPreview && (
        <PairingPreview
          label="Desktop"
          primary={payloadPreview.displayName}
          secondary={`${payloadPreview.platform} · v${payloadPreview.appVersion}`}
        />
      )}
      {recognizedCode && (
        <PairingPreview
          label="Code"
          primary={recognizedCode}
          secondary="Manual local entry"
        />
      )}

      {error && <Text style={localStyles.error}>{error}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={!canPair}
        onPress={handlePair}
        style={({ pressed }) => [
          localStyles.primaryButton,
          !canPair && localStyles.primaryButtonDisabled,
          pressed && canPair && localStyles.primaryButtonPressed,
        ]}
      >
        <Text style={localStyles.primaryButtonText}>
          {busy ? "Pairing..." : "Pair desktop"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function PairingPreview({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <View style={localStyles.preview}>
      <Text style={localStyles.previewLabel}>{label}</Text>
      <View style={localStyles.previewMain}>
        <Text style={localStyles.previewPrimary}>{primary}</Text>
        <Text style={localStyles.previewSecondary}>{secondary}</Text>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  content: {
    padding: 16,
  },
  statusRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    marginBottom: 18,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#171b20",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a3038",
  },
  statusLabel: {
    color: "#9aa3ad",
    fontSize: 12,
    fontWeight: "500",
  },
  statusValue: {
    color: "#f4f6f8",
    fontSize: 12,
    fontWeight: "600",
  },
  field: {
    marginBottom: 14,
  },
  label: {
    color: "#d9dee4",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    minHeight: 132,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#303741",
    backgroundColor: "#11151a",
    color: "#f4f6f8",
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
    textAlignVertical: "top",
  },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a3038",
    backgroundColor: "#12161b",
    padding: 12,
    marginBottom: 14,
  },
  previewLabel: {
    minWidth: 58,
    color: "#e26a4b",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  previewMain: {
    flex: 1,
  },
  previewPrimary: {
    color: "#f4f6f8",
    fontSize: 15,
    fontWeight: "600",
  },
  previewSecondary: {
    color: "#9aa3ad",
    fontSize: 12,
    marginTop: 2,
  },
  error: {
    color: "#ff9b8a",
    fontSize: 13,
    marginBottom: 12,
  },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "#e26a4b",
  },
  primaryButtonPressed: {
    opacity: 0.86,
  },
  primaryButtonDisabled: {
    backgroundColor: "#3a2a25",
  },
  primaryButtonText: {
    color: "#11151a",
    fontSize: 15,
    fontWeight: "700",
  },
});
