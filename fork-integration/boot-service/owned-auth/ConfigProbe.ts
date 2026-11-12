// Developer-only real original Config graph. No service layers or listener.
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import {resolveServerConfig} from "./apps/server/src/cli/config.ts";
import {ServiceLauncherHostProcess} from "./apps/server/src/cloud/serviceLauncherClient.ts";
import {readServiceEnvironment} from "./apps/server/src/serviceLauncher.ts";
import {isOwnedServiceConfig,proveOwnedServiceIdentity} from "./apps/server/src/OwnedServiceProof.ts";
const request=JSON.parse(process.env.BLACKCRAB_TEST_CONFIG!);
const none=Option.none();
const flags={mode:none,port:none,host:none,baseDir:Option.some(request.baseDir),cwd:Option.some(request.baseDir),devUrl:none,noBrowser:none,bootstrapFd:Option.none<number>(),autoBootstrapProjectFromCwd:none,logWebSocketEvents:none,tailscaleServeEnabled:none,tailscaleServePort:none,lan:none};
if(request.desktopBootstrap) flags.bootstrapFd=Option.some(0);
request.env=await readServiceEnvironment(request.baseDir,request.env);
const environment={...request.env,T3_SERVICE_LAUNCHER_CONTEXT:JSON.stringify(request.context)};
try {
 const config=await Effect.runPromise(resolveServerConfig(flags,none,{startupPresentation:"headless",selectAutomaticPort:()=>Effect.succeed(3773)}).pipe(
 Effect.provide(Layer.mergeAll(NodeServices.layer,NetService.layer,ConfigProvider.layer(ConfigProvider.fromEnv({env:request.env})))),
 Effect.provideService(HostProcess.Environment,environment),
 Effect.provideService(ServiceLauncherHostProcess,{connected:process.connected,send:()=>false,on:()=>{},off:()=>{}})));
 console.log(JSON.stringify({mode:config.mode,host:config.host??null,port:config.port,privateNetworkOnly:config.privateNetworkOnly??false,tailscaleServeEnabled:config.tailscaleServeEnabled,tailscaleServePort:config.tailscaleServePort,ownedConfigCaptured:isOwnedServiceConfig(config),cloneConfigCaptured:isOwnedServiceConfig({...config}),hasOwnedProof:!!proveOwnedServiceIdentity(config,'c'.repeat(64),{environmentId:request.context.ownedAuth?.environmentId??'unbound',serverVersion:'0.1.7',orchestrationProtocolVersion:2}),hasBrowserSocket:!!config.desktopBrowserSocket,browserSocketGeneration:config.desktopBrowserSocket?.generation??null,hasToken:!!config.desktopBootstrapToken,hasSecret:!!config.desktopBootstrapSecret}));
} catch {console.error("owned-config-probe-unavailable");process.exitCode=78}
if(process.connected)process.disconnect();
