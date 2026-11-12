import * as net from "node:net";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

export type Key = {threadId:string; tabId:string};
export type Attachment = Key & {peerEpoch:string; incarnation:string};
export type Payload = {type:string;threadId:string;tabId?:string;[key:string]:unknown};
const keyOf=(key:Key)=>JSON.stringify([key.threadId,key.tabId]);
const keyValid=(key:unknown):key is Key => typeof key==='object'&&key!==null&&typeof (key as Key).threadId==='string'&&(key as Key).threadId.length>0&&typeof (key as Key).tabId==='string'&&(key as Key).tabId.length>0;
export const sameAttachment=(a:Attachment|undefined|null,b:Attachment|undefined|null)=>Boolean(a&&b&&a.threadId===b.threadId&&a.tabId===b.tabId&&a.peerEpoch===b.peerEpoch&&a.incarnation===b.incarnation);
export class LeaseState {
  peer:null|{epoch:string;live:boolean;tail:Promise<unknown>;tabs:Map<string,Attachment>}=null;
  begin(epoch:string){if(this.peer)throw Error('A browser peer is already attached');this.peer={epoch,live:true,tail:Promise.resolve(),tabs:new Map()};}
  attached(key:Key,incarnation:string):Attachment {if(!this.peer)throw Error('No browser peer');const value={...key,peerEpoch:this.peer.epoch,incarnation};this.peer.tabs.set(keyOf(key),value);return value;}
  lookup(key:Key){return this.peer?.tabs.get(keyOf(key));}
  current(a:Attachment){return this.peer?.live===true&&sameAttachment(this.lookup(a),a);}
  detach(a:Attachment){if(!this.current(a))return false;this.peer!.tabs.delete(keyOf(a));return true;}
  retire(epoch:string){const peer=this.peer;if(!peer||peer.epoch!==epoch)return [];peer.live=false;this.peer=null;const tabs=[...peer.tabs.values()];peer.tabs.clear();return tabs;}
  send(expected:Attachment|string,work:()=>void|Promise<void>,current:()=>boolean=()=>true):Promise<boolean>{
    // Capture the peer/attachment BEFORE queueing; a successor gets a new queue.
    const peer=this.peer;const epoch=typeof expected==='string'?expected:expected.peerEpoch;
    if(!peer||peer.epoch!==epoch)return Promise.resolve(false);
    const operation=peer.tail.catch(()=>{}).then(async()=>{
      if(!current()||this.peer!==peer||!peer.live||(typeof expected!=='string'&&!this.current(expected)))return false;
      await work();return true;
    });peer.tail=operation.catch(()=>{});return operation;
  }
}
export type SocketConfig={path:string;key:string;environmentId:string;generation:number;maxFrameBytes?:number};
const proof=(key:string,role:string,nonce:string,env:string,generation:number,clientNonce='')=>createHmac('sha256',key).update(JSON.stringify(['blackcrab-native-browser-v2',role,nonce,clientNonce,env,generation])).digest('hex');
const exact=(value:any,keys:string[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const frameBudgets=new WeakMap<net.Socket,number>();
const frameLimit=(config:SocketConfig)=>config.maxFrameBytes??64*1024*1024;
function equal(a:unknown,b:string){return typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
function validConfig(config:SocketConfig,role:'listen'|'connect'){
 if(typeof config.key!=='string'||!/^[a-f0-9]{64}$/.test(config.key)||typeof config.environmentId!=='string'||!config.environmentId||config.environmentId.trim()!==config.environmentId||config.environmentId.length>256||!Number.isSafeInteger(config.generation)||config.generation<1||typeof config.path!=='string'||!path.isAbsolute(config.path)||config.path.includes('\0')||path.resolve(config.path)!==config.path||Buffer.byteLength(config.path)>100||!Number.isSafeInteger(frameLimit(config))||frameLimit(config)<1024||frameLimit(config)>64*1024*1024)throw Error('Invalid private browser transport configuration');
 if(process.platform==='win32')throw Error('Gate C Windows pipe ACL/lifecycle is not certified');
 let parent;let canonical;try{parent=fsSync.lstatSync(path.dirname(config.path));canonical=fsSync.realpathSync(path.dirname(config.path));}catch{throw Error('Browser socket directory unavailable');}
 if(!parent.isDirectory()||parent.isSymbolicLink()||canonical!==path.dirname(config.path)||parent.uid!==process.getuid!()||(parent.mode&0o777)!==0o700)throw Error('Browser socket directory is not private and owned');
 try{const socket=fsSync.lstatSync(config.path);if(role==='listen')throw Error('Refuse existing browser socket path');if(!socket.isSocket()||socket.uid!==process.getuid!()||(socket.mode&0o777)!==0o600)throw Error('Browser socket is not private and owned');}catch(error:any){if(error.code!=='ENOENT')throw Error('Browser socket path unavailable or unsafe');}
}
function lineReader(socket:net.Socket,isAuthenticated:()=>boolean,max:number,onFrame:(value:any)=>void){
 const decoder=new StringDecoder('utf8');let buffer='';
 socket.on('data',chunk=>{buffer+=decoder.write(chunk);
 for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;
 const budget=isAuthenticated()?max:16384;if(Buffer.byteLength(line)>budget){socket.destroy(Error('Browser frame exceeds limit'));return;}
 try{onFrame(JSON.parse(line));}catch{socket.destroy(Error('Invalid browser transport frame'));return;}}
 if(Buffer.byteLength(buffer)>(isAuthenticated()?max:16384))socket.destroy(Error('Browser frame exceeds limit'));

 });
}
function write(socket:net.Socket,value:unknown){return new Promise<void>((resolve,reject)=>{if(socket.destroyed)return reject(Error('Browser peer disconnected'));const line=JSON.stringify(value);if(Buffer.byteLength(line)>(frameBudgets.get(socket)??16384)){socket.destroy(Error('Browser outbound frame exceeds limit'));return reject(Error('Browser outbound frame exceeds limit'));}socket.write(line+'\n',error=>error?reject(error):resolve());});}
function frameMac(config:SocketConfig,nonce:string,clientNonce:string,frame:any){return createHmac('sha256',config.key).update(JSON.stringify(['blackcrab-native-browser-frame-v2',config.environmentId,config.generation,nonce,clientNonce,frame.type,frame.epoch,frame.seq,frame.incarnation,frame.payload])).digest('hex');}
function writeSigned(socket:net.Socket,config:SocketConfig,nonce:string,clientNonce:string,type:string,epoch:string,seq:number,incarnation:string|null,payload:Payload){try{if(!Number.isSafeInteger(seq)||seq<1)throw Error('Browser sequence exhausted');const frame={v:2,generation:config.generation,type,epoch,seq,incarnation,payload};return write(socket,{...frame,mac:frameMac(config,nonce,clientNonce,frame)});}catch(error){socket.destroy();return Promise.reject(error);}}
function authenticatedFrame(frame:any,type:string,config:SocketConfig,nonce:string,clientNonce:string,epoch:string,next:number){return exact(frame,['v','generation','type','epoch','seq','incarnation','payload','mac'])&&frame.v===2&&frame.type===type&&frame.generation===config.generation&&frame.epoch===epoch&&Number.isSafeInteger(frame.seq)&&frame.seq===next&&equal(frame.mac,frameMac(config,nonce,clientNonce,frame));}
export type ServerHooks={validateEvent:(value:unknown)=>boolean;event:(attachment:Attachment,event:Payload)=>void;retired:(attachments:Attachment[])=>void;ready?:(epoch:string)=>void};
export async function listenBrowser(config:SocketConfig,hooks:ServerHooks){
 validConfig(config,'listen');const state=new LeaseState();const connections=new Set<net.Socket>();const leases=new Map<string,net.Socket>();
 const server=net.createServer(socket=>{
  if(connections.size>=16){socket.destroy();return;}
  connections.add(socket);frameBudgets.set(socket,frameLimit(config));let authenticated=false;let epoch='',peerNonce='',incoming=0,outgoing=0;const nonce=randomBytes(24).toString('hex');let timer:NodeJS.Timeout|undefined=setTimeout(()=>socket.destroy(),2000);timer.unref();
  socket.on('error',()=>{});socket.on('close',()=>{connections.delete(socket);if(timer)clearTimeout(timer);if(epoch){leases.delete(epoch);if(state.peer?.epoch===epoch){const retired=state.retire(epoch);hooks.retired(retired);}}});
  void write(socket,{v:2,generation:config.generation,type:'challenge',environmentId:config.environmentId,nonce,proof:proof(config.key,'server',nonce,config.environmentId,config.generation)}).catch(()=>socket.destroy());
  lineReader(socket,()=>authenticated,frameLimit(config),frame=>{
   if(!authenticated){
    if(!exact(frame,['v','generation','type','environmentId','clientNonce','proof'])||frame.generation!==config.generation||frame.v!==2||frame.type!=='hello'||frame.environmentId!==config.environmentId||typeof frame.clientNonce!=='string'||!/^[a-f0-9]{48}$/.test(frame.clientNonce)||!equal(frame.proof,proof(config.key,'client',nonce,config.environmentId,config.generation,frame.clientNonce))||state.peer)throw Error('Browser peer authentication failed');
    peerNonce=frame.clientNonce;epoch=randomBytes(24).toString('hex');state.begin(epoch);leases.set(epoch,socket);authenticated=true;if(timer)clearTimeout(timer);timer=undefined;
    void write(socket,{v:2,generation:config.generation,type:'ready',environmentId:config.environmentId,clientNonce:peerNonce,epoch,proof:proof(config.key,'ready:'+epoch,nonce,config.environmentId,config.generation,peerNonce)}).then(()=>{if(!socket.destroyed&&state.peer?.epoch===epoch)hooks.ready?.(epoch);}).catch(()=>socket.destroy());return;
   }
   if(!authenticatedFrame(frame,'event',config,nonce,peerNonce,epoch,incoming+1)||!hooks.validateEvent(frame.payload)||!keyValid(frame.payload)||typeof frame.incarnation!=='string'||!/^[a-f0-9]{48}$/.test(frame.incarnation))throw Error('Invalid leased browser event');
   incoming=frame.seq;const event=frame.payload as Payload;let attachment=state.lookup(event as Key);
   if(event.type==='attached'){
    const candidate={threadId:event.threadId,tabId:event.tabId!,peerEpoch:epoch,incarnation:frame.incarnation};
    if(attachment&&!sameAttachment(attachment,candidate))hooks.event(attachment,{type:'detached',threadId:attachment.threadId,tabId:attachment.tabId});
    attachment=state.attached(event as Key,frame.incarnation);
   } else if(!attachment||attachment.incarnation!==frame.incarnation)return;
   if(event.type==='detached')state.detach(attachment);
   hooks.event(attachment,event);
  });
  // Each captured socket remains exclusive to this lease, including delayed writes.
  (socket as any).__browserSend=(expected:Attachment|string,payload:Payload,current?:()=>boolean)=>state.send(expected,()=>writeSigned(socket,config,nonce,peerNonce,'command',epoch,++outgoing,typeof expected==='string'?null:expected.incarnation,payload),current);
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',()=>reject(Error('Browser listener unavailable')));server.listen(config.path,()=>{server.off('error',reject);resolve();});});
 try{await fs.chmod(config.path,0o600);}catch(error){for(const socket of connections)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));throw Error('Browser listener permissions unavailable');}
 return {state,send(expected:Attachment|string,payload:Payload,current?:()=>boolean){const epoch=typeof expected==='string'?expected:expected.peerEpoch;const socket=leases.get(epoch);return socket?(socket as any).__browserSend(expected,payload,current) as Promise<boolean>:Promise.resolve(false);},async close(){for(const socket of connections)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
export type PeerHooks={validateCommand:(value:unknown)=>boolean;ready:(epoch:string)=>void;command:(payload:Payload,identity:Attachment|string)=>void;retired:(epoch:string)=>void};
export function connectBrowser(config:SocketConfig,hooks:PeerHooks){
 validConfig(config,'connect');const socket=net.createConnection(config.path);frameBudgets.set(socket,frameLimit(config));const state=new LeaseState();let authenticated=false,nonce='',epoch='',incoming=0,outgoing=0;const clientNonce=randomBytes(24).toString('hex');const timer=setTimeout(()=>socket.destroy(),2000);timer.unref();
 socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(timer);if(epoch){state.retire(epoch);hooks.retired(epoch);}});
 lineReader(socket,()=>authenticated,frameLimit(config),frame=>{
  if(!authenticated){
   if(exact(frame,['v','generation','type','environmentId','nonce','proof'])&&frame.generation===config.generation&&frame.type==='challenge'&&frame.v===2&&frame.environmentId===config.environmentId&&typeof frame.nonce==='string'&&/^[a-f0-9]{48}$/.test(frame.nonce)&&equal(frame.proof,proof(config.key,'server',frame.nonce,config.environmentId,config.generation))){nonce=frame.nonce;void write(socket,{v:2,generation:config.generation,type:'hello',environmentId:config.environmentId,clientNonce,proof:proof(config.key,'client',nonce,config.environmentId,config.generation,clientNonce)}).catch(()=>socket.destroy());return;}
   if(!exact(frame,['v','generation','type','environmentId','clientNonce','epoch','proof'])||frame.generation!==config.generation||frame.environmentId!==config.environmentId||frame.clientNonce!==clientNonce||frame.type!=='ready'||frame.v!==2||!nonce||typeof frame.epoch!=='string'||!/^[a-f0-9]{48}$/.test(frame.epoch)||!equal(frame.proof,proof(config.key,'ready:'+frame.epoch,nonce,config.environmentId,config.generation,clientNonce)))throw Error('Browser server authentication failed');
   epoch=frame.epoch;state.begin(epoch);authenticated=true;clearTimeout(timer);hooks.ready(epoch);return;
  }
  if(!authenticatedFrame(frame,'command',config,nonce,clientNonce,epoch,incoming+1)||!hooks.validateCommand(frame.payload))throw Error('Invalid leased browser command');
  incoming=frame.seq;const payload=frame.payload as Payload;
  if(payload.type==='turn'){if(frame.incarnation!==null)throw Error('Invalid turn incarnation');hooks.command(payload,epoch);return;}
  if(!keyValid(payload))throw Error('Missing browser command key');const attachment=state.lookup(payload);
  if(!attachment||attachment.incarnation!==frame.incarnation)return;hooks.command(payload,attachment);
 });
 return {state,socket,send(event:Payload){if(!state.peer||!keyValid(event))return Promise.resolve(false);let a=state.lookup(event);if(event.type==='attached')a=state.attached(event,randomBytes(24).toString('hex'));if(!a)return Promise.resolve(false);const captured=a;return state.send(captured,()=>writeSigned(socket,config,nonce,clientNonce,'event',epoch,++outgoing,captured.incarnation,event)).then(sent=>{if(event.type==='detached')state.detach(captured);return sent;});},close(){socket.destroy();}};
}

export function deleteIfSame<K,V>(map:Map<K,V>,key:K,owner:V){if(map.get(key)!==owner)return false;map.delete(key);return true;}
export function publishIfSame<K,V>(map:Map<K,V>,key:K,owner:V,live:()=>boolean,publish:()=>void){if(map.get(key)!==owner||!live())return false;publish();return true;}
export const resourceDirectoryName=(key:string,contextId:string)=>createHmac('sha256','desktop-context-directory').update(JSON.stringify([key,contextId])).digest('hex');
