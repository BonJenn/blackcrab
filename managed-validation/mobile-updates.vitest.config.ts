import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';

// The root and mobile workspaces can resolve different native package copies.
// Both suites must mock the same native modules used by the generated app.
const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url));

export default defineConfig({
  resolve: { alias: {
    'vite-plus/test': 'vitest',
    'expo-updates': mobileRequire.resolve('expo-updates'),
    'react-native': mobileRequire.resolve('react-native'),
  } },
  test: {
    environment: 'node',
    include: [
      'apps/mobile/.generated/native-ui/apps/mobile/src/features/updates/app-updates.test.ts',
      'apps/mobile/src/appUpdates.test.ts',
    ],
    maxWorkers: 1,
  },
});
