import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/queue-requests.json";
import { isRemoteEvent, parseEnvelope } from "./index";

describe("queue contract shared with the Rust host", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(parseEnvelope(JSON.stringify(fixture.envelope)) !== null).toBe(fixture.valid);
    });
  }
  it("validates snapshots and correlated results, including committed dispatch errors", () => {
    const queue = { threadId:"thread",revision:4,paused:true,items:[{commandId:"command",turnId:"turn",text:"message",createdAtMs:1,updatedAtMs:2}] };
    const snapshot = { type:"queue_snapshot",hostId:"host",sessionId:"session",queue };
    expect(isRemoteEvent(snapshot)).toBe(true);
    expect(isRemoteEvent({...snapshot,queue:null})).toBe(true);
    expect(isRemoteEvent({...snapshot,queue:{...queue,revision:-1}})).toBe(false);
    expect(isRemoteEvent({...snapshot,queue:{...queue,items:[queue.items[0],queue.items[0]]}})).toBe(false);
    const receipt={ commandId:"command",threadId:"thread",turnId:"turn",status:"uncertain",createdAtMs:1,updatedAtMs:2,detail:"pipe closed" };
    const result={type:"queue_result",hostId:"host",sessionId:"session",requestId:"request",ok:false,error:"dispatch failed",queue,receipt};
    expect(isRemoteEvent(result)).toBe(true);
    expect(isRemoteEvent({...result,ok:true,error:null,receipt:{...receipt,status:"succeeded"}})).toBe(true);
    expect(isRemoteEvent({...result,ok:true})).toBe(false);
    expect(isRemoteEvent({...result,requestId:""})).toBe(false);
    expect(isRemoteEvent({...result,error:null})).toBe(false);
    expect(isRemoteEvent({...result,receipt:{...receipt,status:"made_up"}})).toBe(false);
  });
});
