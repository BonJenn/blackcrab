import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowUpQueue, QueueRequestAction, QueueResultEvent, RemoteEvent } from "@blackcrab/remote-protocol";
import type { Transport, TransportListener, TransportStatus } from "../transport/types";
import { MobileDraftClient } from "../drafts/client";
import { MobileQueueClient } from "./client";
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }
const flush=async()=>{for(let i=0;i<6;i++) await Promise.resolve();};
function fixture(settleDraft?: ConstructorParameters<typeof MobileQueueClient>[3]) {
  const saved=new Map<string,string>();
  const storage={read:vi.fn(async(key:string)=>saved.get(key) ?? null),write:vi.fn(async(key:string,value:string)=>{saved.set(key,value);}),remove:vi.fn(async(key:string)=>{saved.delete(key);})};
  const events=new Set<(event:RemoteEvent)=>void>(),statuses=new Set<TransportListener>();
  let status: TransportStatus={state:"connected",hostId:"host",sinceMs:0};
  const actions: QueueRequestAction[]=[];
  const transport: Transport={status:()=>status,subscribe:callback=>{statuses.add(callback);return()=>{statuses.delete(callback);};},subscribeEvents:callback=>{events.add(callback);return()=>{events.delete(callback);};},send:()=>{},sendAction:vi.fn(action=>{actions.push(action as QueueRequestAction);return status.state==="connected";}),close:()=>{}};
  let next=0;
  const client=new MobileQueueClient(storage,()=>`id-${++next}`,100,settleDraft);
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

it("keeps the original outbox until a confirmed message's draft is durably settled", async () => {
  const settle = vi.fn(async () => false), f = fixture(settle); await f.open();
  const transfer = { editId: "original-edit", text: " original " };
  expect(await f.client.enqueue("host", "session", "original", transfer)).toBe(true);
  expect(JSON.parse([...f.saved.values()][0]).draft).toEqual(transfer);
  f.reply(undefined, { receipt: f.receipt() }); await flush();
  expect(f.client.state("host", "session").pending?.body).toBe("original");
  expect(f.storage.remove).not.toHaveBeenCalled(); expect(f.client.state("host", "session").error).toContain("draft could not be settled");
  settle.mockResolvedValue(true); f.client.retry("host", "session"); f.reply(undefined, { receipt: f.receipt() }); await flush();
  expect(settle).toHaveBeenCalledWith("host", "session", transfer);
  expect(f.client.state("host", "session").pending).toBeNull(); expect(f.saved.size).toBe(0); f.client.dispose();
});
it("confirms a restarted outbox without leaving its original composer draft or erasing newer edits", async () => {
  for (const newer of [false, true]) {
    const draftRecords = new Map<string,string>(); let draftId = 0;
    const storage = { read: async (key: string) => draftRecords.get(key) ?? null, write: async (key: string, value: string) => { draftRecords.set(key, value); } };
    const drafts = new MobileDraftClient(storage, () => `draft-${++draftId}`); await drafts.open("host", "session");
    drafts.edit("host", "session", "original"); await drafts.retrySave("host", "session");
    const transfer = { editId: drafts.state("host", "session").editId, text: "original" };
    const f = fixture(); await f.open(); await f.client.enqueue("host", "session", "original", transfer); const operation = f.actions[1].operation; f.client.dispose();
    const reloadedDrafts = new MobileDraftClient(storage, () => `new-edit-${++draftId}`); await reloadedDrafts.open("host", "session");
    if (newer) reloadedDrafts.edit("host", "session", "a newer draft");
    let request = 0;
    const restored = new MobileQueueClient(f.storage, () => `restart-${++request}`, 1000, (host, session, draft) => reloadedDrafts.confirmTransfer(host, session, draft));
    restored.bind(f.transport, "host"); await restored.open("host", "session"); f.reply(); await flush();
    expect(f.actions.filter(action => action.operation.type === "enqueue")).toHaveLength(1);
    restored.retry("host", "session"); expect(f.actions[f.actions.length - 1].operation).toEqual(operation);
    f.reply(undefined, { receipt: f.receipt() });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(restored.state("host", "session").pending).toBeNull();
    expect(reloadedDrafts.state("host", "session").text).toBe(newer ? "a newer draft" : "");
    expect(JSON.parse([...draftRecords.values()][0]).text).toBe(newer ? "a newer draft" : "");
    restored.dispose();
  }
});

it("serializes duplicate confirmations across reconnect so they cannot remove a newer outbox", async () => {
  const gate = deferred<boolean>(), settle = vi.fn(() => gate.promise), f = fixture(settle);
  await f.open(); await f.client.enqueue("host", "session", "original", { editId: "old-edit", text: "original" });
  const original = f.actions[1]; f.reply(original, { receipt: f.receipt(original) }); await flush();
  expect(settle).toHaveBeenCalledOnce();
  f.client.bind(null, null); f.client.bind(f.transport, "host"); f.reply(); await flush();
  f.client.retry("host", "session"); const retry = f.actions[f.actions.length - 1];
  f.reply(retry, { receipt: f.receipt(retry) }); await flush();
  expect(settle).toHaveBeenCalledOnce(); expect(f.storage.remove).not.toHaveBeenCalled();
  gate.resolve(true); for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(f.storage.remove).toHaveBeenCalledOnce(); expect(f.client.state("host", "session").pending).toBeNull();
  await f.client.enqueue("host", "session", "newer command");
  const newer = f.client.state("host", "session").pending!;
  expect(newer.body).toBe("newer command");
  // Duplicate retired replies cannot touch the newer pending record/file.
  f.reply(original, { receipt: f.receipt(original) }); f.reply(retry, { receipt: f.receipt(retry) });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(f.storage.remove).toHaveBeenCalledOnce();
  expect(JSON.parse([...f.saved.values()][0]).commandId).toBe(newer.commandId);
  expect(f.client.state("host", "session").pending).toBe(newer);
  f.client.dispose();
});
it("does not run a second outbox removal concurrently when reconnect occurs during deletion", async () => {
  const deleting = deferred<void>(), f = fixture(async () => true); await f.open();
  f.storage.remove.mockImplementationOnce(async key => { await deleting.promise; f.saved.delete(key); });
  await f.client.enqueue("host", "session", "original", { editId: "old-edit", text: "original" });
  const original = f.actions[1]; f.reply(original, { receipt: f.receipt(original) });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(f.storage.remove).toHaveBeenCalledOnce();
  f.client.bind(null, null); f.client.bind(f.transport, "host"); f.reply(); await flush();
  f.client.retry("host", "session"); f.reply(undefined, { receipt: f.receipt() });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(f.storage.remove).toHaveBeenCalledOnce();
  deleting.resolve(); for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(f.client.state("host", "session").pending).toBeNull();
  const removals = f.storage.remove.mock.calls.length;
  expect(await f.client.enqueue("host", "session", "newer command")).toBe(true);
  f.reply(original, { receipt: f.receipt(original) }); await flush();
  expect(f.storage.remove).toHaveBeenCalledTimes(removals);
  expect(JSON.parse([...f.saved.values()][0]).body).toBe("newer command"); f.client.dispose();
});

it("keeps the durable write exclusive across disconnect and reconnect", async () => {
  const f = fixture(); await f.open();
  const saving = deferred<void>();
  f.storage.write.mockImplementationOnce(async (key, value) => { await saving.promise; f.saved.set(key, value); });
  const first = f.client.enqueue("host", "session", "first saved message");
  f.setStatus("disconnected"); f.setStatus("connected");
  f.reply(); await flush();
  expect(await f.client.enqueue("host", "session", "overwriting message")).toBe(false);
  expect(f.storage.write).toHaveBeenCalledOnce();
  expect(f.client.state("host", "session").busy).toBe(true);
  saving.resolve(); expect(await first).toBe(true);
  expect(f.client.state("host", "session").pending?.body).toBe("first saved message");
  expect(f.actions.filter(action => action.operation.type === "enqueue")).toHaveLength(0);
  expect(f.client.state("host", "session").needsRefresh).toBe(true);
  f.client.refresh("host", "session"); f.reply(); await flush();
  f.client.retry("host", "session"); f.reply(undefined, { receipt: f.receipt() }); await flush();
  expect(f.client.state("host", "session").pending).toBeNull();
  expect(f.saved.size).toBe(0); f.client.dispose();
});

it("keeps an unfinished write when the legacy screen detaches and reopens", async () => {
  const f = fixture(); await f.open();
  const saving = deferred<void>();
  f.storage.write.mockImplementationOnce(async (key, value) => { await saving.promise; f.saved.set(key, value); });
  const first = f.client.enqueue("host", "session", "retained while navigating");
  f.client.bind(null, null); f.client.bind(f.transport, "host");
  await f.client.open("host", "session");
  expect(f.client.state("host", "session").busy).toBe(true);
  expect(await f.client.enqueue("host", "session", "second message")).toBe(false);
  saving.resolve(); expect(await first).toBe(true);
  expect(f.client.state("host", "session").pending?.body).toBe("retained while navigating");
  expect(f.actions.map(action => action.operation.type)).toEqual(["get"]);
  f.client.refresh("host", "session"); f.reply(); await flush();
  f.client.retry("host", "session"); f.reply(undefined, { receipt: f.receipt() }); await flush();
  expect(f.client.state("host", "session").pending).toBeNull(); f.client.dispose();
});

it("releases a failed write after reconnect without losing the draft or blocking recovery", async () => {
  const f = fixture(); await f.open();
  const saving = deferred<void>();
  f.storage.write.mockImplementationOnce(async () => { await saving.promise; throw Error("disk full"); });
  const first = f.client.enqueue("host", "session", "unsaved draft");
  f.setStatus("disconnected"); f.setStatus("connected");
  expect(f.client.state("host", "session").busy).toBe(true);
  saving.resolve(); expect(await first).toBe(false);
  expect(f.client.state("host", "session")).toMatchObject({ busy: false, pending: null, needsRefresh: true });
  expect(f.client.state("host", "session").error).toContain("draft is unchanged");
  expect(f.saved.size).toBe(0);
  f.client.refresh("host", "session"); f.reply(); await flush();
  expect(await f.client.enqueue("host", "session", "unsaved draft")).toBe(true);
  f.reply(undefined, { receipt: f.receipt() }); await flush(); f.client.dispose();
});
