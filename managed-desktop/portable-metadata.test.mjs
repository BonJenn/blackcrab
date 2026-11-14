import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {portableVersion,stagePortableMetadata,verifyPortableMetadata,PORTABLE_IDENTITY} from './portable-metadata.mjs';
import {fileDigest} from './artifact-data.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-portable-metadata-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3}));
  await fs.mkdir(path.join(root,'resources'));
  const elf=Buffer.alloc(128);elf.set([0x7f,0x45,0x4c,0x46,2,1]);elf.writeUInt16LE(62,18);
  await fs.writeFile(path.join(root,'Blackcrab'),elf);
  return {root,targetId:'linux-x64',version:'0.4.4'};
}
test('portable versions cannot truncate, overflow or inject native metadata',()=>{
  assert.deepEqual(portableVersion('0.4.4'),[0,4,4,0]);assert.deepEqual(portableVersion('65535.0.65535'),[65535,0,65535,0]);
  for(const v of ['0.4.4-beta','0.4.4\nExec=other','65536.0.0','01.2.3','1.2','1.2.3.4','1.2.-1',null])assert.throws(()=>portableVersion(v),/version/);
});
test('Linux identity retains runtime bytes and uses the outer launcher, with owned icon and version',async t=>{
  const f=await fixture(t),before=await fileDigest(path.join(f.root,'Blackcrab'));
  const record=await stagePortableMetadata(f);
  assert.equal(record.desktopEntryRole,'outer-launcher-template');
  assert.equal(await fileDigest(path.join(f.root,'Blackcrab')),before);
  assert.deepEqual(await verifyPortableMetadata(f),record);
  const entry=await fs.readFile(path.join(f.root,'resources',record.desktopEntry),'utf8');
  assert.match(entry,/\nExec=blackcrab %U\n/);assert.match(entry,/\nX-Blackcrab-Version=0\.4\.4\n/);
  assert(!entry.includes(f.root));assert(!/electron|t3/i.test(entry));
});
test('portable staging refuses existing assets and invalid versions before mutation',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'resources/icon.png'),'keep');
  await assert.rejects(stagePortableMetadata(f),/already exists/);
  assert.equal(await fs.readFile(path.join(f.root,'resources/icon.png'),'utf8'),'keep');
  await assert.rejects(stagePortableMetadata({...f,version:'0.4.4\nother'}),/version/);
  assert.deepEqual(await fs.readdir(path.join(f.root,'resources')),['icon.png']);
});
test('metadata verification rejects stale versions, replaced icons and executable injection in shortcuts',async t=>{
  const f=await fixture(t);await stagePortableMetadata(f);
  await assert.rejects(verifyPortableMetadata({...f,version:'0.4.5'}),/identity mismatch/);
  const icon=path.join(f.root,'resources/icon.png'),before=await fs.readFile(icon);await fs.writeFile(icon,'not the app icon');
  await assert.rejects(verifyPortableMetadata(f),/identity mismatch/);await fs.writeFile(icon,before);
  const entry=path.join(f.root,'resources',PORTABLE_IDENTITY.desktopId+'.desktop');await fs.appendFile(entry,'Exec=other\n');
  await assert.rejects(verifyPortableMetadata(f),/template mismatch/);
});
test('portable metadata rejects linked output resources and leaves the Mac producer alone',async t=>{
  const f=await fixture(t);await assert.rejects(stagePortableMetadata({...f,targetId:'darwin-arm64'}),/requires Windows or Linux/);
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-metadata-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.rmdir(path.join(f.root,'resources'));await fs.symlink(outside,path.join(f.root,'resources'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(stagePortableMetadata(f),/real staging directory/);assert.deepEqual(await fs.readdir(outside),[]);
});
