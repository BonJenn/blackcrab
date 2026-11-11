import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as Electron from "electron";
import * as Auth from "../backend/DesktopLocalEnvironmentAuth.ts";
import { descriptor } from "./ManagedBootstrap.mjs";
import { createAccessSession } from "./managed-desktop/access-session.mjs";
import { createCredentialBroker } from "./managed-desktop/credential-broker.mjs";
/** Original SDK exchange, independent one-time grants, bounded renewal; never owner credentials. */
export const layer = Layer.effect(Auth.DesktopLocalEnvironmentAuth,Effect.gen(function*(){
 const context=yield* Effect.context<HttpClient.HttpClient>();
 const run=Effect.runPromiseWith(context),broker=createCredentialBroker(descriptor,()=>Electron.app.quit());
 yield* Effect.addFinalizer(()=>Effect.sync(()=>broker.close()));
 const access=createAccessSession({onRevoked:()=>Electron.app.quit(),credential:descriptor.authorization.credential,renew:()=>broker.renew(),exchange:credential=>run(bootstrapRemoteBearerSession({httpBaseUrl:descriptor.owner.origin,credential,clientMetadata:{label:"Blackcrab Desktop",deviceType:"desktop"}})),validate:async token=>{
 // @effect-diagnostics-next-line globalFetch:off - Session validation is a bounded JS boundary and must not follow credential-bearing redirects.
 const response=await fetch(new URL("api/auth/session",descriptor.owner.origin),{headers:{Authorization:"Bearer "+token},redirect:"manual",signal:AbortSignal.timeout(10000)});if(response.status===401||response.status===403)return false;if(!response.ok)throw Error("Native session validation unavailable");return (await response.json()).authenticated===true;}});
 return Auth.DesktopLocalEnvironmentAuth.of({getBearerToken:Effect.tryPromise({try:()=>access.get(),catch:()=>new Auth.DesktopLocalEnvironmentAuthSessionBootstrapError({cause:new Error("Blackcrab client session unavailable; owner credential renewal required")})})});
}));
