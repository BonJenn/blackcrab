/** Root must invoke once at process boot with proof that no old managed reader was ever started. */
import type {ComponentType} from "react";
import {makeActivationOwner} from "./owned-activation-owner.mjs";
const slot=Symbol.for("blackcrab.mobile.full-ui.activation.v1");
export function activateFullNativeUI(verifyExclusiveOwnership:()=>void|Promise<void>){
 const global=globalThis as typeof globalThis & {[key:symbol]:{start():Promise<ComponentType>}|undefined};
 global[slot]??=makeActivationOwner({verifyExclusiveOwnership,loadFullApp:()=>require("./apps/mobile/src/App").default as ComponentType});
 return global[slot]!.start();
}
