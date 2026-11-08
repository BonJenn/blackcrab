import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileDigest, digest, relativePath, UPSTREAM } from './artifact.mjs';
export async function patchSource(root, { host = false } = {}) {
 const base = new URL(host ? './host-requirements/' : './patches/',import.meta.url), registry=JSON.parse(await fs.readFile(new URL('registry.json',base),'utf8')), applied=[];
 for (const patch of registry) {
  relativePath(patch.target); const target=path.join(root,patch.target);
  if (patch.kind==='payload') {
   const payload=await fs.readFile(new URL(patch.file,base)); if(digest(payload)!==patch.sha256)throw Error('Desktop payload digest mismatch');
   let old;try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe desktop payload target');old=await fileDigest(target);}catch(error){if(error.code!=='ENOENT')throw error;old=null;}
   if(old!==patch.beforeSha256)throw Error('Desktop payload base differs');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,payload);if(await fileDigest(target)!==patch.afterSha256)throw Error('Desktop payload result differs');
  } else {
   const diff=await fs.readFile(new URL(patch.file,base));if(digest(diff)!==patch.sha256)throw Error('Desktop patch digest mismatch');const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe desktop patch target');let text=await fs.readFile(target,'utf8');if(digest(text)!==patch.beforeSha256)throw Error('Desktop source differs before '+patch.id);for(const replacement of patch.replacements){if(text.split(replacement.before).length!==2)throw Error('Desktop source replacement not unique');text=text.replace(replacement.before,()=>replacement.after);}if(digest(text)!==patch.afterSha256)throw Error('Desktop source differs after patch: '+patch.id);await fs.writeFile(target,text);
  }
  applied.push({id:patch.id,sha256:patch.sha256});
 }
 return applied;
}
export async function prepareSource({ archive, cacheDir }) {
 if(await fileDigest(archive)!==UPSTREAM.archiveSha256)throw Error('Desktop source archive digest mismatch');await fs.mkdir(cacheDir,{recursive:true});const source=await fs.mkdtemp(path.join(cacheDir,'blackcrab-desktop-source-'));
 await new Promise((resolve,reject)=>{const p=spawn('tar',['-xzf',path.resolve(archive),'--strip-components=1','--exclude=*/.git','--exclude=*/.repos','-C',source],{stdio:['ignore','ignore','pipe']});let error='';p.stderr.on('data',v=>error=(error+v).slice(-2048));p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error('Desktop extraction failed: '+error)));});
 return {source,sourcePatches:await patchSource(source)};
}
