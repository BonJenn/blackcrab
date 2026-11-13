import {act} from "react";import {createRoot} from "react-dom/client";import {expect,it,vi} from "vitest";
import {ManagedNativeDesktopEntry} from "./ManagedNativeDesktopEntry";
import {managedNativeDesktopClient,readManagedNativeDesktopStatus,type ManagedNativeDesktopClient,type ManagedNativeDesktopStatus} from "./managedNativeDesktopClient";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn(),isTauri:()=>true}));
import {invoke} from "@tauri-apps/api/core";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function surface(client:ManagedNativeDesktopClient){const node=document.createElement("div");document.body.append(node);const root=createRoot(node);return {node,render:(next=client)=>act(()=>root.render(<ManagedNativeDesktopEntry client={next}/>)),button:()=>node.querySelector("button")!,dispose:()=>{act(()=>root.unmount());node.remove();}};}
it("uses only fixed native commands and rejects malformed native status",async()=>{
 vi.mocked(invoke).mockResolvedValue({state:"ready"});await managedNativeDesktopClient.status();expect(invoke).toHaveBeenLastCalledWith("managed_native_desktop_status");
 await managedNativeDesktopClient.open();expect(invoke).toHaveBeenLastCalledWith("managed_native_desktop_open");
 for(const value of [{state:"ready",path:"/untrusted"},{state:"bogus"},{state:"ready",error:1},null])expect(()=>readManagedNativeDesktopStatus(value)).toThrow();
});
it("shows native string rejections during status and open",async()=>{
 const api={status:vi.fn<ManagedNativeDesktopClient["status"]>().mockRejectedValue("Desktop status permission was denied."),open:vi.fn<ManagedNativeDesktopClient["open"]>().mockRejectedValue("The workspace could not be attached.")};
 const view=surface(api);
 try {
  await act(async()=>view.render());
  expect(view.node.querySelector('[role="alert"]')?.textContent).toBe("Desktop status permission was denied.");
  expect(view.button().disabled).toBe(true);
  api.status.mockResolvedValue({state:"ready"});
  await act(async()=>view.node.querySelectorAll("button")[1].click());
  await act(async()=>view.button().click());
  expect(view.node.querySelector('[role="alert"]')?.textContent).toBe("The workspace could not be attached.");
 }finally{view.dispose();}
});
it("disables unavailable bundle; opens once while pending and preserves actionable error",async()=>{
 const pending=deferred<ManagedNativeDesktopStatus>();const api={status:vi.fn(async():Promise<ManagedNativeDesktopStatus>=>({state:"notBundled"})),open:vi.fn(()=>pending.promise)};const view=surface(api);
 try {await act(async()=>view.render());expect(view.node.textContent).toContain("unavailable in this installation");expect(view.button().disabled).toBe(true);
 api.status.mockResolvedValue({state:"ready"});await act(async()=>view.node.querySelectorAll("button")[1].click());
 act(()=>{view.button().click();view.button().click();});expect(api.open).toHaveBeenCalledTimes(1);expect(view.button().disabled).toBe(true);
 await act(async()=>pending.reject(new Error("Desktop could not open.")));expect(view.node.querySelector('[role="alert"]')?.textContent).toBe("Desktop could not open.");expect(view.button().disabled).toBe(false);
 }finally{view.dispose();}
});
it("ignores old status and open replies after client replacement and unmount",async()=>{
 const old=deferred<ManagedNativeDesktopStatus>(),opening=deferred<ManagedNativeDesktopStatus>();const first={status:()=>old.promise,open:()=>opening.promise};
 const second={status:vi.fn(async():Promise<ManagedNativeDesktopStatus>=>({state:"ready"})),open:()=>opening.promise};const view=surface(first);
 view.render();await act(async()=>view.render(second));await act(async()=>old.resolve({state:"notBundled"}));expect(view.node.textContent).toContain("ready to open");
 act(()=>view.button().click());await act(async()=>view.render({status:async()=>({state:"notBundled"}),open:async()=>({state:"unavailable"})}));
 await act(async()=>opening.resolve({state:"running"}));expect(view.node.textContent).toContain("unavailable in this installation");view.dispose();
});
