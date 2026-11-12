import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {verifyExperienceExport} from '../export.mjs';
import {mobileCloudPatchDescriptors,mobileCloudPatchedBytes} from '../cloud-source-patches.mjs';

const [preparation,...extra]=process.argv.slice(2);
if(!preparation||extra.length)throw Error('Usage: build-registry.mjs <authenticated-mobile-preparation>');
await verifyExperienceExport(preparation);
const directory=path.dirname(fileURLToPath(import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const graph=JSON.parse(await fs.readFile(path.join(preparation,'IMPORT-GRAPH.json'),'utf8'));
const cloud=await mobileCloudPatchDescriptors();
const records=[];
for(const file of graph.files.filter(f=>f.runtime&&f.path.startsWith('packages/')&&/\.[cm]?[jt]sx?$/.test(f.path)&&!/\.(test|spec)\./.test(f.path))){
 let bytes=await fs.readFile(path.join(preparation,'source',file.path));
 const prior=cloud.find(p=>p.target===file.path);if(prior)bytes=await mobileCloudPatchedBytes(bytes,prior);
 const before=bytes.toString('utf8'),parsed=ts.createSourceFile(file.path,before,ts.ScriptTarget.Latest,true,file.path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const edits=[];let limitRange;
 if(file.path==='packages/client-runtime/src/relay/errorPresentation.ts'){
  const importText='  T3CHAT_PLAN_TUNNEL_LIMITS,\n';
  const importStart=before.indexOf(importText);if(importStart<0)throw Error('Tunnel limit import differs');
  edits.push({start:importStart,end:importStart+importText.length,after:''});
  const start=before.indexOf('    case "RelayEnvironmentLinkLimitExceededError":');
  const end=before.indexOf('    case "RelayAgentActivityPublishProofExpiredError":',start);
  if(start<0||end<start)throw Error('Tunnel limit presentation differs');
  limitRange={start,end};
  edits.push({...limitRange,after:'    case "RelayEnvironmentLinkLimitExceededError":\n      return `Relay refused the link: this account already has its maximum of ${error.maxTunnels} managed tunnels. Unlink an environment to free one up.`;\n'});
 }
 function visit(node){
  if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)||ts.isJsxText(node)){
   const start=node.getStart(parsed),end=node.end;
   if(limitRange&&start>=limitRange.start&&end<=limitRange.end)return;
   // This is the actual third-party GitHub App name, not Blackcrab UI branding.
   if(node.text==='T3 Code for GitHub')return;
   const raw=before.slice(start,end),after=raw.replace(/\bT3 Code\b/g,'Blackcrab').replace(/\bT3 Connect\b/g,'Blackcrab Connect').replace(/\bT3 Account\b/g,'Blackcrab Account');
   if(after!==raw)edits.push({start,end,after});
  }
  ts.forEachChild(node,visit);
 }
 visit(parsed);if(!edits.length)continue;
 edits.sort((a,b)=>a.start-b.start);
 for(let i=1;i<edits.length;i++)if(edits[i].start<edits[i-1].end)throw Error('Overlapping copy edits');
 let after=before;for(const edit of [...edits].reverse())after=after.slice(0,edit.start)+edit.after+after.slice(edit.end);
 const groups=[];
 for(const edit of edits){
  let start=Math.max(0,edit.start-40),end=Math.min(before.length,edit.end+40);
  while(before.split(before.slice(start,end)).length!==2){start=Math.max(0,start-40);end=Math.min(before.length,end+40);}
  const last=groups.at(-1);if(last&&start<=last.end)last.end=Math.max(last.end,end);else groups.push({start,end});
 }
 const replacements=groups.map(group=>{
  const anchor=before.slice(group.start,group.end);let replacement=anchor;
  for(const edit of edits.filter(e=>e.start>=group.start&&e.end<=group.end).reverse())replacement=replacement.slice(0,edit.start-group.start)+edit.after+replacement.slice(edit.end-group.start);
  return {before:anchor,after:replacement};
 });
 let replay=before;for(const edit of replacements){if(replay.split(edit.before).length!==2)throw Error('Generated anchor not unique');replay=replay.replace(edit.before,()=>edit.after);}
 if(replay!==after)throw Error('Generated replacements differ from parsed copy edits');
 const patch=execFileSync('python3',['-c','import json,sys,difflib; d=json.load(sys.stdin); sys.stdout.write("".join(difflib.unified_diff(d["before"].splitlines(True),d["after"].splitlines(True),fromfile="a/"+d["target"],tofile="b/"+d["target"])))'],{input:JSON.stringify({before,after,target:file.path})});
 const name=String(records.length+1).padStart(3,'0')+'-'+path.basename(file.path).replace(/\.[^.]+$/,'')+'.patch';
 await fs.writeFile(path.join(directory,name),patch);
 records.push({id:'owned-product-copy-'+String(records.length+1).padStart(3,'0'),target:file.path,file:name,sha256:hash(patch),beforeSha256:hash(bytes),afterSha256:hash(after),replacements});
}
await fs.writeFile(path.join(directory,'registry.json'),JSON.stringify(records,null,2)+'\n');
console.log(JSON.stringify({records:records.length,targets:records.map(r=>r.target)}));
