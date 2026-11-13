import {assert, it} from '@effect/vitest';
import {vi} from 'vite-plus/test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Updates from '../updates/DesktopUpdates.ts';
import * as Environment from './DesktopEnvironment.ts';
import * as Window from '../electron/ElectronWindow.ts';
import {layer} from './ManagedUpdates.ts';
const bridge = vi.hoisted(() => ({request:vi.fn(), close:vi.fn()}));
vi.mock('./ManagedBootstrap.mjs',()=>({descriptor:{control:{kind:'launcher-updates-fd-v1',fd:5}}}));
vi.mock('./managed-desktop/update-client.mjs',()=>({openUpdateClient:()=>bridge}));
const state = (overrides={}) => ({status:'idle',currentVersion:'0.4.4',availableVersion:null,downloadPercent:null,message:null,installing:false,...overrides});
const environment = {appVersion:'0.4.4',runtimeInfo:{hostArch:'arm64',appArch:'arm64',runningUnderArm64Translation:false}} as Environment.DesktopEnvironment['Service'];
const dependencies = Layer.mergeAll(Layer.succeed(Environment.DesktopEnvironment,environment), Layer.succeed(Window.ElectronWindow,{
 create:()=>Effect.die('unexpected window creation'), main:Effect.succeedNone, currentMainOrFirst:Effect.succeedNone, focusedMainOrFirst:Effect.succeedNone,
 setMain:()=>Effect.void, clearMain:()=>Effect.void, prepareReveal:()=>Effect.succeed(false), reveal:()=>Effect.void, sendAll:()=>Effect.void, destroyAll:Effect.void, syncAllAppearance:()=>Effect.void,
}));
const testLayer=layer.pipe(Layer.provide(dependencies));
it.effect('workspace checks, downloads and installs through the launcher with the exact downloaded version',()=>Effect.gen(function*(){
 bridge.request.mockReset();bridge.close.mockClear();
 bridge.request.mockImplementation(async (action:string,version?:string)=>({accepted:true,state:state(action==='check'?{status:'available',availableVersion:'0.4.5'}:action==='download'?{status:'downloaded',availableVersion:'0.4.5',downloadPercent:100}:{status:'downloaded',availableVersion:version,installing:true,message:'Installing update…'})}));
 yield* Effect.scoped(Effect.gen(function*(){
  const updates=yield* Updates.DesktopUpdates;
  assert.isTrue(Option.isNone(yield* updates.disabledReason));
  const checked=yield* updates.check('manual');assert.isTrue(checked.checked);assert.equal(checked.state.availableVersion,'0.4.5');
  const downloaded=yield* updates.download;assert.isTrue(downloaded.completed);assert.equal(downloaded.state.downloadPercent,100);
  const installed=yield* updates.install;assert.isTrue(installed.accepted);assert.isTrue(yield* updates.isInstallActive);
  assert.isFalse(installed.completed);assert.isNull(installed.state.message); // no spurious "Could not install" toast
  assert.deepEqual(bridge.request.mock.calls,[['check',null],['download',null],['install','0.4.5']]);
 }).pipe(Effect.provide(testLayer)));
 assert.equal(bridge.close.mock.calls.length,1);
}));
it.effect('a closed launcher channel returns an actionable failure instead of claiming updates are disabled',()=>Effect.scoped(Effect.gen(function*(){
 bridge.request.mockReset();bridge.request.mockRejectedValue('closed');
 const updates=yield* Updates.DesktopUpdates;
 const checked=yield* updates.check('manual');assert.isFalse(checked.checked);assert.isTrue(checked.state.enabled);assert.equal(checked.state.status,'error');assert.include(checked.state.message!,'Reopen the app');
 const nightly=yield* updates.setChannel('nightly').pipe(Effect.flip);assert.equal(nightly._tag,'DesktopUpdateChannelManagedError');
}).pipe(Effect.provide(testLayer))));
