import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {digest} from './artifact.mjs';
const captured=JSON.parse(await fs.readFile(new URL('./host-browser-requirements/public-surfaces.json',import.meta.url),'utf8'));
const key='secret-browser-key-sentinel', socket='/private/tmp/secret-browser-path-sentinel/b.sock';
const config=new Proxy({cwd:'/project',keybindingsConfigPath:'/private/keybindings',logsDir:'/private/logs',mode:'desktop',otelEnvironment:{resourceAttributes:{}}},{get(target,name){assert.notEqual(name,'desktopBrowserSocket');return target[name];},ownKeys(){throw Error('Internal config must never be spread into a public projection');}});
const run=(name,context)=>{const record=captured.records.find(r=>r.name===name);assert.equal(digest(Buffer.from(record.expression)),record.expressionSha256);const value=vm.runInNewContext(`(${record.expression})`,context,{timeout:1000});const json=JSON.stringify(value);assert.ok(!json.includes(key));assert.ok(!json.includes(socket));assert.ok(!json.includes('desktopBrowserSocket'));return value;};
test('actual pinned environment/config/telemetry projections exclude private browser capability',()=>{
 assert.equal(captured.upstreamCommit,'7f02de2eb8e253e0ec23f005b3cfff8e2c963be8');
 const environment=run('environmentDescriptor',{environmentId:'env',label:'Blackcrab',hostPlatform:'darwin',hostArchitecture:'arm64',hostLibc:undefined,machine:null,platformOs:x=>x,platformArch:x=>x,packageJson:{version:'0.1.7'},ORCHESTRATION_PROTOCOL_VERSION:2,PROVIDER_SEND_TURN_MAX_FILE_BYTES:100,databaseMigration:undefined,isSpeechPlatformSupported:()=>false,serverSelfUpdate:null,serverInstallation:null,desktopAppUpdate:false});
 const result=run('serverConfigSnapshot',{config,environment,auth:{authenticated:true},keybindingsConfig:{keybindings:[],issues:[]},providers:[],discovery:{},settings:{},serverSettings:{},scratchWorkspaceRoot:null,Option:{match:(_,handlers)=>handlers.onNone()},managedFolders:{namedProjectsRoot:'/projects'},lastEventLoopStall:undefined});assert.equal(result.cwd,'/project');
 run('telemetryResource',{config,packageJson:{version:'0.1.7'},processServiceInstanceId:()=> 'instance',releaseResourceAttributes:()=>({}),telemetryChannel:'local',hostName:'fixture',nodeProcessRuntimeAttributes:()=>({'process.command_args':['node','serve','--bootstrap-fd','3']})});
});
test('actual pinned diagnostic projections exclude extra internal state; capability is FD-only',()=>{
 const privateState={desktopBrowserSocket:{key,path:socket}};
 const entry={...privateState,identity:{pid:123,startTimeMs:0},ppid:1,status:'Idle',cpuPercent:0,residentBytes:1,runTimeMs:0,command:'node serve --bootstrap-fd 3',depth:1,childPids:[]};
 const Option={none:()=>({_tag:'None'}),map:()=>({_tag:'None'})};const process=run('processEntry',{entry,Option,formatElapsed:()=> '0s',Math});
 run('processSnapshot',{process:{pid:123},snapshot:{...privateState,readAt:0,health:{native:{lastError:null}}},processes:[process],Option});
});
test('staged host records preserve audited public projection source',async()=>{
 const records=JSON.parse(await fs.readFile(new URL('./host-browser-requirements/registry.json',import.meta.url),'utf8'));
 for(const surface of captured.records){
  const changes=records.filter(r=>r.target===surface.target);
  for(const change of changes){assert.notEqual(change.kind,'payload');assert.ok(change.replacements.every(r=>r.before.includes(surface.expression) && r.after.includes(surface.expression)));}
 }
});
