import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ideWriteFile} from './ide-mode/payloads/ideGuardedWrite.ts';
import {ideChanges,receiveFile,workspaceRelativePath,selectionContext} from './ide-mode/payloads/ideState.ts';
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
test('experimental payload hashes match and production recipes do not enable IDE',async()=>{
 const registry=JSON.parse(await fs.readFile(new URL('./ide-mode/registry.json',import.meta.url)));
 for(const record of registry){const bytes=await fs.readFile(new URL('./ide-mode/'+record.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);}
 for(const name of ['source.mjs','build.mjs']) assert.doesNotMatch(await fs.readFile(new URL(name,import.meta.url),'utf8'),/applyIdeMode|ide-mode\/apply/);
});
