import { describe, expect, it, vi } from "vitest";
import { QueueController, type DispatchEvent, type QueueBackend, type QueueEvent, type QueueSnapshot, type TurnReceipt } from "./queueClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; });
  return {promise,resolve,reject};
}
function fixture() {
  const context = {threadId:"thread-a",runId:"run-a",processFinished:false};
  const data = {context,queue:{threadId:"thread-a",revision:0,paused:false,items:[]} as QueueSnapshot};
  const receipts = new Map<string,TurnReceipt>();
  const saved = new Map<string,string>();
  const storage = {getItem:vi.fn((key:string) => saved.get(key) ?? null),setItem:vi.fn((key:string,value:string) => { saved.set(key,value); }),removeItem:vi.fn((key:string) => { saved.delete(key); })};
  let changed: (event:QueueEvent) => void = () => {};
  let dispatched: (event:DispatchEvent) => void = () => {};
  let next = 0;
  const read = () => structuredClone(data.queue);
  const accept = (text:string,id:string): TurnReceipt => {
    data.queue.items.push({commandId:id,turnId:`turn-${id}`,text,createdAtMs:1,updatedAtMs:1});
    data.queue.revision++;
    const receipt = {commandId:id,threadId:context.threadId,turnId:`turn-${id}`,status:data.queue.paused ? "held" : "queued"};
    receipts.set(id,receipt);
    return receipt;
  };
  const backend = {
    context:vi.fn(async () => ({...data.context})),
    queue:vi.fn(async () => read()),
    savedQueue:vi.fn(async () => read()),
    enqueue:vi.fn(async (_panel:string,text:string,id:string) => accept(text,id)),
    change:vi.fn<QueueBackend["change"]>(async (_panel,expected,change) => {
      if (expected !== data.queue.revision) throw new Error("queue changed; reload");
      if (change.type === "reorder") data.queue.items = change.commandIds.map(id => data.queue.items.find(item => item.commandId === id)!);
      if (change.type === "resume") data.queue.paused = false;
      if (change.type === "pause") data.queue.paused = true;
      data.queue.revision++;
      return read();
    }),
    receipt:vi.fn(async (id:string) => { const value=receipts.get(id); if(!value) throw new Error("receipt unavailable"); return value; }),
    onChanged:vi.fn<QueueBackend["onChanged"]>(async (callback) => { changed=callback; return () => {}; }),
    onDispatched:vi.fn<QueueBackend["onDispatched"]>(async (callback) => { dispatched=callback; return () => {}; }),
  } satisfies QueueBackend;
  const controller = new QueueController(backend,storage,() => `command-${++next}`);
  const event = (id:string,runId=data.context.runId): DispatchEvent => ({panel_id:"panel",thread_id:context.threadId,run_id:runId,text:"message",receipt:{commandId:id,threadId:context.threadId,turnId:`turn-${id}`,status:"dispatching"}});
  return {controller,backend,storage,saved,data,receipts,accept,event,dispatch:(value:DispatchEvent)=>dispatched(value),changed:()=>changed({panel_id:"panel",thread_id:data.context.threadId,run_id:data.context.runId})};
}

describe("host queue client", () => {
  it("persists the retry identity before transferring a draft and dispatches a message only once before its acknowledgement", async () => {
    const f=fixture();
    await f.controller.attach("panel","native-a");
    const reply=deferred<TurnReceipt>();
    f.backend.enqueue.mockImplementationOnce(async (_panel,text,id) => { f.accept(text,id); return reply.promise; });
    const events:string[]=[];
    f.controller.onPrepared(event => { expect(f.saved.size).toBe(1); expect(event.submission.draftText).toBe("draft"); events.push("transferred"); });
    f.controller.onDispatch(() => events.push("dispatched"));
    f.controller.onAccepted(() => events.push("acknowledged"));
    const submitted=f.controller.submit("panel","message",{draftText:"draft",attachmentIds:["file-a"]});
    expect(events).toEqual(["transferred"]);
    await Promise.resolve();
    f.dispatch(f.event("command-1"));
    f.dispatch(f.event("command-1"));
    expect(events).toEqual(["transferred","dispatched"]);
    reply.resolve({...f.event("command-1").receipt,status:"running"});
    expect(await submitted).toBe(true);
    expect(events).toEqual(["transferred","dispatched","acknowledged"]);
    expect(f.saved.size).toBe(0);
    expect(f.controller.state("panel").pending).toBeNull();
    f.controller.dispose();
  });

  it("recovers a lost acknowledgement from its receipt without another submission", async () => {
    const f=fixture(); await f.controller.attach("panel");
    f.backend.enqueue.mockImplementationOnce(async (_panel,text,id) => { f.accept(text,id); throw new Error("reply lost"); });
    expect(await f.controller.submit("panel","message")).toBe(true);
    expect(f.backend.enqueue).toHaveBeenCalledTimes(1);
    expect(f.controller.state("panel").queue?.items).toHaveLength(1);
    expect(f.saved.size).toBe(0);
    f.controller.dispose();
  });

  it("retains an unconfirmed submission across reload and retries its original ID and text only on request", async () => {
    const f=fixture(); await f.controller.attach("panel");
    f.backend.enqueue.mockRejectedValueOnce(new Error("connection lost"));
    expect(await f.controller.submit("panel","original",{draftText:"original",attachmentIds:[]})).toBe(false);
    expect(f.saved.size).toBe(1);
    f.controller.dispose();
    const reloaded=new QueueController(f.backend,f.storage,() => "new-id-that-must-not-be-used");
    await reloaded.attach("panel","native-a");
    expect(f.backend.enqueue).toHaveBeenCalledTimes(1);
    expect(reloaded.state("panel").pending?.commandId).toBe("command-1");
    expect(await reloaded.submit("panel","different")).toBe(false);
    expect(await reloaded.retry("panel")).toBe(true);
    expect(f.backend.enqueue.mock.calls.map(call => call.slice(1))).toEqual([["original","command-1"],["original","command-1"]]);
    expect(f.data.queue.items.map(item => item.text)).toEqual(["original"]);
    expect(f.saved.size).toBe(0);
    reloaded.dispose();
  });

  it("leaves the draft untransferred when retry storage cannot be written", async () => {
    const f=fixture(); await f.controller.attach("panel");
    f.storage.setItem.mockImplementation(() => { throw new Error("quota"); });
    const transferred=vi.fn(); f.controller.onPrepared(transferred);
    expect(await f.controller.submit("panel","original")).toBe(false);
    expect(transferred).not.toHaveBeenCalled();
    expect(f.backend.enqueue).not.toHaveBeenCalled();
    expect(f.controller.state("panel").error).toContain("draft is unchanged");
    f.controller.dispose();
  });

  it("rejects old process events and ignores duplicate events in the current generation", async () => {
    const f=fixture(); await f.controller.attach("panel");
    const received:string[]=[]; f.controller.onDispatch(event => received.push(event.receipt.commandId));
    f.dispatch(f.event("first"));
    f.controller.invalidate("panel","native-a");
    f.dispatch(f.event("old-in-flight"));
    f.data.context={...f.data.context,runId:"run-b"};
    await f.controller.attach("panel");
    f.dispatch(f.event("old-after-restart","run-a"));
    f.dispatch(f.event("next")); f.dispatch(f.event("next"));
    expect(received).toEqual(["first","next"]);
    f.controller.dispose();
  });

  it("does not allow an older read to overwrite a newer queue revision", async () => {
    const f=fixture(); await f.controller.attach("panel");
    const older=deferred<QueueSnapshot>(),newer=deferred<QueueSnapshot>();
    f.backend.queue.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first=f.controller.refresh("panel"),second=f.controller.refresh("panel");
    newer.resolve({...f.data.queue,revision:4}); await second;
    older.resolve({...f.data.queue,revision:1}); await first;
    expect(f.controller.state("panel").queue?.revision).toBe(4);
    f.backend.queue.mockResolvedValueOnce({...f.data.queue,revision:2});
    await f.controller.refresh("panel");
    expect(f.controller.state("panel").queue?.revision).toBe(4);
    f.controller.dispose();
  });

  it("refreshes after a failed mutation without replacing the caller's revision with newer state", async () => {
    const f=fixture(); f.accept("first","a"); await f.controller.attach("panel");
    f.data.queue.revision=5; f.data.queue.items[0].text="edited elsewhere";
    expect(await f.controller.mutate("panel",{type:"edit",commandId:"a",text:"stale edit"},1)).toBe(false);
    expect(f.controller.state("panel").queue?.items[0].text).toBe("edited elsewhere");
    expect(f.controller.state("panel").queue?.revision).toBe(5);
    expect(f.controller.state("panel").error).toContain("changed");
    f.controller.dispose();
  });

  it("moves an approved retry ahead of held follow-ups before explicitly resuming them", async () => {
    const f=fixture(); f.data.queue.paused=true; f.accept("later","older-follow-up");
    await f.controller.attach("panel");
    await f.controller.retryDenied("panel","retry denied turn");
    expect(f.data.queue.items.map(item => item.commandId)).toEqual(["command-1","older-follow-up"]);
    expect(f.data.queue.paused).toBe(false);
    expect(f.backend.change.mock.calls.map(call => call[2].type)).toEqual(["reorder","resume"]);
    f.controller.dispose();
  });

  it("does not invalidate an in-flight attachment when a session refresh arrives", async () => {
    const f=fixture(); const queue=deferred<QueueSnapshot>();
    f.backend.queue.mockReturnValueOnce(queue.promise);
    const attaching=f.controller.attach("panel");
    await f.controller.connect();
    const refreshing=f.controller.refresh("panel","native-a",false);
    queue.resolve(structuredClone(f.data.queue));
    await Promise.all([attaching,refreshing]);
    expect(f.controller.state("panel").context?.runId).toBe("run-a");
    expect(f.controller.state("panel").loading).toBe(false);
    f.controller.dispose();
  });

  it("releases an abandoned submission lock when a replacement run attaches", async () => {
    const f=fixture(); await f.controller.attach("panel");
    const oldReply=deferred<TurnReceipt>();
    f.backend.enqueue.mockImplementationOnce(async (_panel,text,id) => { f.accept(text,id); return oldReply.promise; });
    const old=f.controller.submit("panel","first");
    await Promise.resolve();
    expect(f.controller.state("panel").saving).toBe(true);
    f.controller.invalidate("panel");
    f.data.context={...f.data.context,runId:"run-b"};
    await f.controller.attach("panel");
    expect(f.controller.state("panel").saving).toBe(false);
    expect(f.controller.state("panel").pending?.commandId).toBe("command-1");
    oldReply.resolve(f.event("command-1").receipt);
    await old;
    expect(f.controller.state("panel").context?.runId).toBe("run-b");
    f.controller.dispose();
  });

  it("deduplicates concurrent context attachment and removes subscriptions that resolve after disposal", async () => {
    const f=fixture();
    const one=deferred<()=>void>(),two=deferred<()=>void>();
    const firstOff=vi.fn(),secondOff=vi.fn();
    f.backend.onChanged.mockReturnValueOnce(one.promise);
    f.backend.onDispatched.mockReturnValueOnce(two.promise);
    const first=f.controller.attach("panel"), second=f.controller.attach("panel");
    const settled=Promise.allSettled([first,second]);
    one.resolve(firstOff); await Promise.resolve();
    f.controller.dispose();
    expect(firstOff).toHaveBeenCalledTimes(1);
    two.resolve(secondOff);
    expect((await settled).every(result => result.status === "rejected")).toBe(true);
    expect(firstOff).toHaveBeenCalledTimes(1);
    expect(secondOff).toHaveBeenCalledTimes(1);
    expect(f.backend.context).not.toHaveBeenCalled();
  });
});
