import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { ActivityIndicator, Alert, Keyboard, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { activateFullNativeUI } from "./.generated/native-ui/OwnedActivation";
import { managedRootLifecycle } from "./.generated/native-ui/owned-root-lifecycle.mjs";
import { managedOwnership } from "./root-shell/ownership.mjs";
import LegacyApp from "./LegacyApp";

// Import failures are sticky: module-installed services cannot safely be retried
// or restarted by mounting another screen. The generated owner survives refresh.
const startup = activateFullNativeUI(() => managedOwnership.claimFullRoot());
// Observe early import rejection before React effects attach; keep failure sticky.
void startup.catch(() => undefined);
const subscribe = (notify: () => void) => managedRootLifecycle.subscribeVisibility(notify);

export default function App() {
  const [FullApp, setFullApp] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  const managedVisible = useSyncExternalStore(subscribe, managedRootLifecycle.isManagedVisible);
  useEffect(() => {
    let mounted = true;
    void startup.then(component => { if (mounted) setFullApp(() => component); }, () => { if (mounted) { setFailed(true); void SplashScreen.hideAsync().catch(() => undefined); } });
    return () => { mounted = false; };
  }, []);
  useEffect(() => managedRootLifecycle.subscribeManagedNavigation(() => {
    Keyboard.dismiss();
    managedRootLifecycle.setManagedVisible(true);
  }), []);
  const showManaged = () => { Keyboard.dismiss(); managedRootLifecycle.setManagedVisible(true); };
  const showLegacy = () => {
    if (!managedRootLifecycle.requestLegacy()) {
      Alert.alert("Voice input is active", "Finish or cancel voice input before opening legacy hosts.");
      return;
    }
    Keyboard.dismiss();
  };
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.toolbar}>
        <View style={styles.toolbarRow}>
          <Text style={styles.brand}>Blackcrab</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Open legacy paired hosts" onPress={showLegacy} style={styles.button}>
            <Text style={styles.buttonText}>Legacy hosts</Text>
          </Pressable>
        </View>
      </SafeAreaView>
      <View style={styles.managed} pointerEvents={managedVisible ? "auto" : "none"} accessibilityElementsHidden={!managedVisible} importantForAccessibility={managedVisible ? "auto" : "no-hide-descendants"}>
        {FullApp ? <FullApp /> : <View style={styles.loading}>
          {failed ? <Text accessibilityRole="alert" style={styles.message}>The workspace could not start. Close and reopen Blackcrab Remote to try again.</Text> : <ActivityIndicator accessibilityLabel="Starting workspace" />}
        </View>}
      </View>
      <Modal visible={!managedVisible} presentationStyle="fullScreen" animationType="slide" onRequestClose={showManaged} supportedOrientations={["portrait", "portrait-upside-down", "landscape-left", "landscape-right"]}>
        <SafeAreaView style={styles.legacyHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Return to managed workspaces" onPress={showManaged} style={styles.button}>
            <Text style={styles.buttonText}>Back to workspaces</Text>
          </Pressable>
        </SafeAreaView>
        {!managedVisible && <LegacyApp />}
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1018" },
  toolbar: { backgroundColor: "#111827" },
  toolbarRow: { minHeight: 42, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { color: "#f8fafc", fontSize: 16, fontWeight: "600" },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  buttonText: { color: "#93c5fd", fontSize: 15 },
  managed: { flex: 1 },
  legacyHeader: { backgroundColor: "#111827" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  message: { color: "#f8fafc", textAlign: "center" },
});
