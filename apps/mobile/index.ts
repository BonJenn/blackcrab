// Polyfill crypto.getRandomValues so tweetnacl has a CSPRNG under Hermes.
// Must be imported before any code that touches the crypto module.
import "react-native-get-random-values";
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
