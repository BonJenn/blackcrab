import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    maxWorkers: 1,
    include: [
      "packages/shared/src/OwnedCloud.test.ts",
      "packages/shared/src/connectAuth.test.ts",
      "packages/shared/src/providerAuthReturnUrl.test.ts",
      "packages/shared/src/threadLinks.test.ts",
      "packages/shared/src/promptLinks.test.ts",
      "packages/shared/src/remote.test.ts",
      "packages/shared/src/codexAuthHandoff.test.ts",
      "apps/desktop/src/app/ClerkTokenStore.test.ts",
      "apps/desktop/src/app/DesktopOwnedCloud.test.ts",
    ],
  },
});
