import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export const digest=b=>createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
export function safePath(p){if(typeof p!=='string'||!p||path.isAbsolute(p)||p.includes('\\')||/[\x00-\x1f:]/.test(p)||p.split('/').some(x=>!x||x==='.'||x==='..'||x==='node_modules'))throw Error('Unsafe activation path');return p;}
export function applyRecordedAdapter(before,record,template){
 if(digest(before)!==record.beforeSha256)throw Error('Activation source pin mismatch: '+record.path);
 let after=before.toString();
 if(record.kind==='template'){if(digest(template)!==record.templateSha256)throw Error('Activation template pin mismatch');after=template.toString();}
 else if(record.kind==='replace'){for(const change of record.replacements){const count=after.split(change.before).length-1;if(!change.before||count!==change.count)throw Error('Activation anchor count mismatch: '+record.path);after=after.split(change.before).join(change.after);}}
 else throw Error('Unsupported activation adapter');
 if(digest(after)!==record.afterSha256)throw Error('Activation result pin mismatch: '+record.path);
 return Buffer.from(after);
}
/** Pure byte plan; retains the complete payload rather than tracing a reduced UI slice. */
export function planActivationFiles(payload,registry,templates){
 const files=new Map(payload);for(const p of files.keys())safePath(p);
 const prefix='apps/mobile/';
 if(!files.has(prefix+'src/App.tsx'))throw Error('Missing complete mobile App');
 for(const a of registry.adapters){const p=prefix+safePath(a.path);const before=files.get(p);if(!before)throw Error('Missing mobile activation input: '+a.path);files.set('provenance/original-files/'+p,before);files.set(p,applyRecordedAdapter(before,a,a.template?templates.get(a.template):undefined));}
 const eas=prefix+'eas.json';if(files.has(eas)){files.set('provenance/inert-upstream-eas.json',files.get(eas));files.delete(eas);}
 for(const a of [...registry.additions.map(a=>({...a,path:prefix+safePath(a.path)})),...registry.rootAdditions]){safePath(a.path);const b=templates.get(a.template);if(!b||digest(b)!==a.sha256||files.has(a.path))throw Error('Unsafe activation addition');files.set(a.path,b);}
 files.set('ACTIVATION-HANDOFF.json',Buffer.from(json(registry.handoff)));
 return files;
}
async function readPinnedFile(root,item){
 const handle=await fs.open(path.join(root,safePath(item.path)),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==item.bytes)throw Error('Invalid consumer file');const bytes=await handle.readFile();if(digest(bytes)!==item.sha256)throw Error('Consumer changed during activation');return bytes;}finally{await handle.close();}
}
async function prepare(consumer){
 const {verifyExperienceConsumers}=await import('../consumer.mjs');await verifyExperienceConsumers(consumer);consumer=await fs.realpath(consumer);
 const registryBytes=await fs.readFile(path.join(here,'registry.json'));const registry=JSON.parse(registryBytes);if(registry.generatorSha256!==digest(await fs.readFile(path.join(here,'generator.mjs'))))throw Error('Activation generator pin differs');if(registry.schema!==1||registry.upstreamCommit!=='7f02de2eb8e253e0ec23f005b3cfff8e2c963be8')throw Error('Activation registry pin differs');
 const cm=await fs.readFile(path.join(consumer,'CONSUMER-MANIFEST.json'));const manifest=JSON.parse(cm);const payload=new Map([['provenance/CONSUMER-MANIFEST.json',cm]]);
 for(const item of manifest.files)payload.set(item.path,await readPinnedFile(consumer,item));
 const templates=new Map();for(const a of [...registry.adapters,...registry.additions,...registry.rootAdditions])if(a.template&&!templates.has(a.template))templates.set(a.template,await fs.readFile(path.join(here,safePath(a.template))));
 const files=planActivationFiles(payload,registry,templates);
 const records=[...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(([p,b])=>({path:p,bytes:b.length,sha256:digest(b)}));
 return {consumer,files,manifest:{schema:1,kind:'blackcrab-owned-full-mobile-activation',consumerManifestSha256:digest(cm),registrySha256:digest(registryBytes),readyForMount:false,sourceIntegrated:true,nativeValidationPending:true,files:records}};
}
export async function generateActivation({consumer,output}){
 const plan=await prepare(consumer);output=path.resolve(output);if(output===plan.consumer||output.startsWith(plan.consumer+path.sep))throw Error('Activation output cannot be inside consumer');
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output); // exclusive: existing outputs/symlinks are never replaced
 try{for(const [p,b]of plan.files){const target=path.join(output,safePath(p));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,b,{flag:'wx'});}await fs.writeFile(path.join(output,'ACTIVATION-MANIFEST.json'),json(plan.manifest),{flag:'wx'});}catch(error){await fs.rm(output,{recursive:true,force:true});throw error;}
 return {files:plan.files.size,readyForMount:false,sourceIntegrated:true,nativeValidationPending:true};
}
export async function verifyActivation({consumer,output}){
 const expected=await prepare(consumer);const stat=await fs.lstat(output);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Activation root must be a real directory');
 await readPinnedFile(output,{path:'ACTIVATION-MANIFEST.json',bytes:Buffer.byteLength(json(expected.manifest)),sha256:digest(json(expected.manifest))});
 const wanted=new Set(['ACTIVATION-MANIFEST.json',...expected.files.keys()]);
 async function walk(folder,prefix=''){for(const name of await fs.readdir(folder)){const p=prefix+name,s=await fs.lstat(path.join(folder,name));if(s.isSymbolicLink())throw Error('Activation symlink');if(s.isDirectory())await walk(path.join(folder,name),p+'/');else {if(!s.isFile()||s.nlink!==1||!wanted.delete(p))throw Error('Unexpected activation file');}}}
 await walk(output);if(wanted.size)throw Error('Missing activation file');
 for(const file of expected.manifest.files)await readPinnedFile(output,file);
 return {files:expected.files.size,readyForMount:false,sourceIntegrated:true,nativeValidationPending:true};
}
