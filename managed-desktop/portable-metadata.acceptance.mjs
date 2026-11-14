// Run after installing the frozen upstream desktop build tools. This suite uses
// the real resource editor and synthetic PEs; native CI also launches real Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadWindowsResourceEditor,rewriteWindowsMetadata,verifyWindowsMetadata} from './portable-metadata.mjs';

const editor=await loadWindowsResourceEditor(process.env.BLACKCRAB_METADATA_SOURCE);
const icon=await fs.readFile(new URL('./assets/icon.ico',import.meta.url));
const originalIcon=editor.Data.RawIconItem.from(await fs.readFile(new URL('./assets/favicon-32x32.png',import.meta.url)),32,32,32);
function fixture() {
  const exe=editor.NtExecutable.createEmpty(false,false);exe.newHeader.fileHeader.machine=0x8664;
  const resource=editor.NtExecutableResource.from(exe);
  for(const [resourceLanguage,languages] of [[1033,[1033,1041]],[1031,[1031]]]) {
    editor.Resource.VersionInfo.create({lang:resourceLanguage,fixedInfo:{fileVersionMS:7,fileVersionLS:1,productVersionMS:7,productVersionLS:1},strings:languages.map(lang=>({lang,codepage:1200,values:{ProductName:'Upstream product',FileDescription:'Upstream description',OriginalFilename:'electron.exe',FileVersion:'0.7.1',ProductVersion:'0.7.1',LegalCopyright:'Retained upstream copyright'}}))}).outputToResourceEntries(resource.entries);
  }
  for(const [id,lang] of [[101,1033],[102,1041]])editor.Resource.IconGroupEntry.replaceIconsForResource(resource.entries,id,lang,[originalIcon]);
  resource.entries.push({type:24,id:1,lang:1033,codepage:1200,bin:Buffer.from('<assembly>unchanged manifest</assembly>')});
  resource.outputResource(exe);
  return Buffer.from(exe.generate());
}
function modify(bytes,mutate) {
  const exe=editor.NtExecutable.from(bytes),resources=editor.NtExecutableResource.from(exe);mutate(resources);resources.outputResource(exe);return Buffer.from(exe.generate());
}
test('all localized version tables and icon groups are rebranded without losing legal or manifest resources',()=>{
  const before=fixture(),output=rewriteWindowsMetadata(before,icon,'0.4.4',editor);
  const report=verifyWindowsMetadata(output,icon,'0.4.4',editor);assert.equal(report.versionTables,4);assert.equal(report.iconGroups,2);
  const exe=editor.NtExecutable.from(output),resources=editor.NtExecutableResource.from(exe);
  for(const info of editor.Resource.VersionInfo.fromEntries(resources.entries)) for(const language of info.getAllLanguagesForStringValues()) {
    const strings=info.getStringValues(language);
    // setFileVersion adds an English fallback to the German resource.
    if(language.lang!==1033||info.lang===1033)assert.equal(strings.LegalCopyright,'Retained upstream copyright');
    assert.equal(strings.ProductName,'Blackcrab');
  }
  assert.equal(Buffer.from(resources.entries.find(r=>r.type===24).bin).toString(),'<assembly>unchanged manifest</assembly>');
  assert.equal(exe.newHeader.optionalHeaderDataDirectory.get(4).size,0);
});
test('one stale translation cannot pass verification behind a correct English product name',()=>{
  const output=rewriteWindowsMetadata(fixture(),icon,'0.4.4',editor);
  const corrupt=modify(output,resources=>{const info=editor.Resource.VersionInfo.fromEntries(resources.entries).find(i=>i.lang===1033);info.setStringValue({lang:1041,codepage:1200},'ProductName','Upstream product');info.outputToResourceEntries(resources.entries);});
  assert.throws(()=>verifyWindowsMetadata(corrupt,icon,'0.4.4',editor),/ProductName/);
});
test('old icons, stale versions and absent native version resources are rejected',()=>{
  const output=rewriteWindowsMetadata(fixture(),icon,'0.4.4',editor);
  const corrupt=modify(output,resources=>editor.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,102,1041,[originalIcon]));
  assert.throws(()=>verifyWindowsMetadata(corrupt,icon,'0.4.4',editor),/icon mismatch/);
  assert.throws(()=>verifyWindowsMetadata(output,icon,'0.4.5',editor),/version|Version/);
  const missing=modify(fixture(),resources=>{resources.entries=resources.entries.filter(e=>e.type!==16);});
  assert.throws(()=>rewriteWindowsMetadata(missing,icon,'0.4.4',editor),/version resource missing/);
});
test('Windows resource rewriting rejects a different architecture and overflowing release version',()=>{
  const wrong=editor.NtExecutable.createEmpty(true,false).generate();
  assert.throws(()=>rewriteWindowsMetadata(wrong,icon,'0.4.4',editor),/x64 PE/);
  assert.throws(()=>rewriteWindowsMetadata(fixture(),icon,'0.4.65536',editor),/version bounds/);
});
