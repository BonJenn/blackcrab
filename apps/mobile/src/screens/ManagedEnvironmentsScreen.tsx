import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ManagedEnvironmentsClient, ManagedEnvironmentView } from "../managed/types";
import { screenStyles } from "./styles";

type Action = "retry" | "pair" | "connect" | "disconnect" | "forget" | "select";
const actionErrors: Record<Action, string> = {
  retry: "Could not reload workspaces. Try again.",
  pair: "Could not pair this workspace. Check the address and pairing code, then try again.",
  connect: "Could not connect to this workspace. Try again when it is reachable.",
  disconnect: "Could not disconnect this phone. Try again.",
  forget: "Could not forget this workspace. Try again.",
  select: "Could not select this workspace. Try again.",
};
const phaseLabels: Record<ManagedEnvironmentView["phase"], string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  offline: "Offline",
  blocked: "Connection needs attention",
};

/** Never echo a pairing token even if a malformed view model supplies its full link. */
function addressLabel(address: string): string {
  try {
    const url = new URL(address);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "Saved address";
  } catch {
    return "Saved address";
  }
}

export function ManagedEnvironmentsScreen({ client }: { client: ManagedEnvironmentsClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [address, setAddress] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionEpoch = useRef(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    ++actionEpoch.current;
    pendingRef.current = false;
    setPending(null); setActionError(null); setAddress(""); setPairingCode("");
    return () => { ++actionEpoch.current; };
  }, [client]);

  const disabled = state.loading || state.busy || pending !== null;
  const selected = state.environments.find(item => item.environmentId === state.selectedEnvironmentId);
  const projects = selected?.projects ?? [];
  const threads = selected?.threads ?? [];
  const live = selected?.phase === "connected" && selected.dataStatus === "live";
  const projectTitles = new Map(projects.map(project => [project.id, project.title]));

  async function act(action: Action, operation: () => Promise<void> | void) {
    if (pendingRef.current || state.loading || state.busy) return;
    pendingRef.current = true;
    const epoch = ++actionEpoch.current;
    setPending(action); setActionError(null);
    try {
      await operation();
      if (epoch === actionEpoch.current && action === "pair") { setAddress(""); setPairingCode(""); }
    } catch {
      // Native errors can include a submitted pairing link; the owner supplies safe details.
      if (epoch === actionEpoch.current) setActionError(actionErrors[action]);
    } finally {
      if (epoch === actionEpoch.current) { pendingRef.current = false; setPending(null); }
    }
  }

  const header = <View>
    <Text accessibilityRole="header" style={screenStyles.heading}>Managed workspaces</Text>
    <Text style={screenStyles.note}>Connect to a workspace to view its projects and threads.</Text>
    {state.loading && <Text accessibilityLiveRegion="polite" style={screenStyles.note}>Loading saved workspaces…</Text>}
    {(state.error || actionError) && <Text accessibilityRole="alert" style={styles.error}>{state.error || actionError}</Text>}
    {state.error && client.retry && <ActionButton label={pending === "retry" ? "Reloading…" : "Retry loading workspaces"} disabled={disabled} onPress={() => { void act("retry", () => client.retry!()); }} />}
    <View style={styles.card}>
      <Text style={styles.sectionHeading}>Pair a workspace</Text>
      <Text style={screenStyles.note}>Enter its address and code, or paste the complete pairing link.</Text>
      <TextInput
        accessibilityLabel="Workspace address or pairing link"
        placeholder="https://workspace.example"
        placeholderTextColor="#667180"
        value={address}
        onChangeText={setAddress}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        secureTextEntry
        style={styles.input}
      />
      {!!address.trim() && <Text style={screenStyles.note}>Address: {addressLabel(address)}</Text>}
      <TextInput
        accessibilityLabel="Workspace pairing code"
        placeholder="Pairing code"
        placeholderTextColor="#667180"
        value={pairingCode}
        onChangeText={setPairingCode}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        secureTextEntry
        style={styles.input}
      />
      <ActionButton label={pending === "pair" ? "Pairing…" : "Pair workspace"} disabled={disabled || !address.trim()} onPress={() => { void act("pair", () => client.pair({ address: address.trim(), pairingCode: pairingCode.trim() })); }} />
    </View>

    {!state.loading && state.environments.length === 0 && <Text style={screenStyles.note}>No managed workspaces are saved on this device.</Text>}
    {state.environments.map(environment => {
      const selectedRow = environment.environmentId === state.selectedEnvironmentId;
      const canDisconnect = environment.phase === "connected" || environment.phase === "connecting";
      return <View key={environment.environmentId} style={[styles.card, selectedRow && styles.selectedCard]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Select ${environment.label}`}
          accessibilityState={{ selected: selectedRow, disabled }}
          disabled={disabled}
          onPress={() => { void act("select", () => client.select(environment.environmentId)); }}
          style={styles.selectArea}
        >
          <Text style={styles.name}>{environment.label}</Text>
          <Text style={styles.address}>{addressLabel(environment.address)}</Text>
          <Text style={[styles.phase, environment.phase === "connected" && styles.connected]}>{phaseLabels[environment.phase]}{selectedRow ? " · Selected" : ""}</Text>
        </Pressable>
        {environment.error && <Text accessibilityRole="alert" style={styles.error}>{environment.error}</Text>}
        <View style={styles.actions}>
          {canDisconnect
            ? <ActionButton label="Disconnect" accessibilityLabel={`Disconnect from ${environment.label}`} disabled={disabled} onPress={() => { void act("disconnect", () => client.disconnect(environment.environmentId)); }} />
            : <ActionButton label="Connect" accessibilityLabel={`Connect to ${environment.label}`} disabled={disabled} onPress={() => { void act("connect", () => client.connect(environment.environmentId)); }} />}
          <ActionButton label="Forget" accessibilityLabel={`Forget ${environment.label}`} disabled={disabled} destructive onPress={() => { void act("forget", () => client.forget(environment.environmentId)); }} />
        </View>
      </View>;
    })}

    {selected && <View>
      <Text accessibilityRole="header" style={styles.sectionHeading}>{selected.label}</Text>
      {!live && <Text style={screenStyles.note}>{selected.dataStatus === "empty" ? "Waiting for workspace data…" : selected.dataStatus === "synchronizing" ? "Refreshing workspace data. Saved information may be out of date." : "Showing saved information. This list may be out of date until the workspace reconnects."}</Text>}
      <Text style={screenStyles.note}>Disconnecting this phone leaves agents running on the host.</Text>
      <Text accessibilityRole="header" style={styles.sectionHeading}>Projects</Text>
      {projects.length === 0 && <Text style={screenStyles.note}>{live ? "No projects in this workspace." : "No saved projects are available."}</Text>}
      {projects.map(project => <View key={project.id} style={styles.listRow}>
        <Text style={styles.name}>{project.title}</Text>
        <Text style={styles.address}>{project.path}</Text>
      </View>)}
      <Text accessibilityRole="header" style={styles.sectionHeading}>Threads</Text>
      <Text style={screenStyles.note}>Projects and threads are read-only in this view.</Text>
    </View>}
    {!selected && state.environments.length > 0 && <Text style={screenStyles.note}>Select a workspace to see its projects and threads.</Text>}
  </View>;

  return <FlatList
    style={styles.screen}
    contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled"
    data={threads}
    keyExtractor={item => item.id}
    ListHeaderComponent={header}
    ListEmptyComponent={selected ? <Text style={screenStyles.note}>{live ? "No threads in this workspace." : "No saved threads are available."}</Text> : null}
    renderItem={({ item }) => <View style={styles.listRow}>
      <Text style={styles.name}>{item.title}</Text>
      <Text style={styles.address}>{item.status}{item.projectId ? ` · ${projectTitles.get(item.projectId) ?? "Project"}` : ""}</Text>
    </View>}
  />;
}

function ActionButton({ label, accessibilityLabel, disabled, destructive, onPress }: {
  label: string; accessibilityLabel?: string; disabled: boolean; destructive?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, destructive && styles.destructiveButton, disabled && styles.disabledButton, pressed && !disabled && styles.pressedButton]}>
    <Text style={[styles.buttonText, destructive && styles.destructiveText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  card: { padding: 14, borderWidth: 1, borderColor: "#29313b", borderRadius: 12, backgroundColor: "#141a22", marginTop: 12, marginBottom: 4 },
  selectedCard: { borderColor: "#7b9bff" },
  selectArea: { paddingBottom: 8 },
  sectionHeading: { color: "#f4f6f8", fontSize: 16, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  name: { color: "#f4f6f8", fontSize: 14, fontWeight: "600" },
  address: { color: "#9aa3ad", fontSize: 12, marginTop: 4 },
  phase: { color: "#c4cad2", fontSize: 12, marginTop: 6 },
  connected: { color: "#86d8b0" },
  input: { color: "#f4f6f8", borderWidth: 1, borderColor: "#3b4655", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, backgroundColor: "#0c1118", fontSize: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  button: { paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#3b4655", borderRadius: 8, alignSelf: "flex-start" },
  buttonText: { color: "#dce5f1", fontSize: 13, fontWeight: "500" },
  destructiveButton: { borderColor: "#62404a" },
  destructiveText: { color: "#f0a5ae" },
  disabledButton: { opacity: 0.45 },
  pressedButton: { backgroundColor: "#263244" },
  error: { color: "#f0a5ae", fontSize: 13, marginVertical: 8 },
  listRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#29313b" },
});
