import { defineConfig } from "vite-plus";
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { environment: "node", maxWorkers: 1, include: [
    "apps/web/src/hostedPairing.test.ts",
    "apps/web/src/BlackcrabHosted.test.ts",
  ] },
});
