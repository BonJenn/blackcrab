// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MobileQueueClient, type MobileQueueState } from "./client";
vi.mock("react-native",()=>({
  View:({children}:{children:ReactNode})=>createElement("div",null,children),
  ScrollView:({children}:{children:ReactNode})=>createElement("div",null,children),
  Text:({children}:{children:ReactNode})=>createElement("span",null,children),
  Pressable:({children,onPress,disabled,accessibilityLabel}:{children:ReactNode;onPress:()=>void;disabled:boolean;accessibilityLabel:string})=>createElement("button",{onClick:onPress,disabled,"aria-label":accessibilityLabel},children),
  TextInput:({value,onChangeText}:{value:string;onChangeText:(value:string)=>void})=>createElement("textarea",{value,onChange:(event:{target:{value:string}})=>onChangeText(event.target.value)}),
  StyleSheet:{create:(value:unknown)=>value},
}));
import { QueueControls } from "./QueueControls";
it("preserves stale edits and closes an editor only after the host accepts its save",async()=>{
  const client=new MobileQueueClient({read:async()=>null,write:async()=>{},remove:async()=>{}},()=>"id");
  const mutate=vi.spyOn(client,"mutate").mockResolvedValue(false);
  const state: MobileQueueState={loaded:true,connected:true,support:"available",busy:false,needsRefresh:false,pending:null,error:null,notice:null,queue:{threadId:"thread",revision:1,paused:true,items:[{commandId:"command",turnId:"turn",text:"original",createdAtMs:1,updatedAtMs:1}]}};
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const render=()=>act(()=>root.render(<QueueControls client={client} state={state} hostId="host" sessionId="session"/>));
  const button=(label:string)=>Array.from(container.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")===label)!;
  try {
    render();act(()=>button("Queue (1)").click());act(()=>button("Edit message 1").click());
    state.queue={...state.queue!,revision:2,items:[{...state.queue!.items[0],text:"changed elsewhere"}]};render();
    expect(container.querySelector("textarea")?.value).toBe("original");expect(button("Save message").disabled).toBe(true);
    act(()=>button("Cancel edit").click());act(()=>button("Edit message 1").click());
    expect(container.querySelector("textarea")?.value).toBe("changed elsewhere");
    await act(async()=>button("Save message").click());expect(container.querySelector("textarea")).not.toBeNull();
    expect(mutate).toHaveBeenCalledWith("host","session",2,{type:"edit",commandId:"command",text:"changed elsewhere"});
    mutate.mockResolvedValueOnce(true);await act(async()=>button("Save message").click());expect(container.querySelector("textarea")).toBeNull();
  } finally {act(()=>root.unmount());container.remove();client.dispose();}
});
