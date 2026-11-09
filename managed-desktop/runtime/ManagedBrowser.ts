import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import {DesktopBrowserCommand,DesktopBrowserEvent} from "@t3tools/contracts";
import {connectBrowser} from "@t3tools/shared/leasedDesktopBrowser";
import * as BrowserHost from "../preview/DesktopBrowserHost.ts";
import {descriptor} from "./ManagedBootstrap.mjs";
import {inspectBrowserCapability} from "./managed-desktop/descriptor.mjs";
import {createBrowserPeer} from "./managed-desktop/browser-peer.mjs";

export const make = Effect.gen(function*(){
 if(!descriptor.browser)return {start:()=>{},stop:()=>{}};
 inspectBrowserCapability(descriptor);
 const browser=yield* BrowserHost.DesktopBrowserHost;
 const context=yield* Effect.context<BrowserHost.DesktopBrowserHost>();
 const runFork=Effect.runForkWith(context),runPromise=Effect.runPromiseWith(context);
 const peer=createBrowserPeer({config:{path:descriptor.browser.path,key:descriptor.browser.key,environmentId:descriptor.owner.environmentId,generation:descriptor.owner.generation,maxFrameBytes:64*1024*1024},connect:(config,hooks)=>{inspectBrowserCapability(descriptor);return connectBrowser(config,hooks);},validateCommand:Schema.is(DesktopBrowserCommand),begin:epoch=>browser.beginTransport?.(epoch),end:epoch=>browser.endTransport?.(epoch),subscribe:send=>{const fiber=runFork(Stream.runForEach(browser.events,bytes=>Schema.decodeEffect(Schema.fromJsonString(DesktopBrowserEvent))(new TextDecoder().decode(bytes)).pipe(Effect.flatMap(message=>Effect.promise(()=>send(message))))));return()=>{runFork(Fiber.interrupt(fiber));};},dispatch:(command,epoch,current)=>{const fiber=runFork(browser.handleCommandLine(JSON.stringify(command),epoch,current));return {done:runPromise(Fiber.await(fiber)),cancel:()=>{runFork(Fiber.interrupt(fiber));}};}});
 yield* Effect.addFinalizer(()=>Effect.sync(()=>peer.stop()));return peer;
});
