import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {fixture,until} from "../launcher-adapter/launcher-fixture.mjs";
const registry=JSON.parse(await fs.readFile(new URL("registry.json",import.meta.url)));
const record=registry.patches.find(r=>r.id==="owned-browser-launcher");
const bootstrapSource=record.replacements[0].after;
const browserPolicy=await fs.readFile(new URL("OwnedServiceBrowser.ts",import.meta.url));
const sha=v=>createHash("sha256").update(v).digest("hex");
assert.equal(sha(bootstrapSource),record.afterSha256);
assert.equal(sha(browserPolicy),registry.addedSources[0].sha256);
const socket={path:"/private/tmp/blackcrab-browser-"+"a".repeat(32)+"/b.sock",key:"e".repeat(64),generation:7};
test("registered launcher delivers native browser capability through private FD0 with IPC3",async()=>{
 const f=await fixture({bootstrapSource,browserPolicy,browserCapability:socket});let run;
 try{run=f.launcher.run();const state=await until(async()=>JSON.parse(await fs.readFile(f.output,"utf8")));assert.deepEqual(state.auth.desktopBrowserSocket,socket);assert.equal(state.ipc,true);await f.launcher.stop("SIGTERM");await run;const phases=(await fs.readFile(f.transcript,"utf8")).trim().split("\n").map(x=>JSON.parse(x).type);assert.deepEqual(phases,["begin","issued","retire"]);}
 finally{await f.launcher.stop("SIGTERM").catch(()=>{});await run?.catch(()=>{});await f.cleanup();}
});
test("registered launcher rejects malformed or configuration-bearing capabilities before child spawn",async()=>{
 for(const browserCapability of [{...socket,fd:5},{...socket,path:"/foreign/b.sock"},{...socket,generation:0},{...socket,key:"wrong"}]){const f=await fixture({bootstrapSource,browserPolicy,browserCapability});try{await assert.rejects(f.launcher.run(),/bootstrap/);await assert.rejects(fs.stat(f.output),{code:"ENOENT"});}finally{await f.cleanup();}}
});
