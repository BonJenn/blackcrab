import test from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import syncfs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {applyBootServicePatch,descriptors} from './index.mjs';
import {prepareLocalRuntimeInstallPlan,localRuntimeInstallPlan} from './local-runtime.mjs';
import {writeArtifactManifest,MANIFEST_FILE} from '../../managed-host/artifact.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),appRequire=createRequire(new URL('../../apps/mobile/package.json',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>syncfs.readFileSync(new URL(file,import.meta.url));
const source=id=>applyBootServicePatch(read('fixtures/'+id+'.before.ts'),id).toString();
function execute(text,globals={}){const module={exports:{}};const output=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(output,{module,exports:module.exports,Error,TypeError,RangeError,...globals});return module.exports;}
function realManager(){const text=source('001-owned-service-and-local-installer'),ast=ts.createSourceFile('boot.ts',text,ts.ScriptTarget.Latest,true);const functions=new Set(['escapeSystemdSpecifiers','quoteSystemdValue','unquoteSystemdValue','escapeXmlText','unescapeXmlText','renderBootServiceUnit','renderBootServicePlist','systemdManager','launchdManager','selectBootServiceManager','bootServiceBaseDirOf','bootServiceProgramOf']);const statements=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&functions.has(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(x=>x.name.getText(ast).startsWith('BOOT_SERVICE_')||x.name.getText(ast)==='STOP_STEP_TIMEOUT'||functions.has(x.name.getText(ast))));return execute(statements.map(x=>x.getText(ast)).join('\n')+'\nexports.selectBootServiceManager=selectBootServiceManager;',{Duration:appRequire('effect/Duration')});}
test('exact before/after source, diff and license provenance; mutation refuses',()=>{
 const registry=JSON.parse(read('registry.json'));assert.equal(sha(read('LICENSE.upstream')),registry.licenseSha256);
 for(const record of descriptors()){const before=read('fixtures/'+record.id+'.before.ts'),after=applyBootServicePatch(before,record.id);assert.equal(sha(after),record.afterSha256);assert.deepEqual(after,read('fixtures/'+record.id+'.after.ts'));assert.equal(sha(read(record.file)),record.sha256);assert.throws(()=>applyBootServicePatch(Buffer.concat([before,Buffer.from('changed')]),record.id));}
 for(const item of registry.fixtures)assert.equal(sha(read(item.file)),item.sha256);
 assert.throws(()=>applyBootServicePatch(Buffer.alloc(0),'unknown'));
});
test('actual original launchd renderer/manager select only owned label and preserve stop/start semantics',()=>{
 const module=realManager(),manager=module.selectBootServiceManager({platform:'darwin',homeDir:'/Users/fixture',xdgConfigHome:'',systemdUnitDir:undefined,uid:501,path:path.posix,environmentPath:'/usr/bin'});
 assert.equal(manager.unitPath,'/Users/fixture/Library/LaunchAgents/com.blackcrab.desktop.managed.service.plist');
 assert.deepEqual(JSON.parse(JSON.stringify(manager.stop[0].args)),['bootout','--wait','gui/501/com.blackcrab.desktop.managed.service']);
 assert.equal(manager.stop[0].optional,true);assert.equal(manager.activate[1].command,'launchctl');assert.equal(manager.activate[1].args[0],'bootstrap');
 const plan={program:['/owned/a&b/payload/t3','__service-launcher'],baseDir:'/owned/a&b',logPath:'/owned/log',unitPath:manager.unitPath},xml=manager.render(plan);
 assert(xml.includes('com.blackcrab.desktop.managed.service'));assert(!xml.includes('com.t3tools.t3code'));assert(xml.includes('a&amp;b'));assert(xml.includes('<integer>90</integer>'));assert.equal(module.bootServiceBaseDirOf(xml),plan.baseDir);assert.equal(module.bootServiceProgramOf(xml),plan.program[0]);
});
test('actual original systemd renderer preserves manager-owned nonblocking restart and isolation',()=>{
 const module=realManager(),manager=module.selectBootServiceManager({platform:'linux',homeDir:'/home/fixture',xdgConfigHome:'',systemdUnitDir:undefined,uid:501,path:path.posix,environmentPath:'/usr/bin'});
 assert.equal(manager.unitPath,'/home/fixture/.config/systemd/user/blackcrab.service');
 assert.deepEqual(JSON.parse(JSON.stringify(manager.handoff.at(-1).args)),['--user','restart','--no-block','blackcrab.service']);
 const rendered=manager.render({program:['/owned/100% space/payload/t3','__service-launcher'],baseDir:'/owned/100% space',logPath:'/owned/log',unitPath:manager.unitPath});
 for(const value of ['Description=Blackcrab server','KillMode=mixed','Restart=always','MemoryLow=1536M','OOMPolicy=continue'])assert(rendered.includes(value));
 assert.equal(module.bootServiceBaseDirOf(rendered),'/owned/100% space');assert.equal(module.bootServiceProgramOf(rendered),'/owned/100% space/payload/t3');
 assert.equal(module.selectBootServiceManager({platform:'win32',homeDir:'/fixture',path:path.posix}),undefined);
});
test('original protocol3 semantics are retained while the owned protocol4 profile rejects foreign state/context',()=>{
 const original=execute(read('fixtures/serviceProtocol.ts').toString());assert.equal(original.SERVICE_LAUNCHER_PROTOCOL,3);
 assert.equal(original.SERVICE_STOP_MARKER_FILE,'.service-stopping');assert.equal(original.decodeServiceState({protocol:3,activeVersion:'0.1.7'}).activeVersion,'0.1.7');
 assert.equal(original.decodeServiceState({protocol:3,activeVersion:'0.1.7',update:{id:'u',fromVersion:'0.1.6',targetVersion:'0.1.8',dbPath:'/owned/db',status:'pending'}}),undefined);
 assert.equal(original.decodeServiceLauncherChildMessage({type:'request-update',targetVersion:'0.1.8',dbPath:'/owned/db'}).type,'request-update');
 assert.equal(original.isExactServiceVersion('latest'),false);assert.equal(original.decodeServiceLauncherChildMessage({type:'request-update',targetVersion:'latest',dbPath:'/owned/db'}).targetVersion,'latest');
 const owned=execute(source('004-owned-layout-protocol'));assert.equal(owned.SERVICE_LAUNCHER_PROTOCOL,4);assert.equal(owned.decodeServiceState({protocol:3,activeVersion:'0.1.7'}),undefined);assert.equal(owned.decodeServiceState({protocol:4,activeVersion:'0.1.7'}).activeVersion,'0.1.7');
 assert.equal(owned.decodeServiceLauncherContext(JSON.stringify({protocol:3,childVersion:'0.1.7'})),undefined);assert.equal(owned.decodeServiceLauncherContext(JSON.stringify({protocol:4,childVersion:'0.1.7'})).protocol,4);
});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-boot-prep-'));await fs.chmod(dir,0o700);t.after(()=>fs.rm(dir,{recursive:true,force:true}));const ownerRoot=await fs.realpath(dir),artifact=path.join(ownerRoot,'artifact');await fs.mkdir(artifact);await fs.writeFile(path.join(ownerRoot,'.blackcrab-managed-host'),'blackcrab-managed-host-v1\n',{mode:0o600});
 for(const file of ['t3','client/index.html','LICENSE.upstream','THIRD-PARTY-NOTICES','resource-monitor/t3-resource-monitor']){await fs.mkdir(path.dirname(path.join(artifact,file)),{recursive:true});await fs.writeFile(path.join(artifact,file),'fixture');}await fs.chmod(path.join(artifact,'t3'),0o755);await fs.chmod(path.join(artifact,'resource-monitor/t3-resource-monitor'),0o755);
 await writeArtifactManifest(artifact,{platform:'darwin',arch:'arm64',sourcePatches:descriptors().map(({id,sha256})=>({id,sha256}))});
 return {ownerRoot,artifact,platform:'darwin',arch:'arm64',manifestSha256:sha(await fs.readFile(path.join(artifact,MANIFEST_FILE)))};}
test('real producer verifier yields opaque local plan with sentinel outside unchanged artifact; no install mutation',async t=>{
 const input=await fixture(t),receipt=await prepareLocalRuntimeInstallPlan(input),plan=localRuntimeInstallPlan(receipt);
 assert.equal(plan.wireProtocol,4);assert.equal(plan.layoutCompatibleWithUpstream,false);assert.equal(plan.entryPath,path.join(input.ownerRoot,'host/runtime/versions/0.1.7/payload/t3'));assert.equal(path.dirname(plan.sentinelPath),plan.versionDir);assert.equal(plan.capabilities.updaterAvailable,false);
 await assert.rejects(fs.stat(path.join(input.ownerRoot,'host')),{code:'ENOENT'});
 assert.throws(()=>localRuntimeInstallPlan({...receipt}),/Unverified/);plan.program[0]='attacker';assert.notEqual(localRuntimeInstallPlan(receipt).program[0],'attacker');
});
test('wrong pin, changed payload and unsafe owner marker refuse before install planning',async t=>{
 const input=await fixture(t);await assert.rejects(prepareLocalRuntimeInstallPlan({...input,manifestSha256:'0'.repeat(64)}),/manifest pin/);
 await fs.writeFile(path.join(input.artifact,'t3'),'tamper');await assert.rejects(prepareLocalRuntimeInstallPlan(input),/integrity/);
 await fs.chmod(path.join(input.ownerRoot,'.blackcrab-managed-host'),0o644);await assert.rejects(prepareLocalRuntimeInstallPlan(input),/marker/);
 await assert.rejects(prepareLocalRuntimeInstallPlan({...input,platform:'win32'}),/unsupported/);
});

test('local installer adapter executes real Effect and original typed errors without reading HTTP/release ports',async()=>{
 const Effect=appRequire('effect/Effect'),Schema=appRequire('effect/Schema');
 const raw=source('002-owned-payload-layout'),ast=ts.createSourceFile('pinned.ts',raw,ts.ScriptTarget.Latest,true);
 const declaration=ast.statements.find(x=>ts.isClassDeclaration(x)&&x.name?.text==='PinnedRuntimeInstallError');
 const {PinnedRuntimeInstallError}=execute(declaration.getText(ast),{Schema});
 const {makeVerifiedLocalInstaller}=execute(read('LocalInstaller.ts').toString(),{require:name=>name==='effect/Effect'?Effect:name==='./pinnedRuntime.ts'?{PinnedRuntimeInstallError}:(()=>{throw Error('Unexpected module');})()});
 const paths={versionDir:'/owned/versions/0.1.7',entryPath:'/owned/versions/0.1.7/payload/t3',sentinelPath:'/owned/versions/0.1.7/.install-complete'};
 let prepared=0,validated=0,committed=0,released=0;
 const binding={baseDir:'/owned/host',version:'0.1.7',platform:'darwin',arch:'arm64',paths,prepare:async()=>{prepared++;return {paths:{versionDir:'/owned/staging',entryPath:'/owned/staging/payload/t3',sentinelPath:'/owned/staging/.install-complete'},commit:async()=>{assert.equal(validated,1);committed++;},release:async()=>{released++;}};}};
 const install=makeVerifiedLocalInstaller(binding);binding.baseDir='/attacker';paths.entryPath='/attacker';
 const input={baseDir:'/owned/host',version:'0.1.7',platform:'darwin',arch:'arm64',get httpClient(){throw Error('HTTP must not be read');},get releaseBaseUrl(){throw Error('Release URL must not be read');},validate:value=>Effect.sync(()=>{validated++;assert.equal(value.entryPath,'/owned/staging/payload/t3');})};
 Object.defineProperty(input,'httpClient',{enumerable:false});Object.defineProperty(input,'releaseBaseUrl',{enumerable:false});
 const installed=await Effect.runPromise(install(input));assert.equal(installed.entryPath,'/owned/versions/0.1.7/payload/t3');assert.equal(prepared,1);assert.equal(validated,1);assert.equal(committed,1);assert.equal(released,1);
 const fail=effect=>Effect.runPromise(effect.pipe(Effect.match({onFailure:error=>error,onSuccess:()=>{throw Error('Expected refusal');}})));
 let error=await fail(install({...input,version:'0.1.8'}));assert(error instanceof PinnedRuntimeInstallError);assert(error.step.includes('matching'));assert.equal(prepared,1);
 error=await fail(install({...input,requirePublishedRelease:true}));assert(error instanceof PinnedRuntimeInstallError);assert(error.step.includes('unavailable'));assert.equal(prepared,1);
 const original=new PinnedRuntimeInstallError({step:'fixture version validation'});
 error=await fail(install({...input,validate:()=>Effect.fail(original)}));assert.equal(error,original);assert.equal(committed,1);assert.equal(released,2);
});

test('actual launcher refuses old/missing/tampered layout and accepts only owned protocol4 metadata',async t=>{
 const input=await fixture(t),plan=localRuntimeInstallPlan(await prepareLocalRuntimeInstallPlan(input));
 const text=source('003-launcher-payload-layout'),ast=ts.createSourceFile('launcher.ts',text,ts.ScriptTarget.Latest,true);
 const names=new Set(['runtimePaths','readOwnedRuntimeMetadata','runtimeExists']);
 const statements=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(x=>names.has(x.name.getText(ast))));
 const module=execute(statements.map(x=>x.getText(ast)).join('\n')+'\nexports.runtimeExists=runtimeExists;',{NodePath:path,NodeFSP:fs,NodeFS:syncfs,NodeCrypto:await import('node:crypto'),process,Buffer,SERVICE_LAUNCHER_PROTOCOL:4});
 await fs.mkdir(plan.payload,{recursive:true});await fs.copyFile(path.join(input.artifact,'t3'),plan.entryPath);await fs.copyFile(path.join(input.artifact,MANIFEST_FILE),path.join(plan.payload,MANIFEST_FILE));await fs.writeFile(plan.sentinelPath,plan.version+'\n',{mode:0o600});
 assert.equal(await module.runtimeExists(plan.baseDir,plan.version),false);
 await fs.writeFile(plan.layoutMarker.file,JSON.stringify(plan.layoutMarker.contents),{mode:0o600});
 assert.equal(await module.runtimeExists(plan.baseDir,plan.version),true);
 await fs.writeFile(plan.layoutMarker.file,JSON.stringify({...plan.layoutMarker.contents,protocol:3}));assert.equal(await module.runtimeExists(plan.baseDir,plan.version),false);
 await fs.writeFile(plan.layoutMarker.file,JSON.stringify(plan.layoutMarker.contents));await fs.chmod(plan.layoutMarker.file,0o644);assert.equal(await module.runtimeExists(plan.baseDir,plan.version),false);await fs.chmod(plan.layoutMarker.file,0o600);
 await fs.writeFile(path.join(plan.payload,MANIFEST_FILE),'changed');assert.equal(await module.runtimeExists(plan.baseDir,plan.version),false);
 await fs.copyFile(path.join(input.artifact,MANIFEST_FILE),path.join(plan.payload,MANIFEST_FILE));
 await fs.rename(plan.layoutMarker.file,plan.layoutMarker.file+'.saved');await fs.symlink(plan.layoutMarker.file+'.saved',plan.layoutMarker.file);assert.equal(await module.runtimeExists(plan.baseDir,plan.version),false);
});

function actualLauncher({fsPromises=fs,timers={}}={}){const protocol=execute(source('004-owned-layout-protocol'));return execute(source('003-launcher-payload-layout'),{require:name=>name==='./cloud/serviceProtocol.ts'?protocol:name==='node:fs/promises'?fsPromises:name.startsWith('node:')?require(name):(()=>{throw Error('Unexpected launcher module '+name);})(),process,Buffer,setTimeout,clearTimeout,setInterval,clearInterval,console,Promise,...timers});}
const waitFor=async predicate=>{const deadline=Date.now()+15000;for(;;){if(await predicate())return;if(Date.now()>deadline)throw Error('Owned launcher observation timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
async function launcherFixture(t,mode,options){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-original-launcher-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const db=path.join(directory,'owned.db'),record=path.join(directory,'children.jsonl'),script=path.join(directory,'fixture.cjs');await fs.writeFile(db,'before-trial');
 await fs.writeFile(script,`const fs=require('node:fs');const context=JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);fs.appendFileSync(process.env.BLACKCRAB_TEST_RECORD,JSON.stringify({version:context.childVersion,protocol:context.protocol,pid:process.pid})+'\\n');if(context.protocol!==4)process.exit(99);if(context.childVersion==='0.1.8'){fs.writeFileSync(process.env.BLACKCRAB_TEST_DB,'trial-write');if(process.env.BLACKCRAB_TEST_MODE==='exit78')process.exit(78);if(process.env.BLACKCRAB_TEST_MODE==='rollback')process.exit(1);process.send({type:'prepared',updateId:context.update.id});}setInterval(()=>{},1000);`);
 for(const version of ['0.1.7','0.1.8']){const root=path.join(directory,'runtime/versions',version),payload=path.join(root,'payload');await fs.mkdir(payload,{recursive:true});await fs.writeFile(path.join(payload,'t3'),'#!/bin/sh\nexec "$BLACKCRAB_TEST_NODE" "$BLACKCRAB_TEST_SCRIPT" "$@"\n',{mode:0o755});const manifest=JSON.stringify({fixture:'owned captured-child test',version});await fs.writeFile(path.join(payload,MANIFEST_FILE),manifest);await fs.writeFile(path.join(root,'.install-complete'),version+'\n',{mode:0o600});await fs.writeFile(path.join(root,'.blackcrab-service-layout.json'),JSON.stringify({schema:1,profile:'blackcrab-local-service-layout-v1',protocol:4,version,manifestSha256:sha(manifest)}),{mode:0o600});}
 const module=actualLauncher(options),state={protocol:4,activeVersion:'0.1.7',update:{id:'owned-update',fromVersion:'0.1.7',targetVersion:'0.1.8',dbPath:db,status:'pending'}},statePath=path.join(directory,'runtime/service-state.json');await module.writeServiceState(statePath,state);
 const launcher=new module.Launcher(directory,state,{environment:{PATH:'/usr/bin:/bin',BLACKCRAB_TEST_NODE:process.execPath,BLACKCRAB_TEST_SCRIPT:script,BLACKCRAB_TEST_RECORD:record,BLACKCRAB_TEST_DB:db,BLACKCRAB_TEST_MODE:mode}});
 const running=launcher.run();running.catch(error=>t.diagnostic('Captured launcher error: '+error.stack));t.after(async()=>{await launcher.stop('SIGTERM');await running;});
 return {directory,db,record,launcher,running,statePath,module};
}
test('real original captured-child launcher commits a prepared protocol4 trial then explicitly stops only its child',async t=>{
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(unrelated,'spawn');t.after(async()=>{if(unrelated.exitCode===null&&unrelated.signalCode===null){const exited=once(unrelated,'exit');unrelated.kill();await exited;}});
 const f=await launcherFixture(t,'commit');await waitFor(async()=>{const state=await f.module.readServiceState(f.statePath);return state.update?.status==='committed';});
 const state=await f.module.readServiceState(f.statePath);assert.equal(state.activeVersion,'0.1.8');assert.equal(await fs.readFile(f.db,'utf8'),'trial-write');
 const children=(await fs.readFile(f.record,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(children.length,1);assert.equal(children[0].protocol,4);
 await f.launcher.stop('SIGTERM');await f.running;assert.equal(unrelated.exitCode,null);assert.equal(unrelated.signalCode,null);assert.equal(await fs.readFile(path.join(f.directory,'runtime/.service-stopping'),'utf8'),'');
});
test('real original trial failure rolls back database bytes and starts captured previous version',async t=>{
 const f=await launcherFixture(t,'rollback');await waitFor(async()=>{try{return(await fs.readFile(f.record,'utf8')).trim().split('\n').length===2;}catch{return false;}});
 const state=await f.module.readServiceState(f.statePath);assert.equal(state.activeVersion,'0.1.7');assert.equal(state.update.status,'rolled-back');assert.equal(state.update.reason,'candidate-exited:1');assert.equal(await fs.readFile(f.db,'utf8'),'before-trial');
 const versions=(await fs.readFile(f.record,'utf8')).trim().split('\n').map(x=>JSON.parse(x).version);assert.deepEqual(versions,['0.1.8','0.1.7']);
});
test('real original ownership exit78 idles without restoring over another owner or spawning a predecessor',async t=>{
 const f=await launcherFixture(t,'exit78');await waitFor(async()=>{const state=await f.module.readServiceState(f.statePath);return state.update?.reason==='state-dir-owned';});
 assert.equal(await fs.readFile(f.db,'utf8'),'trial-write');assert.equal((await fs.readFile(f.record,'utf8')).trim().split('\n').length,1);assert.equal((await f.module.readServiceState(f.statePath)).update.status,'failed');
});

test('stop waits for ownership transition and clears its late keepalive timer',async t=>{
 const intervals=new Set();
 let paused=false,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const f=await launcherFixture(t,'exit78',{
  fsPromises:{...fs,rm:async(file,options)=>{
   if(path.basename(file)==='owned-update'&&path.basename(path.dirname(file))==='db-backup'){
    paused=true;await gate;
   }
   return fs.rm(file,options);
  }},
  timers:{
   setInterval:(...args)=>{const timer=setInterval(...args);intervals.add(timer);return timer;},
   clearTimeout:timer=>{intervals.delete(timer);clearTimeout(timer);},
  },
 });
 try{
  await waitFor(()=>paused);
  // The state has been written, but the serialized ownership transition still
  // has to finish removing its backup before it installs the idle timer.
  assert.equal((await f.module.readServiceState(f.statePath)).update.reason,'state-dir-owned');
  const stopping=f.launcher.stop('SIGTERM');
  release();await stopping;await f.running;
  assert.equal(intervals.size,0,'completed shutdown must clear timers installed by an earlier transition');
  assert.equal(await fs.readFile(f.db,'utf8'),'trial-write');
  assert.equal((await fs.readFile(f.record,'utf8')).trim().split('\n').length,1);
 }finally{
  release();await f.launcher.stop('SIGTERM');await f.running;
  // Keep a failing regression from stranding this test process.
  for(const timer of intervals)clearInterval(timer);
 }
});

test('a self-consistent original3 or C21-style artifact cannot be adopted as the owned service profile',async t=>{
 const input=await fixture(t),file=path.join(input.artifact,MANIFEST_FILE),manifest=JSON.parse(await fs.readFile(file));manifest.sourcePatches=[];await fs.writeFile(file,JSON.stringify(manifest));
 await assert.rejects(prepareLocalRuntimeInstallPlan({...input,manifestSha256:sha(await fs.readFile(file))}),/lacks owned boot-service profile/);
 await assert.rejects(fs.stat(path.join(input.ownerRoot,'host')),{code:'ENOENT'});
});

test('owned updater capability and actual update effect fail closed before installer, HTTP, progress or handoff',async()=>{
 const Effect=appRequire('effect/Effect'),contracts=await import('@t3tools/contracts');
 const policy=execute(read('fixtures/managedUpdates.ts').toString(),{require:name=>name==='@t3tools/contracts'?contracts:(()=>{throw Error('Unexpected policy dependency');})()});
 const text=source('005-unconfigured-owned-updater-gate'),ast=ts.createSourceFile('selfUpdate.ts',text,ts.ScriptTarget.Latest,true);
 const capability=ast.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text==='resolveServerSelfUpdateCapability');
 const resolver=execute(capability.getText(ast)).resolveServerSelfUpdateCapability;
 for(const desktopManaged of [false,true])for(const launcherManaged of [false,true])assert.equal(resolver({desktopManaged,launcherManaged}),null);
 const names=new Set(['capability','failWith','update']);const declarations=[];
 function visit(node){if(ts.isVariableDeclaration(node)&&names.has(node.name.getText(ast)))declarations.push(node);ts.forEachChild(node,visit);}visit(ast);
 assert.equal(declarations.length,3);
 const unreachable=()=>{throw Error('Unconfigured updater reached an external effect');};
 const module=execute(declarations.map(x=>'const '+x.getText(ast)+';').join('\n')+'\nexports.update=update;',{
  Effect,ServerSelfUpdateError:contracts.ServerSelfUpdateError,resolveServerSelfUpdateCapability:resolver,serverConfig:{mode:'web'},launcher:{managed:true},policy:{document:undefined},managedUpdateRefusal:policy.managedUpdateRefusal,
  ensurePinnedRuntimeInstalled:unreachable,httpClient:new Proxy({},{get:unreachable}),runner:new Proxy({},{get:unreachable}),desktopAppUpdate:new Proxy({},{get:unreachable}),
 });
 const error=await Effect.runPromise(module.update({targetVersion:'0.1.8'},unreachable,unreachable).pipe(Effect.match({onFailure:error=>error,onSuccess:()=>{throw Error('Update unexpectedly succeeded');}})));
 assert.equal(error._tag,'ServerSelfUpdateError');assert(error.reason.includes('owned release installer'));
 assert(!text.includes('yield* pruneRuntimesOnStart({ baseDir: serverConfig.baseDir'));
});
