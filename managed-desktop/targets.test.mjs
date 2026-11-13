import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {desktopTarget,desktopBuildTarget,verifyElectronArchive,verifyElectronExecutable} from './targets.mjs';
import {ELECTRON} from './artifact-data.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-target-test-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  return async (name, bytes) => { const file = path.join(root, name); await fs.writeFile(file, bytes); return file; };
}
function macho() { const b=Buffer.alloc(64); b.writeUInt32LE(0xfeedfacf); b.writeUInt32LE(0x0100000c,4); return b; }
function elf() { const b=Buffer.alloc(64); Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(b); b.writeUInt16LE(62,18); return b; }
function pe() { const b=Buffer.alloc(134); b.writeUInt16LE(0x5a4d); b.writeUInt32LE(128,0x3c); b.writeUInt32LE(0x00004550,128); b.writeUInt16LE(0x8664,132); return b; }

test('known platform inputs cannot silently enable an unimplemented producer or mutate the existing Mac manifest',()=>{
 assert.equal(JSON.stringify(ELECTRON),JSON.stringify({version:'44.10.1',platform:'darwin',arch:'arm64',archiveSha256:'687f922034f1e991ab34ed7f47c4cb4e5c5e85e974b0ce155c22ce6d6f699aa3',url:'https://github.com/electron/electron/releases/download/v44.10.1/electron-v44.10.1-darwin-arm64.zip'}));
 assert.equal(desktopBuildTarget('darwin','arm64').electron,ELECTRON);
 for(const id of ['linux-x64','win32-x64']) {
  const selected=desktopTarget(id);
  assert.equal(selected.producerImplemented,false);
  assert.throws(()=>desktopBuildTarget(selected.electron.platform,selected.electron.arch),/not implemented/);
  assert.throws(()=>{selected.producerImplemented=true;},TypeError);
  assert.throws(()=>{selected.electron.archiveSha256='0'.repeat(64);},TypeError);
  assert.throws(()=>{selected.layout.executable='../other';},TypeError);
 }
 for(const id of ['linux-arm64','darwin-x64','windows-x64','__proto__','toString',null,{}])assert.throws(()=>desktopTarget(id),/Unsupported/);
});

test('runtime input rejects corrupt archives, directory paths and symlinks',async t=>{
 const write=await fixture(t),file=await write('wrong.zip',Buffer.from('not the pinned Electron archive'));
 for(const id of ['darwin-arm64','linux-x64','win32-x64'])await assert.rejects(verifyElectronArchive(file,id),/digest mismatch/);
 await assert.rejects(verifyElectronArchive(path.dirname(file),'linux-x64'),/regular file/);
 const link=file+'.link';await fs.symlink(file,link);
 await assert.rejects(verifyElectronArchive(link,'linux-x64'),/regular file/);
});

test('native header inspection distinguishes all three platforms and rejects wrong architectures or truncation',async t=>{
 const write=await fixture(t),samples=[['darwin-arm64',macho()],['linux-x64',elf()],['win32-x64',pe()]];
 for(const [id,bytes] of samples) {
  const file=await write(id,bytes);
  assert.equal((await verifyElectronExecutable(file,id)).id,id);
  for(const [other] of samples)if(id!==other)await assert.rejects(verifyElectronExecutable(file,other),/format\/architecture/);
  await assert.rejects(verifyElectronExecutable(await write(id+'-short',bytes.subarray(0,32)),id),/format\/architecture/);
 }
 const armWindows=pe();armWindows.writeUInt16LE(0xaa64,132);
 const armLinux=elf();armLinux.writeUInt16LE(183,18);
 const x86Mac=macho();x86Mac.writeUInt32LE(0x01000007,4);
 for(const [id,bytes] of [['win32-x64',armWindows],['linux-x64',armLinux],['darwin-arm64',x86Mac]])
  await assert.rejects(verifyElectronExecutable(await write(id+'-wrong-arch',bytes),id),/format\/architecture/);
});

test('PE header offsets are bounded and must point to a complete valid signature',async t=>{
 const write=await fixture(t);
 for(const offset of [0,63,129,1024*1024+1,0xffffffff]) {
  const bytes=pe();bytes.writeUInt32LE(offset,0x3c);
  await assert.rejects(verifyElectronExecutable(await write(String(offset),bytes),'win32-x64'),/format\/architecture/);
 }
 const bytes=pe();bytes[128]=0;
 await assert.rejects(verifyElectronExecutable(await write('signature',bytes),'win32-x64'),/format\/architecture/);
});
