import type { FollowUpQueue, QueueChange, QueueOperation, QueueRequestAction, QueueResultEvent, RemoteEvent } from "@blackcrab/remote-protocol";
import type { Transport } from "../transport/types";

export interface PendingMessage {
  version: 1;
  hostId: string;
  sessionId: string;
  threadId: string;
  commandId: string;
  body: string;
}
export interface QueueStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface MobileQueueState {
  loaded: boolean;
  connected: boolean;
  support: "unknown" | "available" | "unavailable";
  queue: FollowUpQueue | null;
  busy: boolean;
  needsRefresh: boolean;
  pending: PendingMessage | null;
  error: string | null;
  notice: string | null;
}
type RecordState = { hostId: string; sessionId: string; state: MobileQueueState; listeners: Set<() => void>; loading?: Promise<void> };
type Request = { key: string; operation: QueueOperation; generation: number; done?: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
const keyFor = (hostId: string, sessionId: string) => JSON.stringify([hostId, sessionId]);

/** One app-owned controller: switching screens cannot create a second writer. */
export class MobileQueueClient {
  private records = new Map<string, RecordState>();
  private requests = new Map<string, Request>();
  private transport: Transport | null = null;
  private hostId: string | null = null;
  private generation = 0;
  private connectionEpoch = 0;
  private connected = false;
  private unlisten: Array<() => void> = [];
  constructor(private storage: QueueStorage, private id: () => string, private timeoutMs = 10000) {}

  private record(hostId: string, sessionId: string): RecordState {
    const key = keyFor(hostId, sessionId);
    let record = this.records.get(key);
    if (!record) {
      record = { hostId, sessionId, listeners: new Set(), state: { loaded:false, connected:false, support:"unknown", queue:null, busy:false, needsRefresh:false, pending:null, error:null, notice:null } };
      this.records.set(key,record);
    }
    return record;
  }
  state(hostId: string, sessionId: string) { return this.record(hostId,sessionId).state; }
  subscribe(hostId: string, sessionId: string, callback: () => void) {
    const record=this.record(hostId,sessionId);
    record.listeners.add(callback);
    return () => { record.listeners.delete(callback); };
  }
  private update(record: RecordState, patch: Partial<MobileQueueState>) {
    record.state={...record.state,...patch};
    record.listeners.forEach(callback=>callback());
  }
  bind(transport: Transport | null, hostId: string | null) {
    this.unlisten.splice(0).forEach(off=>off());
    this.generation++;
    this.connectionEpoch++;
    this.connected=false;
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.done?.(false);
      const record=this.records.get(request.key)!;
      this.update(record,{busy:false,needsRefresh:true,error:"Connection changed. Refresh the queue; retry unconfirmed messages explicitly."});
    }
    this.requests.clear();
    this.transport=transport;
    this.hostId=hostId;
    for (const record of this.records.values()) this.update(record,{connected:false,support:"unknown"});
    if (!transport || !hostId) return;
    const generation=this.generation;
    const status = () => {
      if (generation!==this.generation) return;
      const value=transport.status();
      const connected=value.state==="connected" && (!value.hostId || value.hostId===hostId);
      if (connected!==this.connected) { this.connectionEpoch++; this.connected=connected; }
      for (const record of this.records.values()) {
        if (record.hostId!==hostId) continue;
        const was=record.state.connected;
        this.update(record,{connected});
        if (connected && !was && record.state.loaded) this.refresh(record.hostId,record.sessionId);
      }
      if (!connected) {
        for (const [id,request] of this.requests) {
          clearTimeout(request.timer);
          this.requests.delete(id);
          request.done?.(false);
          this.update(this.records.get(request.key)!,{busy:false,needsRefresh:true,error:"Disconnected. Unconfirmed messages stay saved; reconnect and retry explicitly."});
        }
      }
    };
    this.unlisten.push(transport.subscribeEvents(event=> { if(generation===this.generation) void this.receive(event); }));
    this.unlisten.push(transport.subscribe(status));
    status();
  }
  dispose() { this.bind(null,null); }

  async open(hostId: string, sessionId: string): Promise<void> {
    const record=this.record(hostId,sessionId);
    if (record.loading) return record.loading;
    if (!record.state.loaded) {
      record.loading=(async()=> {
        try {
          const raw=await this.storage.read(keyFor(hostId,sessionId));
          const pending: PendingMessage | null=raw ? JSON.parse(raw) : null;
          if (pending && (pending.version!==1 || pending.hostId!==hostId || pending.sessionId!==sessionId || typeof pending.threadId!=="string" || !pending.threadId || typeof pending.commandId!=="string" || !pending.commandId || typeof pending.body!=="string" || !pending.body.trim())) throw new Error("Invalid saved message");
          this.update(record,{loaded:true,pending});
        } catch { this.update(record,{error:"Could not read saved queue recovery data. Sending is blocked to protect it."}); }
        finally { record.loading=undefined; }
      })();
      await record.loading;
    }
    const status=this.transport?.status();
    this.update(record,{connected:this.hostId===hostId && status?.state==="connected" && (!status.hostId || status.hostId===hostId)});
    if (record.state.connected) this.refresh(hostId,sessionId);
  }
  private send(record: RecordState, operation: QueueOperation, done?: (ok:boolean)=>void): boolean {
    if (!record.state.connected || this.hostId!==record.hostId || !this.transport) {
      this.update(record,{busy:false,needsRefresh:true,error:"Reconnect and refresh before retrying this action."});
      done?.(false);
      return false;
    }
    const requestId=this.id();
    const key=keyFor(record.hostId,record.sessionId);
    const generation=this.generation;
    const timer=setTimeout(()=> {
      if (!this.requests.delete(requestId)) return;
      done?.(false);
      this.update(record,{busy:false,needsRefresh:true,support:operation.type==="get" && record.state.support!=="available" ? "unavailable" : record.state.support,error:operation.type==="get" ? "Queue did not respond. Refresh after reconnecting or update the desktop host." : "Host did not confirm this action. Refresh; retry saved messages with their original ID."});
    },this.timeoutMs);
    this.requests.set(requestId,{key,operation,generation,timer,done});
    const action: QueueRequestAction={type:"queue_request",hostId:record.hostId,sessionId:record.sessionId,requestId,operation};
    let sent=false;
    try { sent=this.transport.sendAction(action); } catch { /* Preserve ambiguous writes. */ }
    if (!sent && this.requests.delete(requestId)) {
      clearTimeout(timer);
      done?.(false);
      this.update(record,{busy:false,needsRefresh:true,error:"Message was not handed to the connection. Reconnect and retry explicitly."});
    }
    return sent;
  }
  refresh(hostId: string, sessionId: string) {
    const record=this.record(hostId,sessionId);
    if (!record.state.loaded || record.state.busy) return;
    if ([...this.requests.values()].some(request=>request.key===keyFor(hostId,sessionId))) return;
    this.update(record,{busy:true,error:null});
    this.send(record,{type:"get"});
  }
  async enqueue(hostId: string, sessionId: string, body: string): Promise<boolean> {
    const record=this.record(hostId,sessionId);
    const state=record.state;
    if (!body.trim() || !state.loaded || state.busy || state.pending || !state.connected || state.support!=="available" || state.needsRefresh || !state.queue) return false;
    const generation=this.generation, connectionEpoch=this.connectionEpoch;
    const pending: PendingMessage={version:1,hostId,sessionId,threadId:state.queue.threadId,commandId:this.id(),body};
    this.update(record,{busy:true,error:null});
    try { await this.storage.write(keyFor(hostId,sessionId),JSON.stringify(pending)); }
    catch { this.update(record,{busy:false,error:"Could not save retry data. Your draft is unchanged."}); return false; }
    this.update(record,{pending});
    if (generation!==this.generation || connectionEpoch!==this.connectionEpoch || record.state.queue?.threadId!==pending.threadId) {
      this.update(record,{busy:false,needsRefresh:true,error:"Connection or session changed while saving. Refresh, then retry the saved message explicitly."});
      return true;
    }
    // Persisting succeeded: the composer can transfer its draft even if offline.
    if (!this.send(record,{type:"enqueue",commandId:pending.commandId,body})) this.update(record,{busy:false});
    return true;
  }
  retry(hostId: string, sessionId: string) {
    const record=this.record(hostId,sessionId);
    const {pending}=record.state;
    if (!pending || record.state.busy || !record.state.connected || record.state.support!=="available" || record.state.needsRefresh) return;
    if (record.state.queue?.threadId!==pending.threadId) { this.update(record,{error:"The session queue changed. Review the original message on the desktop before continuing."}); return; }
    this.update(record,{busy:true,error:null});
    this.send(record,{type:"enqueue",commandId:pending.commandId,body:pending.body});
  }
  mutate(hostId: string, sessionId: string, revision: number, change: QueueChange): Promise<boolean> {
    const record=this.record(hostId,sessionId);
    if (!record.state.connected || record.state.busy || record.state.pending || record.state.support!=="available" || record.state.needsRefresh) return Promise.resolve(false);
    this.update(record,{busy:true,error:null});
    return new Promise(resolve=> { this.send(record,{type:"update",expectedRevision:revision,change},resolve); });
  }
  private snapshot(record: RecordState, queue: FollowUpQueue | null) {
    const previous=record.state.queue;
    if (previous && queue && previous.threadId===queue.threadId && previous.revision>queue.revision) return;
    this.update(record,{queue});
  }
  private async receive(event: RemoteEvent) {
    if (event.type!=="queue_snapshot" && event.type!=="queue_result") return;
    if (event.hostId!==this.hostId) return;
    const record=this.records.get(keyFor(event.hostId,event.sessionId));
    if (!record) return;
    if (event.type==="queue_snapshot") { this.snapshot(record,event.queue); return; }
    const request=this.requests.get(event.requestId);
    if (!request || request.generation!==this.generation || request.key!==keyFor(event.hostId,event.sessionId)) return;
    this.requests.delete(event.requestId);
    clearTimeout(request.timer);
    this.snapshot(record,event.queue);
    this.update(record,{support:"available",needsRefresh:false,error:event.error});
    if (request.operation.type==="enqueue") {
      await this.confirm(record,event,request.operation.commandId);
    } else { this.update(record,{busy:false}); request.done?.(event.ok); }
  }
  private async confirm(record: RecordState, event: QueueResultEvent, commandId: string) {
    const pending=record.state.pending;
    const receipt=event.receipt;
    if (!pending || pending.commandId!==commandId || !receipt || receipt.commandId!==commandId || receipt.threadId!==pending.threadId) {
      this.update(record,{busy:false,error:event.error || "Message remains unconfirmed. Retry its saved ID after reviewing the queue."});
      return;
    }
    try { await this.storage.remove(keyFor(record.hostId,record.sessionId)); }
    catch { this.update(record,{busy:false,error:"Host confirmed the message, but local confirmation could not be saved. Retry safely."}); return; }
    const review=["uncertain","failed","interrupted"].includes(receipt.status);
    this.update(record,{busy:false,pending:null,notice:review ? `Message ${receipt.status}. Review the conversation before resuming the queue.` : receipt.status==="cancelled" ? "Message was cancelled on the host." : null});
  }
}
