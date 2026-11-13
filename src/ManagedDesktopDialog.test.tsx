import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {ManagedDesktopDialog} from "./ManagedDesktopDialog";
vi.mock("./ManagedServiceControls",()=>({ManagedServiceControls:()=> <section>Enable background service</section>}));
vi.mock("./ManagedNativeDesktopEntry",()=>({ManagedNativeDesktopEntry:()=> <button>Open full desktop</button>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("opens a modal with the service setup and desktop action together and an accessible close action",async()=>{
 const prototype=HTMLDialogElement.prototype;
 const originalShow=Object.getOwnPropertyDescriptor(prototype,"showModal"), originalClose=Object.getOwnPropertyDescriptor(prototype,"close");
 const show=vi.fn(function(this:HTMLDialogElement){this.open=true;}), close=vi.fn(function(this:HTMLDialogElement){this.open=false;});
 Object.defineProperty(prototype,"showModal",{configurable:true,value:show});
 Object.defineProperty(prototype,"close",{configurable:true,value:close});
 const node=document.createElement("div");document.body.append(node);const root=createRoot(node);const onClose=vi.fn();
 try {
  await act(async()=>root.render(<ManagedDesktopDialog onClose={onClose}/>));
  const dialog=node.querySelector("dialog")!;expect(dialog.open).toBe(true);expect(show).toHaveBeenCalledTimes(1);
  expect(dialog.textContent).toContain("Enable background service");expect(dialog.textContent).toContain("Open full desktop");
  act(()=>node.querySelector<HTMLButtonElement>('[aria-label="Close full desktop setup"]')!.click());expect(onClose).toHaveBeenCalledTimes(1);
 }finally{act(()=>root.unmount());node.remove();if(originalShow)Object.defineProperty(prototype,"showModal",originalShow);else Reflect.deleteProperty(prototype,"showModal");if(originalClose)Object.defineProperty(prototype,"close",originalClose);else Reflect.deleteProperty(prototype,"close");}
});
