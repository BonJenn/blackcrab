import type { DesktopUpdateState, DesktopUpdateChannel } from '@t3tools/contracts';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import * as DateTime from 'effect/DateTime';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as PubSub from 'effect/PubSub';
import * as Ref from 'effect/Ref';
import * as Semaphore from 'effect/Semaphore';
import * as Stream from 'effect/Stream';
import * as Updates from '../updates/DesktopUpdates.ts';
import * as Environment from './DesktopEnvironment.ts';
import * as Window from '../electron/ElectronWindow.ts';
import {UPDATE_STATE_CHANNEL} from '../ipc/channels.ts';
import {createInitialDesktopUpdateState} from '../updates/updateMachine.ts';
import {descriptor} from './ManagedBootstrap.mjs';
import {openUpdateClient, type LauncherUpdateState} from './managed-desktop/update-client.mjs';

class UpdateConnectionError extends Schema.TaggedError<UpdateConnectionError, { readonly brand: unique symbol }>()('UpdateConnectionError', {}) {}

/** Expose the existing workspace UI through the signed outer-app updater. */
export const layer = Layer.effect(Updates.DesktopUpdates, Effect.gen(function* () {
  const environment = yield* Environment.DesktopEnvironment;
  const windows = yield* Window.ElectronWindow;
  const enabled = descriptor.control.kind === 'launcher-updates-fd-v1';
  const initial = {...createInitialDesktopUpdateState(environment.appVersion, environment.runtimeInfo, 'latest'), enabled,
    status: enabled ? 'idle' as const : 'disabled' as const,
    message: enabled ? null : 'Open the installed Blackcrab app to manage updates.'};
  const state = yield* Ref.make<DesktopUpdateState>(initial);
  const installActive = yield* Ref.make(false);
  const changes = yield* PubSub.sliding<DesktopUpdateState>(16);
  const mutex = yield* Semaphore.make(1);
  const configured = yield* Ref.make(false);
  const client = enabled ? openUpdateClient(descriptor.control) : null;
  yield* Effect.addFinalizer(() => Effect.sync(() => client?.close()));
  const emitState = Ref.get(state).pipe(Effect.flatMap(s => windows.sendAll(UPDATE_STATE_CHANNEL, s)));
  const setState = (next: DesktopUpdateState) => mutex.withPermits(1)(Effect.gen(function* () {
    yield* Ref.set(state, next); yield* PubSub.publish(changes, next); yield* emitState;
  }));
  const receive = Effect.fn('ManagedUpdates.receive')(function* (s: LauncherUpdateState) {
    const before = yield* Ref.get(state);
    yield* Ref.set(installActive, s.installing);
    const next: DesktopUpdateState = {...before, enabled:true, currentVersion:s.currentVersion, status:s.status,
      availableVersion:s.availableVersion, downloadedVersion:s.status === 'downloaded' ? s.availableVersion : null,
      // The existing workspace treats a message on an incomplete accepted
      // action as failure. Installation progress belongs to the visible launcher.
      downloadPercent:s.downloadPercent, message:s.installing ? null : s.message,
      errorContext:s.message && s.status === 'error' ? 'check' : null, canRetry:!s.installing && !['checking','downloading'].includes(s.status),
      checkedAt:s.status === 'checking' && before.status !== 'checking' ? yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)) : before.checkedAt};
    if (!Object.entries(next).every(([key, value]) => before[key as keyof DesktopUpdateState] === value)) yield* setState(next);
  });
  const request = Effect.fn('ManagedUpdates.request')(function* (action:'status'|'check'|'download'|'install', version:string|null = null) {
    if (!client) return false;
    const reply = yield* Effect.tryPromise({try:() => client.request(action, version), catch:() => new UpdateConnectionError()}).pipe(Effect.option);
    if (Option.isNone(reply)) {
      yield* setState({...yield* Ref.get(state), status:'error', message:'Could not contact the Blackcrab updater. Reopen the app and try again.', errorContext:'check', canRetry:true});
      return false;
    }
    yield* receive(reply.value.state); return reply.value.accepted;
  });
  const action = Effect.fn('ManagedUpdates.action')(function* (kind:'check'|'download'|'install', version:string|null = null) {
    const accepted = yield* request(kind, version);
    if (accepted && kind !== 'install') {
      const limit = kind === 'check' ? 40 : 1800;
      for (let i=0; i<limit; i++) {
        const current = yield* Ref.get(state);
        if (!['checking','downloading'].includes(current.status)) break;
        yield* Effect.sleep('1 second'); if (!(yield* request('status'))) break;
      }
    }
    const current = yield* Ref.get(state);
    return {accepted, completed:accepted && (kind === 'download' ? current.status === 'downloaded' : kind === 'check' && ['available','downloaded','up-to-date'].includes(current.status)), state:current};
  });
  return Updates.DesktopUpdates.of({
    getState:Ref.get(state), emitState, disabledReason:Effect.succeed(enabled ? Option.none() : Option.some(initial.message!)),
    isInstallActive:Ref.get(installActive), isActionActive:Effect.gen(function* () { return (yield* Ref.get(installActive)) || ['checking','downloading'].includes((yield* Ref.get(state)).status); }),
    subscribe:mutex.withPermits(1)(Effect.gen(function* () { const subscription = yield* PubSub.subscribe(changes); return {latest:yield* Ref.get(state), changes:Stream.fromSubscription(subscription)}; })),
    configure:Effect.gen(function* () {
      if (yield* Ref.getAndSet(configured, true)) return;
      yield* request('status');
      yield* Effect.sleep('1 second').pipe(Effect.andThen(request('status')), Effect.forever, Effect.forkScoped);
    }),
    setChannel:Effect.fn('ManagedUpdates.setChannel')((channel: DesktopUpdateChannel): Effect.Effect<DesktopUpdateState, Updates.DesktopUpdateSetChannelError> => channel === 'latest' ? Ref.get(state) : Effect.fail(new Updates.DesktopUpdateChannelManagedError({channel, policyMessage:'Blackcrab currently publishes stable updates only.'}))),
    check:Effect.fn('ManagedUpdates.check')(() => action('check').pipe(Effect.map(result => ({checked:result.completed, state:result.state})))),
    download:action('download'),
    install:Effect.gen(function* () { const current = yield* Ref.get(state); return yield* action('install', current.downloadedVersion); }),
    installPrepared:Effect.fn('ManagedUpdates.installPrepared')((version) => action('install', version).pipe(Effect.map(result => ({...result, failed:!result.accepted})))),
  });
}));
