import { useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { MobileProvidersClient } from "./client";
import { screenStyles } from "../screens/styles";

export function ProvidersScreen({ client }: { client: MobileProvidersClient }) {
  const state = useSyncExternalStore(client.subscribe, client.state);
  return <ScrollView contentContainerStyle={screenStyles.container}>
    <Text style={screenStyles.heading}>Providers on selected host</Text>
    <Text style={screenStyles.note}>Provider capabilities describe the host adapter. Remote availability is listed separately. Discovery never starts an agent.</Text>
    {!state.connected && <Text style={screenStyles.note}>Connect to a paired host to discover its providers.</Text>}
    {state.loading && <Text style={screenStyles.note}>Loading providers…</Text>}
    {state.error && <Text accessibilityRole="alert" style={screenStyles.note}>{state.error}</Text>}
    <Pressable accessibilityRole="button" disabled={!state.connected || state.loading} onPress={client.refresh}>
      <Text style={screenStyles.note}>Refresh providers</Text>
    </Pressable>
    {state.providers?.length === 0 && <Text style={screenStyles.note}>This host reported no providers.</Text>}
    {state.providers?.map(provider => <View key={provider.id}>
      <Text style={screenStyles.heading}>{provider.displayName}</Text>
      <Text style={screenStyles.note}>{!provider.installed ? "CLI not installed" : provider.remoteReady ? "Remote workflows supported" : "Remote control not available"}{provider.installed && !provider.desktopReady ? " · Desktop preview" : ""}</Text>
      <Text style={screenStyles.note}>Adapter features: {[
        provider.capabilities.resume && "resume", provider.capabilities.streaming && "streaming",
        provider.capabilities.modelSelection && "model selection", provider.capabilities.worktrees && "worktrees",
        provider.capabilities.steering && "steering",
      ].filter(Boolean).join(", ") || "none reported"}. Permission modes: {provider.capabilities.permissionModes.join(", ") || "none reported"}.</Text>
    </View>)}
  </ScrollView>;
}
