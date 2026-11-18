import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ideWriteFile} from '../managed-host/features/ideGuardedWrite.ts';
import {ideChanges,receiveFile,workspaceRelativePath,selectionContext,changedRegion,enqueueFlash,flashDuration,MAX_QUEUED_FLASHES} from './patches/ide-mode/ideState.ts';
const fixture=async fn=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-ide-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}};
test('guarded save preserves old bytes, permissions and an open provider descriptor',()=>fixture(async dir=>{
 const file=path.join(dir,'code.ts');await fs.writeFile(file,'before',{mode:0o640});
 const provider=await fs.open(file,'r+');
 try {
  const result=await ideWriteFile(file,'user edit','before');
  assert.equal(result.conflict,false);assert.equal(await fs.readFile(file,'utf8'),'user edit');
  assert.equal(await fs.readFile(result.recoveryPath,'utf8'),'before');
  assert.equal((await fs.stat(file)).mode&0o777,0o640);
  await provider.write('AGENT!',0,'utf8');
  assert.equal(await fs.readFile(result.recoveryPath,'utf8'),'AGENT!');
  assert.equal(await fs.readFile(file,'utf8'),'user edit');
 }finally{await provider.close();}
}));
test('external edit and concurrent stale saves refuse overwrite',()=>fixture(async dir=>{
 const file=path.join(dir,'code');await fs.writeFile(file,'agent');
 assert.equal((await ideWriteFile(file,'user','old')).conflict,true);
 assert.equal(await fs.readFile(file,'utf8'),'agent');
 const results=await Promise.all([ideWriteFile(file,'a','agent'),ideWriteFile(file,'b','agent')]);
 assert.equal(results.filter(r=>r.conflict===false).length,1);
 assert.equal(results.filter(r=>r.conflict===true).length,1);
 assert.equal(await fs.readFile(file,'utf8'),'a');
}));
test('deleted, symlink, invalid UTF-8 and oversized edits fail without data loss',()=>fixture(async dir=>{
 const file=path.join(dir,'code'); await assert.rejects(ideWriteFile(file,'new','old'));
 await fs.writeFile(file,Buffer.from([0xff]));await assert.rejects(ideWriteFile(file,'new','�'));assert.deepEqual(await fs.readFile(file),Buffer.from([0xff]));
 await fs.writeFile(file,'old');await fs.symlink(file,path.join(dir,'link'));await assert.rejects(ideWriteFile(path.join(dir,'link'),'new','old'));
 await assert.rejects(ideWriteFile(file,'x'.repeat(2*1024*1024+1),'old'));assert.equal(await fs.readFile(file,'utf8'),'old');
}));
test('follow uses structured host changes, bounds paths, and preserves event order',()=>{
 const items=[{item:{id:'1',type:'file_change',status:'running',fileName:'/repo/a.ts'}},{item:{id:'2',type:'command_execution',status:'completed',fileName:'fake.ts'}},{item:{id:'3',type:'file_change',status:'completed',changes:[{path:'b.ts',operation:'add'},{path:'../secret',operation:'edit'}]}}];
 assert.deepEqual(ideChanges('/repo',items).map(v=>v.path),['a.ts','b.ts']);
 assert.equal(workspaceRelativePath('/repo','/repo-other/a'),null);
 assert.equal(workspaceRelativePath('C:\\Repo','c:\\repo\\src\\a.ts'),'src/a.ts');
 assert.equal(workspaceRelativePath('/repo','../secret'),null);
});
test('clean snapshots refresh; dirty drafts keep base and incoming; old hosts stay read only',()=>{
 let draft=receiveFile(undefined,'old',false,false);assert.equal(draft.safe,false);
 draft={...draft,text:'user'};draft=receiveFile(draft,'agent',true,false);
 assert.deepEqual(draft,{base:'old',text:'user',incoming:'agent',safe:true,truncated:false});
 assert.equal(receiveFile({...draft,text:'old'},'agent',true,false).text,'agent');
 assert.deepEqual(selectionContext('src/a.ts','a\nb\nc',3,2),{filePath:'src/a.ts',contents:'a\nb\nc',startLine:2,endLine:3});
});
test('renderer records are in the desktop registry and service records in the service profile',async()=>{
 const service=JSON.parse(await fs.readFile(new URL('../managed-host/features/registry.json',import.meta.url))).filter(record=>record.id.startsWith('ide-'));
 assert.deepEqual(service.map(record=>record.id),['ide-contract','ide-host','ide-ideGuardedWrite-ts','ide-IdeWorkspaceFileSystem-test-ts']);
 for(const record of service){const bytes=await fs.readFile(new URL('../managed-host/features/'+record.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);}
 const production=JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url))).filter(record=>record.id.startsWith('ide-mode-045-'));
 assert.deepEqual(production.map(record=>record.target),['packages/contracts/src/project.ts','apps/web/src/components/files/FilePreviewPanel.tsx','apps/web/src/components/ChatView.tsx',...['IdePanel.tsx','ideState.ts','ide-mode.css','IdePanel.browser.test.tsx','IdeCodeEditor.browser.test.tsx'].map(name=>'apps/web/src/components/ide/'+name),'apps/web/src/components/ChatView.tsx']);
 // 0.4.5 shipped the toggle under the window's panel buttons. It now keeps the room the header title used to keep for them.
 const header=production.at(-1).replacements[0].after;assert.match(header,/reservePanelControls=\{pane === null && !ideEnabled\}/);assert.match(header,/pane === null && \(inlineRightPanelOwnsTitleBar \? "mr-10" : "mr-24"\)/);
 for(const record of production)assert.match(record.file,/^ide-mode\/[A-Za-z.-]+$/);
 // Both sides are built from the same contract: the workspace and its service agree on the fields.
 const [desktop]=production,[shared]=service;
 assert.deepEqual([shared.target,shared.sha256,shared.beforeSha256,shared.afterSha256],[desktop.target,desktop.sha256,desktop.beforeSha256,desktop.afterSha256]);
 // The toggle is part of the workspace, not a build option.
 assert.doesNotMatch(JSON.stringify(production),/VITE_BLACKCRAB_IDE_MODE/);
});

test('changedRegion finds the first changed line and the added and removed counts',()=>{
 assert.equal(changedRegion('a\nb','a\nb'),null);
 assert.deepEqual(changedRegion('a\nb\nc','a\nX\nY\nc'),{firstLine:2,removed:1,added:2});
 assert.deepEqual(changedRegion('a\nb','a\nb\nc'),{firstLine:3,removed:0,added:1});
 assert.deepEqual(changedRegion('a\nb\nc','a\nc'),{firstLine:2,removed:1,added:0});
 assert.deepEqual(changedRegion('','x'),{firstLine:1,removed:0,added:1});
});
test('enqueueFlash keeps edits in order, merges a repeated file and drops no-op results',()=>{
 const f=(key,before,after)=>({key,path:key,before,after});
 let q=enqueueFlash([],f('a','1','2'));q=enqueueFlash(q,f('b','x','y'));
 assert.deepEqual(q.map(x=>x.key),['a','b']);
 q=enqueueFlash(q,f('a','2','3'));
 assert.deepEqual(q.map(x=>x.key),['b','a']);
 assert.deepEqual([q[1].before,q[1].after],['1','3']);
 q=enqueueFlash(q,f('a','3','1'));
 assert.deepEqual(q.map(x=>x.key),['b']);
 let many=[];for(let i=0;i<MAX_QUEUED_FLASHES+5;i++)many=enqueueFlash(many,f('k'+i,'0','1'));
 assert.equal(many.length,MAX_QUEUED_FLASHES);assert.equal(many[0].key,'k5');
 assert.ok(flashDuration(3)<flashDuration(0));
});
