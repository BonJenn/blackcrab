import { useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
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

type PairMode = "manual" | "scan";

interface PairHostScreenProps {
  onPaired: (hosts: StoredPairedHost[]) => void;
}

export function PairHostScreen({ onPaired }: PairHostScreenProps) {
  const [mode, setMode] = useState<PairMode>("manual");
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

  async function pair(input: string) {
    setBusy(true);
    setError(null);
    let result: PairHostFromInputResult;
    try {
      result = await pairHostFromInput(input);
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

  async function handlePair() {
    if (!canPair) return;
    await pair(pairingInput);
  }

  async function handleScanned(data: string) {
    setMode("manual");
    setPairingInput(data);
    await pair(data);
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

      <View style={localStyles.modeRow}>
        <ModeButton
          active={mode === "manual"}
          label="Enter code"
          onPress={() => setMode("manual")}
        />
        <ModeButton
          active={mode === "scan"}
          label="Scan QR"
          onPress={() => setMode("scan")}
        />
      </View>

      {mode === "manual" && (
        <>
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
        </>
      )}

      {mode === "scan" && (
        <QrScanner onScanned={handleScanned} busy={busy} error={error} />
      )}
    </ScrollView>
  );
}

interface QrScannerProps {
  onScanned: (data: string) => void | Promise<void>;
  busy: boolean;
  error: string | null;
}

function QrScanner({ onScanned, busy, error }: QrScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  function handleBarcode(result: BarcodeScanningResult) {
    if (scannedRef.current || busy) return;
    if (!result.data) return;
    scannedRef.current = true;
    void onScanned(result.data);
  }

  if (!permission) {
    return (
      <View style={localStyles.scanFallback}>
        <Text style={localStyles.scanFallbackText}>Checking camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={localStyles.scanFallback}>
        <Text style={localStyles.scanFallbackText}>
          Camera permission is required to scan a desktop QR.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void requestPermission();
          }}
          style={({ pressed }) => [
            localStyles.primaryButton,
            pressed && localStyles.primaryButtonPressed,
          ]}
        >
          <Text style={localStyles.primaryButtonText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={localStyles.scanWrap}>
      <View style={localStyles.cameraFrame}>
        <CameraView
          style={localStyles.camera}
          facing="back"
          onBarcodeScanned={handleBarcode}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        />
      </View>
      <Text style={localStyles.scanHint}>
        Point at the QR shown in the desktop Settings panel.
      </Text>
      {error && <Text style={localStyles.error}>{error}</Text>}
      {busy && <Text style={localStyles.scanHint}>Pairing…</Text>}
    </View>
  );
}

function ModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        localStyles.modeButton,
        active && localStyles.modeButtonActive,
        pressed && localStyles.modeButtonPressed,
      ]}
    >
      <Text
        style={[
          localStyles.modeButtonText,
          active && localStyles.modeButtonTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
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
  modeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  modeButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a3038",
    backgroundColor: "#11151a",
  },
  modeButtonActive: {
    borderColor: "#e26a4b",
    backgroundColor: "#1c1410",
  },
  modeButtonPressed: {
    opacity: 0.85,
  },
  modeButtonText: {
    color: "#9aa3ad",
    fontSize: 13,
    fontWeight: "600",
  },
  modeButtonTextActive: {
    color: "#f4f6f8",
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
  scanWrap: {
    gap: 12,
  },
  cameraFrame: {
    aspectRatio: 1,
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  scanHint: {
    color: "#9aa3ad",
    fontSize: 13,
  },
  scanFallback: {
    gap: 12,
    padding: 16,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a3038",
    backgroundColor: "#12161b",
  },
  scanFallbackText: {
    color: "#d9dee4",
    fontSize: 14,
  },
});
