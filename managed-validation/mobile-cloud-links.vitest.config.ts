import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'vite-plus/test': 'vitest' } },
  test: {
    environment: 'node',
    include: [
      'managed-validation/mobile-cloud-links.test.ts',
      ...['connectAuth', 'providerAuthReturnUrl', 'threadLinks', 'promptLinks', 'remote', 'codexAuthHandoff']
        .map(name => `vendor/t3-mobile/packages/shared/src/${name}.test.ts`),
    ],
    maxWorkers: 1,
  },
});
