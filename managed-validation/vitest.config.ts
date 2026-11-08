import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
// Node host acceptance injects every native port. Resolve imports here before
// Vitest's module loader can evaluate Expo/RN's native initialization code.
const port = (name: string) => fileURLToPath(new URL(`./native-test-ports/${name}.ts`, import.meta.url));
export default defineConfig({
  resolve: { alias: [
    { find: /^expo-network$/, replacement: port("network") },
    { find: /^expo-file-system\/legacy$/, replacement: port("filesystem") },
    { find: /^expo-secure-store$/, replacement: port("secure-store") },
    { find: /^react-native$/, replacement: port("react-native") },
  ] },
  test: { environment: "node", include: ["managed-validation/*.integration.test.ts"], maxWorkers: 1 },
});
