/** Candidate only: original Effect services resolve settings; no service is started. */
import * as NodeCrypto from '@effect/platform-node/NodeCrypto';
import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import * as NodeServices from '@effect/platform-node/NodeServices';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as FileSystem from 'effect/FileSystem';
import * as DesktopEnvironment from '../app/DesktopEnvironment.ts';
import * as DesktopManagedPolicy from '../app/DesktopManagedPolicy.ts';
import * as DesktopAppSettings from '../settings/DesktopAppSettings.ts';
import * as DesktopNetworkInterfaces from '../backend/DesktopNetworkInterfaces.ts';
import * as DesktopServerExposure from '../backend/DesktopServerExposure.ts';
import * as ServerConfig from '../../../server/src/config.ts';
import { readExistingEnvironmentId } from '../../../server/src/environment/ServerEnvironmentIdentityRead.ts';
import {EnvironmentId} from '@t3tools/contracts';
import path from 'node:path';

export interface EffectiveInput { readonly ownerRoot:string; readonly port:number }
export interface EffectiveOutput {readonly schema:1;readonly host:'127.0.0.1'|'0.0.0.0';readonly port:number;readonly tailscaleServeEnabled:boolean;readonly tailscaleServePort:number;readonly environmentId:string}
const writes=new Set<PropertyKey>(['writeFile','writeFileString','makeDirectory','makeTempDirectory','makeTempDirectoryScoped','makeTempFile','makeTempFileScoped','link','symlink','rename','remove','copy','copyFile','chmod','chown','truncate','utimes','open']);
// The exact original reader needs exists/readFileString. Block every mutating or
// ambiguous open capability as defense against accidentally constructing another layer.
const readOnlyFs=Layer.effect(FileSystem.FileSystem,Effect.map(FileSystem.FileSystem,fs=>new Proxy(fs,{get(target,key){if(writes.has(key))return ()=>Effect.die(new Error('effective-config-write-denied'));return Reflect.get(target,key)}})));
export async function resolveEffectiveConfiguration(input:EffectiveInput):Promise<EffectiveOutput> {
 if(!path.isAbsolute(input.ownerRoot)||/[\x00-\x1f\x7f]/.test(input.ownerRoot)||!Number.isInteger(input.port)||input.port<1||input.port>65535)throw Error('effective-config-invalid-input');
 const profile=path.join(input.ownerRoot,'native-desktop-profile-v1');
 const configuration=ConfigProvider.layer(ConfigProvider.fromEnv({env:{T3CODE_HOME:profile}}));
 const environment:DesktopEnvironment.MakeDesktopEnvironmentInput={dirname:path.dirname(process.execPath),homeDirectory:path.join(profile,'home'),platform:process.platform,processArch:process.arch,appVersion:'0.1.7',appPath:path.dirname(process.execPath),isPackaged:true,resourcesPath:path.dirname(process.execPath),runningUnderArm64Translation:false};
 const filesystem=readOnlyFs.pipe(Layer.provideMerge(NodeServices.layer));
 const foundation=Layer.mergeAll(DesktopAppSettings.layer,DesktopManagedPolicy.layer).pipe(Layer.provideMerge(DesktopEnvironment.layer(environment)));
 const runtime=ManagedRuntime.make(DesktopServerExposure.layer.pipe(Layer.provideMerge(DesktopNetworkInterfaces.layer),Layer.provideMerge(foundation),Layer.provideMerge(Layer.mergeAll(filesystem,NodeCrypto.layer)),Layer.provide(NodeHttpClient.layerUndici),Layer.provide(configuration)));
 try{return await runtime.runPromise(Effect.gen(function*(){
  const settings=yield* DesktopAppSettings.DesktopAppSettings;
  const loaded=yield* settings.load;
  if(!loaded.localEnvironmentEnabled)return yield* Effect.fail(new Error('effective-config-local-environment-disabled'));
  // GUI settings and server identity intentionally use different native-owned roots.
  const paths=yield* ServerConfig.deriveServerPaths(path.join(input.ownerRoot,'host'),undefined,{baseDirIsExplicit:true});
  const existing=yield* readExistingEnvironmentId(paths.environmentIdPath);
  if(existing===null||existing.length>128||/[\x00-\x1f\x7f]/.test(existing))return yield* Effect.fail(new Error('effective-config-existing-identity-required'));
  const environmentId=EnvironmentId.make(existing);
  const exposure=yield* DesktopServerExposure.DesktopServerExposure;
  yield* exposure.configureFromSettings({port:input.port});
  const value=yield* exposure.backendConfig;
  if(!['127.0.0.1','0.0.0.0'].includes(value.bindHost)||value.port!==input.port||!Number.isInteger(value.tailscaleServePort)||value.tailscaleServePort<1||value.tailscaleServePort>65535)return yield* Effect.fail(new Error('effective-config-invalid-result'));
  return {schema:1 as const,host:value.bindHost as EffectiveOutput['host'],port:value.port,tailscaleServeEnabled:value.tailscaleServeEnabled,tailscaleServePort:value.tailscaleServePort,environmentId};
 }))}finally{await runtime.dispose()}
}
