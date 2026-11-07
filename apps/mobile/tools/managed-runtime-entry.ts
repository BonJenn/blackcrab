// Standalone native bundle fixture, never the product's entry point.
import "react-native-get-random-values";
import { registerRootComponent } from "expo";
import { createElement } from "react";
import { Text, View } from "react-native";
import { ExecutionEnvironmentDescriptor, ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { Connection, orchestrationProtocolCompatibilityError } from "@t3tools/client-runtime/connection";
import * as Authorization from "@t3tools/client-runtime/authorization";
import * as Rpc from "@t3tools/client-runtime/rpc";
import * as Platform from "@t3tools/client-runtime/platform";
import * as Relay from "@t3tools/client-runtime/relay";
import * as Shell from "@t3tools/client-runtime/state/shell";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const descriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor)({
  environmentId: "blackcrab-native-bundle-fixture", label: "Native bundle fixture",
  serverVersion: "0.1.7", orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
  platform: { os: "darwin", arch: "arm64" }, capabilities: { repositoryIdentity: false },
});
const loaded = Effect.runSync(Effect.sync(() => ({
  protocol: descriptor.orchestrationProtocolVersion,
  compatible: orchestrationProtocolCompatibilityError(descriptor) === null,
  // Keep all intended source entry points reachable in the native fixture bundle.
  exports: [Connection, Authorization, Rpc, Platform, Shell, Relay].map(module => Object.keys(module).length),
})));
if (!loaded.compatible || loaded.exports.some(count => count === 0)) throw new Error("Pinned native shared runtime did not load");
function ManagedRuntimeFixture() {
  return createElement(View, { style: { padding: 24 } },
    createElement(Text, null, "Blackcrab shared-runtime native fixture"),
    createElement(Text, null, JSON.stringify(loaded)),
  );
}
registerRootComponent(ManagedRuntimeFixture);
