import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import * as fs from "node:fs/promises";
import * as net from "node:net";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { LeaseState, listenBrowser, connectBrowser, sameAttachment, type Attachment } from "./patches/gate-c-5.ts";
const closed=(socket:net.Socket)=>new Promise<void>(resolve=>socket.once('close',()=>resolve()));
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const deferred=()=>{let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};};
const bounded=async<T>(promise:Promise<T>)=>{let timer:NodeJS.Timeout;try{return await Promise.race([promise,new Promise<never>((_,reject)=>timer=setTimeout(()=>reject(Error('test deadline')),5000))]);}finally{clearTimeout(timer!);}};
const validEvent=(v:any)=>['attached','detached','shown','cdp'].includes(v?.type)&&typeof v.threadId==='string'&&typeof v.tabId==='string';
const validCommand=(v:any)=>['cdp','release','pointer','turn'].includes(v?.type);
async function setup(t:any,overrides:any={}){const dir=await fs.realpath(await fs.mkdtemp('/tmp/bcgc-'));await fs.chmod(dir,0o700);const config={path:dir+'/c.sock',key:randomBytes(32).toString('hex'),environmentId:'fixture-environment',generation:1,...overrides};const events:any[]=[],retired:any[]=[];const server=await listenBrowser(config,{validateEvent:validEvent,event:(identity,payload)=>events.push({identity,payload}),retired:ids=>retired.push(ids)});t.after(async()=>{await server.close();await fs.rm(dir,{recursive:true,force:true});});return {config,server,events,retired};}
async function peer(config:any){const ready=deferred(),commands:any[]=[],retired:string[]=[];const client=connectBrowser(config,{validateCommand:validCommand,ready:epoch=>ready.resolve(epoch),command:(payload,identity)=>commands.push({payload,identity}),retired:epoch=>retired.push(epoch)});await bounded(ready.promise);return {client,commands,retired};}
test('same-key old release queued behind a stalled writer cannot reach successor; new lease does not wait',async()=>{
 const state=new LeaseState();state.begin('old');const old=state.attached({threadId:'t',tabId:'x'},'one'),gate=deferred(),started=deferred(),writes:string[]=[];
 const first=state.send(old,async()=>{started.resolve();await gate.promise;writes.push('already-accepted-old');});await started.promise;
 const release=state.send(old,()=>{writes.push('old-release');});state.retire('old');state.begin('new');const fresh=state.attached(old,'two');await bounded(state.send(fresh,()=>{writes.push('new-live');}));assert.deepEqual(writes,['new-live']);gate.resolve();await first;assert.equal(await release,false);assert.equal(state.current(fresh),true);assert.deepEqual(writes,['new-live','already-accepted-old']);
});
test('same-peer debugger incarnation fences old detach and queued writes',async()=>{const state=new LeaseState();state.begin('peer');const old=state.attached({threadId:'t',tabId:'x'},'one');const fresh=state.attached(old,'two');assert.equal(state.detach(old),false);assert.equal(await state.send(old,()=>assert.fail('stale write')),false);assert.equal(state.current(fresh),true);});
test('real authenticated socket roundtrip and reconnect do not replay CDP or release',async t=>{
 const {config,server,events,retired}=await setup(t);const a=await peer(config);await a.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();const old=events.at(-1).identity;await server.send(old,{type:'cdp',threadId:'t',tabId:'x',message:'{"id":1}'});await tick();assert.equal(a.commands.length,1);a.client.close();await tick();assert.equal(retired.length,1);assert.equal(server.state.current(old),false);
 assert.equal(await server.send(old,{type:'release',threadId:'t',tabId:'x'}),false);const b=await peer(config);t.after(()=>b.client.close());await b.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();const fresh=events.at(-1).identity;assert.equal(sameAttachment(old,fresh),false);assert.equal(await server.send(old,{type:'release',threadId:'t',tabId:'x'}),false);await server.send(fresh,{type:'pointer',threadId:'t',tabId:'x',x:1,y:2,phase:'click'});await tick();assert.deepEqual(b.commands.map(v=>v.payload.type),['pointer']);assert.equal(server.state.current(fresh),true);
});
test('unauthenticated earlier connection never receives authenticated commands',async t=>{
 const {config,server,events}=await setup(t);const attacker=net.createConnection(config.path);const bytes:Buffer[]=[];attacker.on('data',b=>bytes.push(b));attacker.on('error',()=>{});t.after(()=>attacker.destroy());await once(attacker,'connect');const real=await peer(config);t.after(()=>real.client.close());await real.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();await server.send(events.at(-1).identity,{type:'release',threadId:'t',tabId:'x'});await tick();assert.equal(Buffer.concat(bytes).toString().includes('"type":"command"'),false);assert.equal(real.commands.length,1);
});
test('wrong key, wrong environment/generation, duplicate peer and malformed frames fail closed',async t=>{
 const {config,server}=await setup(t);
 for(const change of [{key:randomBytes(32).toString('hex')},{environmentId:'other'},{generation:2}]){let ready=false;const bad=connectBrowser({...config,...change},{validateCommand:validCommand,ready:()=>ready=true,command:()=>assert.fail('bad command'),retired:()=>{}});await bounded(closed(bad.socket));assert.equal(ready,false);assert.equal(server.state.peer,null);}
 const first=await peer(config);t.after(()=>first.client.close());let ready=false;const duplicate=connectBrowser(config,{validateCommand:validCommand,ready:()=>ready=true,command:()=>{},retired:()=>{}});await bounded(closed(duplicate.socket));assert.equal(ready,false);assert.ok(server.state.peer);first.client.socket.write('not-json\n');await bounded(closed(first.client.socket));await tick();assert.equal(server.state.peer,null);
});
test('oversized unauthenticated input is rejected before privilege',async t=>{const {config,server}=await setup(t);const socket=net.createConnection(config.path);socket.on('error',()=>{});socket.resume();await once(socket,'connect');socket.write('x'.repeat(17000));await bounded(closed(socket));assert.equal(server.state.peer,null);});
test('CDP payload survives a fragmented large socket transfer without truncation',async t=>{const {config,server,events}=await setup(t);const a=await peer(config);t.after(()=>a.client.close());await a.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();const message='a'.repeat(2*1024*1024)+'😀';await server.send(events.at(-1).identity,{type:'cdp',threadId:'t',tabId:'x',message});await bounded(new Promise<void>(resolve=>{const timer=setInterval(()=>{if(a.commands.length){clearInterval(timer);resolve();}},10);}));assert.equal(a.commands[0].payload.message,message);});

test('a stale asynchronous setup/finalizer cannot publish or delete the successor pending owner',async()=>{
 const {publishIfSame,deleteIfSame}=await import('./patches/gate-c-5.ts');
 const pending=new Map();const old={},fresh={};let published='';pending.set('same-key',old);
 const delayed=deferred();const completion=delayed.promise.then(()=>{const result=publishIfSame(pending,'same-key',old,()=>true,()=>published='old');deleteIfSame(pending,'same-key',old);return result;});
 pending.set('same-key',fresh);delayed.resolve();assert.equal(await completion,false);assert.equal(pending.get('same-key'),fresh);
 assert.equal(publishIfSame(pending,'same-key',fresh,()=>true,()=>published='fresh'),true);assert.equal(published,'fresh');
});
test('delayed old download-directory removal cannot remove a same-key successor directory',async()=>{
 const {resourceDirectoryName}=await import('./patches/gate-c-5.ts');
 const root=await fs.mkdtemp('/tmp/bc-c-download-');
 try{const old=path.join(root,resourceDirectoryName('key','old-context'));const fresh=path.join(root,resourceDirectoryName('key','new-context'));await fs.mkdir(old);await fs.mkdir(fresh);await fs.writeFile(path.join(fresh,'fixture'),'owned');await fs.rm(old,{recursive:true,force:true});assert.equal(await fs.readFile(path.join(fresh,'fixture'),'utf8'),'owned');}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a queued release captures its endpoint owner even when peer and tab incarnation are unchanged',async()=>{
 const state=new LeaseState();state.begin('same-peer');const a=state.attached({threadId:'t',tabId:'p'},'same-tab');let owner={};const old=owner;const block=deferred();let writes=0;const stalled=state.send(a,()=>block.promise);const release=state.send(a,()=>{writes++},()=>owner===old);owner={};block.resolve();await stalled;assert.equal(await release,false);assert.equal(writes,0);assert.equal(state.current(a),true);
});

test('recorded server handshake cannot authenticate a fresh client nonce',async t=>{
 const {config,server}=await setup(t);const ready=deferred(),recorded:Buffer[]=[];
 const first=connectBrowser(config,{validateCommand:validCommand,ready:()=>ready.resolve(),command:()=>{},retired:()=>{}});first.socket.on('data',b=>recorded.push(b));await bounded(ready.promise);first.close();await tick();await server.close();
 const frames=Buffer.concat(recorded).toString().trim().split('\n').map(x=>JSON.parse(x));const challenge=frames.find(x=>x.type==='challenge'),oldReady=frames.find(x=>x.type==='ready');assert.ok(challenge&&oldReady);
 const hello=deferred();const impostor=net.createServer(socket=>{socket.on('error',()=>{});socket.write(JSON.stringify(challenge)+'\n');let b='';socket.on('data',chunk=>{b+=chunk;const end=b.indexOf('\n');if(end>=0){const parsed=JSON.parse(b.slice(0,end));hello.resolve(parsed);socket.write(JSON.stringify({...oldReady,clientNonce:parsed.clientNonce})+'\n');}});});await new Promise<void>(resolve=>impostor.listen(config.path,resolve));await fs.chmod(config.path,0o600);t.after(()=>new Promise<void>(resolve=>impostor.close(()=>resolve())));
 let authenticated=false;const client=connectBrowser(config,{validateCommand:validCommand,ready:()=>authenticated=true,command:()=>assert.fail('replayed server commanded client'),retired:()=>{}});const received:any=await bounded(hello.promise);assert.notEqual(received.clientNonce,oldReady.clientNonce);await bounded(closed(client.socket));assert.equal(authenticated,false);
});

test('authenticated socket proxy cannot inject a tampered server command',async t=>{
 const {config,server,events}=await setup(t);const sockets=new Set<net.Socket>();let tampered=false;
 const proxy=net.createServer(down=>{const up=net.createConnection(config.path);for(const s of [up,down]){sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));}down.on('close',()=>up.destroy());up.on('close',()=>down.destroy());down.pipe(up);let buffer='';up.on('data',chunk=>{buffer+=chunk;for(;;){const end=buffer.indexOf('\n');if(end<0)break;let line=buffer.slice(0,end);buffer=buffer.slice(end+1);const frame=JSON.parse(line);if(frame.type==='command'){frame.payload={...frame.payload,type:'pointer',phase:'move',x:999,y:999};assert.equal(validCommand(frame.payload),true);line=JSON.stringify(frame);tampered=true;}down.write(line+'\n');}});});const proxyPath=path.dirname(config.path)+'/proxy.sock';await new Promise<void>(resolve=>proxy.listen(proxyPath,resolve));await fs.chmod(proxyPath,0o600);t.after(async()=>{sockets.forEach(s=>s.destroy());await new Promise<void>(resolve=>proxy.close(()=>resolve()));});
 const p=await peer({...config,path:proxyPath});await p.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();const done=closed(p.client.socket);await server.send(events.at(-1).identity,{type:'release',threadId:'t',tabId:'x'});await bounded(done);assert.equal(tampered,true);assert.equal(p.commands.length,0);
});

test('replayed authenticated native event is rejected without a duplicate attachment',async t=>{
 const {config,server,events}=await setup(t);const p=await peer(config);let line='';const original=p.client.socket.write.bind(p.client.socket);(p.client.socket as any).write=(data:any,...rest:any[])=>{line=String(data);return (original as any)(data,...rest);};await p.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();assert.equal(events.length,1);const done=closed(p.client.socket);original(line);await bounded(done);await tick();assert.equal(events.length,1);assert.equal(server.state.peer,null);
});

test('changing a captured event to the correct next sequence cannot forge its MAC',async t=>{
 const {config,server,events}=await setup(t);const p=await peer(config);let line='';const original=p.client.socket.write.bind(p.client.socket);(p.client.socket as any).write=(data:any,...rest:any[])=>{line=String(data);return (original as any)(data,...rest);};await p.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();const frame=JSON.parse(line);frame.seq++;const done=closed(p.client.socket);original(JSON.stringify(frame)+'\n');await bounded(done);await tick();assert.equal(events.length,1);assert.equal(server.state.peer,null);
});

test('authenticated outbound frames are bounded without truncating or delivering partial commands',async t=>{
 const {config,server,events}=await setup(t,{maxFrameBytes:2048});const p=await peer(config);await p.client.send({type:'attached',threadId:'t',tabId:'x'});await tick();const done=closed(p.client.socket);await assert.rejects(server.send(events.at(-1).identity,{type:'cdp',threadId:'t',tabId:'x',message:'x'.repeat(4096)}),/outbound frame exceeds/);await bounded(done);assert.equal(p.commands.length,0);
});
