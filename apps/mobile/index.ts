import "react-native-gesture-handler";
import "./global.css";
// Polyfill crypto.getRandomValues so tweetnacl has a CSPRNG under Hermes.
// Must be imported before any code that touches the crypto module.
import "react-native-get-random-values";
import { registerRootComponent } from "expo";
import * as SplashScreen from "expo-splash-screen";

import { featureFlags } from "react-native-screens";
import App from "./App";

// Pinned native-stack FormSheet sizing for nested stacks. No upstream debug or telemetry entrypoints.
featureFlags.experiment.synchronousScreenUpdatesEnabled = true;

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
registerRootComponent(App);
