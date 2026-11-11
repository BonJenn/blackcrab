import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppState, type AppStateStatus } from 'react-native';
import {
  createAppUpdateDeferral,
  installAppUpdateChecks,
  runAppUpdateCheck,
  type AppUpdateClient,
} from '../.generated/native-ui/apps/mobile/src/features/updates/app-updates';

vi.mock('expo-updates', () => ({ isEnabled: false }));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function client(isEnabled = true): AppUpdateClient {
  return {
    isEnabled,
    checkForUpdateAsync: vi.fn(async () => ({ isAvailable: false, isRollBackToEmbedded: false })),
    fetchUpdateAsync: vi.fn(),
    reloadAsync: vi.fn(),
  };
}

it('unconfigured native builds do not check, download, reload or attach a foreground listener', async () => {
  const disabled = client(false);
  const dispose = installAppUpdateChecks(disabled);
  await runAppUpdateCheck({ client: disabled, applyMode: 'immediate' });
  dispose();
  expect(disabled.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(disabled.fetchUpdateAsync).not.toHaveBeenCalled();
  expect(disabled.reloadAsync).not.toHaveBeenCalled();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
});

it('development clients do not attempt OTA even if the native module reports enabled', async () => {
  vi.stubGlobal('__DEV__', true);
  const development = client();
  installAppUpdateChecks(development)();
  await runAppUpdateCheck({ client: development });
  expect(development.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
});

it('rechecks after a long background stay, while ignoring short stays and pending installs', async () => {
  const enabled = client(), deferral = createAppUpdateDeferral(), remove = vi.fn();
  let change!: (state: AppStateStatus) => void;
  vi.mocked(AppState.addEventListener).mockImplementationOnce((_event, listener) => {
    change = listener as typeof change;
    return { remove };
  });
  const dispose = installAppUpdateChecks(enabled, deferral);
  await vi.runAllTimersAsync();
  expect(enabled.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  change('background');
  vi.setSystemTime(14 * 60_000);
  change('active');
  await vi.runAllTimersAsync();
  expect(enabled.checkForUpdateAsync).toHaveBeenCalledTimes(1);

  change('background');
  vi.setSystemTime(29 * 60_000);
  change('inactive');
  change('active');
  await vi.runAllTimersAsync();
  expect(enabled.checkForUpdateAsync).toHaveBeenCalledTimes(2);

  deferral.pendingInstall = true;
  change('background');
  vi.setSystemTime(44 * 60_000);
  change('active');
  await vi.runAllTimersAsync();
  expect(enabled.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  dispose();
  expect(remove).toHaveBeenCalledOnce();
});
