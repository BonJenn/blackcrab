import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowUpQueue, QueueRequestAction, QueueResultEvent, RemoteEvent } from "@blackcrab/remote-protocol";
import type { Transport, TransportListener, TransportStatus } from "../transport/types";
import { MobileQueueClient } from "./client";
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }
const flush=async()=>{for(let i=0;i<6;i++) await Promise.resolve();};
function fixture() {
  const saved=new Map<string,string>();
  const storage={read:vi.fn(async(key:string)=>saved.get(key) ?? null),write:vi.fn(async(key:string,value:string)=>{saved.set(key,value);}),remove:vi.fn(async(key:string)=>{saved.delete(key);})};
  const events=new Set<(event:RemoteEvent)=>void>(),statuses=new Set<TransportListener>();
  let status: TransportStatus={state:"connected",hostId:"host",sinceMs:0};
  const actions: QueueRequestAction[]=[];
  const transport: Transport={status:()=>status,subscribe:callback=>{statuses.add(callback);return()=>{statuses.delete(callback);};},subscribeEvents:callback=>{events.add(callback);return()=>{events.delete(callback);};},send:()=>{},sendAction:vi.fn(action=>{actions.push(action as QueueRequestAction);return status.state==="connected";}),close:()=>{}};
  let next=0;
  const client=new MobileQueueClient(storage,()=>`id-${++next}`,100);
  const queue:FollowUpQueue={threadId:"thread",revision:0,paused:false,items:[]};
  const emit=(event:RemoteEvent)=>events.forEach(callback=>callback(event));
  const reply=(action=actions[actions.length-1],patch:Partial<QueueResultEvent>={})=>emit({type:"queue_result",hostId:action.hostId,sessionId:action.sessionId,requestId:action.requestId,ok:true,error:null,queue:structuredClone(queue),receipt:null,...patch});
  const receipt=(action=actions[actions.length-1],state="queued")=>({commandId:action.operation.type==="enqueue" ? action.operation.commandId : "none",threadId:"thread",turnId:"turn",status:state,createdAtMs:1,updatedAtMs:1,detail:null}) as NonNullable<QueueResultEvent["receipt"]>;
  const open=async()=>{client.bind(transport,"host");await client.open("host","session");if(actions.length)reply();await flush();};
  return {client,storage,saved,transport,actions,events,statuses,queue,emit,reply,receipt,open,setStatus:(state:TransportStatus["state"])=>{status={...status,state};statuses.forEach(callback=>callback(status));}};
}
afterEach(()=>vi.useRealTimers());
describe("phone host queue client",()=>{
  it("persists a stable command before wire delivery and clears it only after its receipt",async()=>{
    const f=fixture();await f.open();
    const write=deferred<void>();f.storage.write.mockImplementationOnce(async(key,value)=>{await write.promise;f.saved.set(key,value);});
    const sent=f.client.enqueue("host","session","original");
    expect(f.actions).toHaveLength(1);expect(f.client.state("host","session").busy).toBe(true);
    write.resolve();expect(await sent).toBe(true);
    expect(f.saved.size).toBe(1);expect(f.actions[1].operation).toEqual({type:"enqueue",commandId:"id-2",body:"original"});
    f.reply(undefined,{receipt:f.receipt()});await flush();
    expect(f.saved.size).toBe(0);expect(f.client.state("host","session").pending).toBeNull();f.client.dispose();
  });
  it("preserves the composer on storage failure and never calls legacy immediate send",async()=>{
    const f=fixture();await f.open();f.storage.write.mockRejectedValueOnce(new Error("disk full"));
    expect(await f.client.enqueue("host","session","draft")).toBe(false);expect(f.actions).toHaveLength(1);
    expect(f.client.state("host","session").error).toContain("draft is unchanged");f.client.dispose();
  });
  it("recovers a lost acknowledgement with an explicit retry of the original ID and body",async()=>{
    vi.useFakeTimers();const f=fixture();await f.open();await f.client.enqueue("host","session","original");
    const first=f.actions[1];vi.advanceTimersByTime(101);
    expect(f.client.state("host","session").pending?.body).toBe("original");
    f.client.refresh("host","session");f.reply();await flush();
    f.client.retry("host","session");expect(f.actions[3].operation).toEqual(first.operation);
    f.reply(undefined,{receipt:f.receipt(undefined,"uncertain")});await flush();
    expect(f.client.state("host","session").pending).toBeNull();expect(f.client.state("host","session").notice).toContain("uncertain");f.client.dispose();
  });
  it("loads recovery data after restart without automatically resubmitting",async()=>{
    const f=fixture();await f.open();await f.client.enqueue("host","session","original");const first=f.actions[1];f.client.dispose();
    const reloaded=new MobileQueueClient(f.storage,()=>"new-request",100);reloaded.bind(f.transport,"host");await reloaded.open("host","session");
    expect(f.actions.filter(a=>a.operation.type==="enqueue")).toHaveLength(1);
    f.reply();await flush();reloaded.retry("host","session");expect(f.actions[f.actions.length-1].operation).toEqual(first.operation);reloaded.dispose();
  });
  it("ignores results from another host, session, or unrecognized request",async()=>{
    const f=fixture();await f.open();await f.client.enqueue("host","session","original");
    for(const patch of [{hostId:"other"},{sessionId:"other"},{requestId:"unknown"}])f.reply(undefined,{...patch,receipt:f.receipt()});
    await flush();expect(f.saved.size).toBe(1);expect(f.client.state("host","session").busy).toBe(true);
    f.reply(undefined,{receipt:{...f.receipt(),threadId:"wrong"}});await flush();expect(f.saved.size).toBe(1);f.client.dispose();
  });
  it("requires a fresh snapshot after disconnect and never replays mutations",async()=>{
    const f=fixture();await f.open();const mutation=f.client.mutate("host","session",0,{type:"pause"});
    f.setStatus("disconnected");expect(await mutation).toBe(false);f.setStatus("connected");
    expect(f.actions.map(a=>a.operation.type)).toEqual(["get","update","get"]);f.reply();await flush();
    expect(f.client.state("host","session").needsRefresh).toBe(false);f.client.dispose();expect(f.events.size).toBe(0);expect(f.statuses.size).toBe(0);
  });
  it("passes the editor revision unchanged and retains the host conflict snapshot",async()=>{
    const f=fixture();await f.open();f.emit({type:"queue_snapshot",hostId:"host",sessionId:"session",queue:{...f.queue,revision:5}});
    const mutation=f.client.mutate("host","session",2,{type:"edit",commandId:"a",text:"edit"});
    expect(f.actions[1].operation).toMatchObject({type:"update",expectedRevision:2});
    f.reply(undefined,{ok:false,error:"queue changed",queue:{...f.queue,revision:6}});
    expect(await mutation).toBe(false);expect(f.client.state("host","session").queue?.revision).toBe(6);f.client.dispose();
  });
  it("ignores lower revisions and old transport callbacks",async()=>{
    const f=fixture();await f.open();const old=[...f.events][0];
    f.emit({type:"queue_snapshot",hostId:"host",sessionId:"session",queue:{...f.queue,revision:7}});
    f.emit({type:"queue_snapshot",hostId:"host",sessionId:"session",queue:{...f.queue,revision:2}});
    expect(f.client.state("host","session").queue?.revision).toBe(7);
    f.client.bind(null,null);old({type:"queue_snapshot",hostId:"host",sessionId:"session",queue:{...f.queue,revision:9}});
    expect(f.client.state("host","session").queue?.revision).toBe(7);f.client.dispose();
  });
  it("leaves a saved message for explicit retry when the connection changes during disk persistence",async()=>{
    const f=fixture();await f.open();const write=deferred<void>();f.storage.write.mockImplementationOnce(async(key,value)=>{await write.promise;f.saved.set(key,value);});
    const sent=f.client.enqueue("host","session","draft");f.setStatus("disconnected");f.setStatus("connected");write.resolve();
    expect(await sent).toBe(true);expect(f.actions.filter(a=>a.operation.type==="enqueue")).toHaveLength(0);expect(f.client.state("host","session").pending?.body).toBe("draft");f.client.dispose();
  });
  it("cannot clear a newer saved message with a duplicate old acknowledgement",async()=>{
    const f=fixture();await f.open();await f.client.enqueue("host","session","first");const first=f.actions[1];const oldReceipt=f.receipt();
    f.reply(first,{receipt:oldReceipt});await flush();await f.client.enqueue("host","session","second");
    f.reply(first,{receipt:oldReceipt});await flush();expect(f.client.state("host","session").pending?.body).toBe("second");expect(f.saved.size).toBe(1);f.client.dispose();
  });
  it("blocks unknown hosts without a legacy send fallback",async()=>{
    vi.useFakeTimers();const f=fixture();f.client.bind(f.transport,"host");await f.client.open("host","session");vi.advanceTimersByTime(101);
    expect(f.client.state("host","session").support).toBe("unavailable");expect(await f.client.enqueue("host","session","draft")).toBe(false);expect(f.actions).toHaveLength(1);f.client.dispose();
  });
  it("retains the same ID if local confirmation cleanup fails",async()=>{
    const f=fixture();await f.open();await f.client.enqueue("host","session","original");const operation=f.actions[1].operation;
    f.storage.remove.mockRejectedValueOnce(new Error("disk error"));f.reply(undefined,{receipt:f.receipt()});await flush();
    expect(f.client.state("host","session").pending).not.toBeNull();f.client.retry("host","session");expect(f.actions[2].operation).toEqual(operation);
    f.reply(undefined,{receipt:f.receipt()});await flush();expect(f.saved.size).toBe(0);f.client.dispose();
  });
  it("protects unreadable recovery data from being overwritten",async()=>{
    const f=fixture();f.storage.read.mockResolvedValueOnce("{broken");await f.open();
    expect(await f.client.enqueue("host","session","draft")).toBe(false);expect(f.storage.write).not.toHaveBeenCalled();f.client.dispose();
  });
  it("retains unknown delivery when the socket rejects the handoff",async()=>{
    const f=fixture();await f.open();vi.mocked(f.transport.sendAction).mockReturnValueOnce(false);
    await f.client.enqueue("host","session","draft");expect(f.client.state("host","session").busy).toBe(false);expect(f.client.state("host","session").pending?.body).toBe("draft");f.client.dispose();
  });
});
