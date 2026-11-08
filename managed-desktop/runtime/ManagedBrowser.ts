import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import {DesktopBrowserCommand} from "@t3tools/contracts";
import {connectBrowser} from "@t3tools/shared/leasedDesktopBrowser";
import * as BrowserHost from "../preview/DesktopBrowserHost.ts";
import {descriptor} from "./ManagedBootstrap.mjs";
import {inspectBrowserCapability} from "./managed-desktop/descriptor.mjs";
import {createBrowserPeer} from "./managed-desktop/browser-peer.mjs";

export const make = Effect.gen(function*(){
 if(!descriptor.browser)return {start:()=>{},stop:()=>{}};
 inspectBrowserCapability(descriptor);
 const browser=yield* BrowserHost.DesktopBrowserHost;
 const peer=createBrowserPeer({config:{path:descriptor.browser.path,key:descriptor.browser.key,environmentId:descriptor.owner.environmentId,generation:descriptor.owner.generation,maxFrameBytes:64*1024*1024},connect:(config,hooks)=>{inspectBrowserCapability(descriptor);return connectBrowser(config,hooks);},validateCommand:Schema.is(DesktopBrowserCommand),begin:epoch=>browser.beginTransport?.(epoch),end:epoch=>browser.endTransport?.(epoch),subscribe:send=>{const fiber=Effect.runFork(Stream.runForEach(browser.events,bytes=>Effect.promise(()=>send(JSON.parse(new TextDecoder().decode(bytes))))));return()=>{Effect.runFork(Fiber.interrupt(fiber));};},dispatch:(command,epoch,current)=>{const fiber=Effect.runFork(browser.handleCommandLine(JSON.stringify(command),epoch,current));return {done:Effect.runPromise(Fiber.await(fiber)),cancel:()=>{Effect.runFork(Fiber.interrupt(fiber));}};}});
 yield* Effect.addFinalizer(()=>Effect.sync(()=>peer.stop()));return peer;
});
