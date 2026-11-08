import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["managed-validation/*.integration.test.ts"], maxWorkers: 1 } });
