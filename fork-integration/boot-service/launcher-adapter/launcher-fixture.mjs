import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const here=new URL('./',import.meta.url),hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>"'"+x.replaceAll("'","'\\''")+"'";
async function privateWrite(file,bytes,mode=0o600){await fs.writeFile(file,bytes,{mode});await fs.chmod(file,mode);}
export async function fixture({helperMode='normal',trial=false,cleanupFailure=false,bootstrapSource,browserPolicy,browserCapability}={}){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'blackcrab-launcher-adapter-'));await fs.chmod(root,0o700);
 const owner=path.join(root,'owner'),base=path.join(owner,'host'),stage=path.join(root,'source');
 for(const p of [owner,base,stage,path.join(stage,'cloud'),path.join(base,'runtime'),path.join(base,'runtime','versions'),path.join(base,'runtime','versions','0.1.7'),path.join(base,'runtime','versions','0.1.7','payload'),path.join(base,'userdata')])await fs.mkdir(p,{mode:0o700});
 const output=path.join(root,'child-events.json'),transcript=path.join(root,'helper-events.jsonl');
 const manifest=Buffer.from('{"fixtureOnly":true}\n'),digest=hash(manifest);
 const binding={profile:'blackcrab-local-service-layout-v1',generation:7,manifestSha256:digest,environmentId:'existing legacy environment'};
 const helperPeer=path.join(root,'helper-peer.mjs');
 await privateWrite(helperPeer,`import*as fs from'node:fs';import*as readline from'node:readline';
 const binding=${JSON.stringify(binding)},mode=${JSON.stringify(helperMode)},transcript=${JSON.stringify(transcript)},output=${JSON.stringify(output)};
 const reply=x=>process.stdout.write(JSON.stringify(x)+'\\n');
 const ready=()=>reply({type:'ready',protocol:1,generation:7,nextEpoch:1,manifestSha256:binding.manifestSha256,environmentId:binding.environmentId,version:'0.1.7'});if(mode==='failPreflight')process.exit(1);else if(mode==='delayedReady')setTimeout(ready,1300);else ready();
 readline.createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);fs.appendFileSync(transcript,JSON.stringify({type:x.type,epoch:x.epoch})+'\\n');
 if(x.type==='begin'){const envelope={schema:1,kind:'blackcrab-owned-service-auth-v1',binding,desktopBootstrapToken:'a'.repeat(64),desktopBootstrapSecret:'b'.repeat(64)};if(mode==='networkInjection')envelope.host='0.0.0.0';if(${browserCapability!==undefined})envelope.desktopBrowserSocket=${JSON.stringify(browserCapability??null)};reply({type:'prepared',protocol:1,session:'c'.repeat(64),epoch:x.epoch,generation:7,envelope});}
 if(x.type==='issued'){reply({type:'issued',protocol:1,epoch:x.epoch});if(mode==='dieAfterIssue'){const timer=setInterval(()=>{if(fs.existsSync(output)){clearInterval(timer);process.exit(1);}},10);setTimeout(()=>process.exit(1),3000);}}
 if(x.type==='retire')reply({type:'retired',protocol:1,epoch:x.epoch});});`);
 const executableBytes=Buffer.from('#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(helperPeer)+' "$@"\n');
 const selfSha=hash(executableBytes),issuer=path.join(owner,'issuer'),issuerVersion=path.join(issuer,selfSha);
 await fs.mkdir(issuer,{mode:0o700});await fs.mkdir(issuerVersion,{mode:0o700});await privateWrite(path.join(issuerVersion,'blackcrab-issuer'),executableBytes,0o700);
 await privateWrite(path.join(owner,'.blackcrab-managed-host'),'blackcrab-managed-host-v1\n');
 await privateWrite(path.join(owner,'native-issuer-binding.json'),JSON.stringify({schema:1,selfSha256:selfSha,manifestSha256:digest,generation:7,environmentId:binding.environmentId,version:'0.1.7'}));
 const payload=path.join(base,'runtime','versions','0.1.7','payload');
 await privateWrite(path.join(payload,'blackcrab-managed-host.json'),manifest,0o644);
 await privateWrite(path.join(path.dirname(payload),'.install-complete'),'0.1.7\n');
 await privateWrite(path.join(path.dirname(payload),'.blackcrab-service-layout.json'),JSON.stringify({schema:1,profile:'blackcrab-local-service-layout-v1',protocol:4,version:'0.1.7',manifestSha256:digest}));
 const childPeer=path.join(root,'child-peer.mjs');
 await privateWrite(childPeer,`import*as fs from'node:fs';const output=${JSON.stringify(output)};const raw=fs.readFileSync(0,'utf8');const auth=JSON.parse(raw);const context=JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);const state={auth,context,ipc:process.connected};fs.writeFileSync(output,JSON.stringify(state));process.on('message',message=>{if(message.type==='committed'){state.committed=message.updateId;fs.writeFileSync(output,JSON.stringify(state));}});if(context.update?.status==='pending')process.send({type:'prepared',updateId:context.update.id});process.on('SIGTERM',()=>{state.stopped=true;fs.writeFileSync(output,JSON.stringify(state));process.exit(0);});setInterval(()=>{},1000);`);
 await privateWrite(path.join(payload,'t3'),'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(childPeer)+' "$@"\n',0o700);
 await privateWrite(path.join(base,'userdata','database.sqlite'),'synthetic fixture database');
 await fs.writeFile(path.join(stage,'OwnedLauncherBootstrap.ts'),bootstrapSource??await fs.readFile(new URL('OwnedLauncherBootstrap.ts',here)));
 if(browserPolicy!==undefined)await fs.writeFile(path.join(stage,'OwnedServiceBrowser.ts'),browserPolicy);
 let launcherSource=await fs.readFile(new URL('serviceLauncher.after.ts',here),'utf8');
 if(cleanupFailure){const marker='  if (child.exitCode !== null || child.signalCode !== null) return;';const start=launcherSource.indexOf('async function terminateChild(');const index=launcherSource.indexOf(marker,start);assert.ok(index>start);launcherSource=launcherSource.slice(0,index)+"  (globalThis as any).__fixtureCapturedChild = child; throw new Error('fixture captured cleanup failure');\n"+launcherSource.slice(index);}
 await fs.writeFile(path.join(stage,'serviceLauncher.ts'),launcherSource);
 await fs.copyFile(new URL('../owned-auth/fixtures/serviceProtocol.after.ts',here),path.join(stage,'cloud','serviceProtocol.ts'));
 const {Launcher}=await import(pathToFileURL(path.join(stage,'serviceLauncher.ts')));
 const {OwnedLauncherBootstrap}=await import(pathToFileURL(path.join(stage,'OwnedLauncherBootstrap.ts')));
 const state=trial?{protocol:4,activeVersion:'0.1.6',update:{id:'trial-fixture',status:'pending',fromVersion:'0.1.6',targetVersion:'0.1.7',dbPath:path.join(base,'userdata','database.sqlite')}}:{protocol:4,activeVersion:'0.1.7'};
 const launcher=new Launcher(base,state,{environment:{PATH:'/usr/bin:/bin',T3CODE_HOME:base}});
 return{root,owner,base,output,transcript,launcher,OwnedLauncherBootstrap,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
export async function until(fn){const deadline=Date.now()+8000;for(;;){try{const value=await fn();if(value)return value;}catch(error){if(error.code!=='ENOENT')throw error;}if(Date.now()>deadline)throw Error('fixture deadline');await new Promise(r=>setTimeout(r,20));}}
