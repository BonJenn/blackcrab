/** Staged at apps/desktop/src/blackcrab/ExposureRuntime.ts in a verified pinned source.
 * Native owner startup supplies these paths. This module is not a public RPC or installer.
 */
import * as NodeCrypto from '@effect/platform-node/NodeCrypto';
import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import * as NodeServices from '@effect/platform-node/NodeServices';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as DesktopEnvironment from '../app/DesktopEnvironment.ts';
import * as DesktopManagedPolicy from '../app/DesktopManagedPolicy.ts';
import * as DesktopAppSettings from '../settings/DesktopAppSettings.ts';
import * as DesktopNetworkInterfaces from '../backend/DesktopNetworkInterfaces.ts';
import * as DesktopServerExposure from '../backend/DesktopServerExposure.ts';
import {isAbsolute} from 'node:path';

/** Keep the original typed failure, rather than replacing it with a Promise FiberFailure. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(effect.pipe(Effect.match({
    onFailure: error => ({ok:false as const, error}),
    onSuccess: value => ({ok:true as const, value}),
  })));
  if (!result.ok) throw result.error;
  return result.value;
}
export async function createOwnerExposureRuntime({environment, stateHome, port}: {
  environment: DesktopEnvironment.MakeDesktopEnvironmentInput;
  /** Existing private owner state directory; its native caller verifies ownership/exclusivity. */
  stateHome: string;
  port: number;
}) {
  if (!isAbsolute(stateHome) || /[\x00-\x1f\x7f]/.test(stateHome) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || !environment.isPackaged)
    throw new Error('Invalid private owner exposure configuration');
  // No ambient T3CODE_HOME, LAN overrides, development server or hosted endpoint settings.
  const configuration = ConfigProvider.layer(ConfigProvider.fromEnv({env:{T3CODE_HOME:stateHome}}));
  const foundation = Layer.mergeAll(DesktopAppSettings.layer, DesktopManagedPolicy.layer).pipe(
    Layer.provideMerge(DesktopEnvironment.layer({...environment})),
  );
  const runtime = ManagedRuntime.make(DesktopServerExposure.layer.pipe(
    Layer.provideMerge(DesktopNetworkInterfaces.layer),
    Layer.provideMerge(foundation),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(configuration),
  ));
  try {
    const service = await runtime.runPromise(Effect.gen(function* () {
      const settings = yield* DesktopAppSettings.DesktopAppSettings;
      yield* settings.load;
      const exposure = yield* DesktopServerExposure.DesktopServerExposure;
      yield* exposure.configureFromSettings({port});
      return exposure;
    }));
    return Object.freeze({
      getState: () => run(service.getState),
      getBackendConfig: () => run(service.backendConfig),
      getAdvertisedEndpoints: () => run(service.getAdvertisedEndpoints),
      configure: (port:number) => {
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          return Promise.reject(new Error('Invalid owner backend port'));
        return run(service.configureFromSettings({port}));
      },
      setMode: (mode: Parameters<typeof service.setMode>[0]) => run(service.setMode(mode)),
      setTailscaleServeEnabled: (input: Parameters<typeof service.setTailscaleServeEnabled>[0]) =>
        run(service.setTailscaleServeEnabled(input)),
      dispose: () => runtime.dispose(),
    });
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
